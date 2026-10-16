'use strict';

/**
 * 竞品玩家讨论监控 · 界面自检（单次浏览器会话）。
 * 只访问本机 127.0.0.1，不访问任何外部平台；不触发真实登录或采集。
 *
 * 验证：小红书「竞品玩家讨论」分组展示、每竞品≤3 条、字段如实标注（取不到显示「未提供」）、
 *       采集失败保留上次结果并标注采集时间、空状态、抖音热榜不受影响。
 * 结束时会清理自己写入的测试数据。
 *
 * 用法：node tools/verify-competitor.js [输出目录]
 */

const path = require('node:path');
const fs = require('node:fs');

const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const OUT = process.argv[2] || path.join(__dirname, '..', 'screenshots');

const problems = [];
function note(kind, where, text) { problems.push({ kind, where, text }); }

const DB_PATH = path.join(__dirname, '..', 'data', 'app.db');
const USER = 2;

/* 测试数据：5 个竞品，其中逆水寒手游给 4 条（验证前端最多显示 3），
   并给一条缺点赞、缺发布时间的笔记（验证「未提供」）。 */
const TEST_ITEMS = [
  { c: 'nishuihan', title: '逆水寒手游新赛季实测', like: '1.2万', at: '2天前', link: 'https://www.xiaohongshu.com/explore/aaaaaaaa1111' },
  { c: 'nishuihan', title: '逆水寒手游搬砖心得', like: '3000', at: '昨天', link: 'https://www.xiaohongshu.com/explore/bbbbbbbb2222' },
  { c: 'nishuihan', title: '逆水寒手游捏脸分享', like: '5000', at: '3天前', link: 'https://www.xiaohongshu.com/explore/cccccccc3333' },
  { c: 'nishuihan', title: '逆水寒手游副本攻略', like: '800', at: '', link: 'https://www.xiaohongshu.com/explore/dddddddd4444' },
  { c: 'nishuihan-gold', title: '逆水寒黄金服氪金避坑', like: '8000', at: '1天前', link: 'https://www.xiaohongshu.com/explore/eeeeeeee5555' },
  { c: 'yimeng', title: '一梦江湖情缘日常', like: '2万', at: '', link: 'https://www.xiaohongshu.com/explore/ffffffff6666' },
  { c: 'tianya', title: '天涯明月刀手游门派选择', like: '5000', at: '4天前', link: 'https://www.xiaohongshu.com/explore/gggggggg7777' },
  { c: 'qiannv', title: '倩女幽魂手游平民养成', like: '9000', at: '5天前', link: 'https://www.xiaohongshu.com/explore/hhhhhhhh8888' },
];

function writeTestData() {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(DB_PATH);
  db.prepare('DELETE FROM trend_items WHERE user_id = ? AND platform = ?').run(USER, 'xiaohongshu');
  const t = new Date().toISOString();
  const ins = db.prepare(
    `INSERT INTO trend_items (user_id, platform, title, category, heat, link, discovered_at, is_real, source_kind, query, competitor_key, note_published_at, note_like_count, note_comment_count)
     VALUES (?,?,?,?,?,?,?,1,?,?,?,?,?,?)`
  );
  for (const it of TEST_ITEMS) {
    ins.run(USER, 'xiaohongshu', it.title, '', '', it.link, t, 'competitor', '搜索', it.c, it.at || null, it.like || null, null);
  }
  db.close();
}

function setConn(status, detail) {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(DB_PATH);
  const t = new Date().toISOString();
  db.prepare(
    `INSERT INTO social_connections (user_id, platform, state_path, status, status_detail, connected_at)
     VALUES (?, ?, '', ?, ?, ?) ON CONFLICT(user_id, platform) DO UPDATE SET status=excluded.status, status_detail=excluded.status_detail, connected_at=excluded.connected_at`
  ).run(USER, 'xiaohongshu', status, detail, status === 'connected' ? t : null);
  db.close();
}

function cleanup() {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(DB_PATH);
  db.prepare('DELETE FROM trend_items WHERE user_id = ? AND platform = ?').run(USER, 'xiaohongshu');
  db.prepare('DELETE FROM social_connections WHERE user_id = ? AND platform = ?').run(USER, 'xiaohongshu');
  db.close();
}

async function main() {
  const { chromium } = require('playwright');
  fs.mkdirSync(OUT, { recursive: true });

  // 先造测试数据，再开一个浏览器会话做完所有检查
  writeTestData();
  setConn('connected', '竞品玩家讨论 8 条，覆盖 5 个竞品');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });

  page.on('console', (m) => { if (m.type() === 'error') note('console', page.url(), m.text()); });
  page.on('pageerror', (e) => note('pageerror', page.url(), e.message));

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('.sidebar', { timeout: 10000 });

  // 进入热点雷达，切到小红书
  await page.click('.nav-item[data-page="hotspot"]');
  await page.waitForTimeout(350);
  await page.click('[data-act="hs-platform"][data-id="xiaohongshu"]');
  await page.waitForTimeout(400);

  // 分组卡片：应以「逆水寒手游」开头，共 5 个竞品卡片
  const groupTitles = await page.locator('.card .card-head h3').allTextContents();
  const competitorCards = groupTitles.filter((t) =>
    ['逆水寒手游', '逆水寒黄金服', '一梦江湖', '天涯明月刀手游', '倩女幽魂手游'].includes(t.trim()));
  if (competitorCards.length !== 5) note('分组', '竞品分组', `预期 5 个竞品卡片，实际 ${competitorCards.length}（${groupTitles.join('、')}）`);
  else console.log(`  竞品分组 OK（${competitorCards.join('、')}）`);

  // 每竞品最多 3 条：检查逆水寒手游卡片内行数
  const nishuihanCard = page.locator('.card', { hasText: '逆水寒手游' }).first();
  const nishuihanRows = await nishuihanCard.locator('tbody tr').count();
  if (nishuihanRows > 3) note('上限', '逆水寒手游', `预期最多 3 条，实际 ${nishuihanRows}`);
  else console.log(`  每竞品≤3 条 OK（逆水寒手游注入 4 条，显示 ${nishuihanRows} 条）`);

  // 字段如实标注：存在「未提供」
  const bodyText = await page.locator('#page-root').textContent();
  if (!bodyText.includes('未提供')) note('字段', '未提供', '缺少「未提供」标注');
  else console.log('  字段如实标注 OK（取不到点赞/发布时间显示「未提供」）');

  await page.screenshot({ path: path.join(OUT, 'competitor-monitor.png'), fullPage: false });

  // 采集失败 + 保留上次结果：把连接状态改为 error，验证「上次成功采集」标注
  setConn('error', '采集失败：反爬限制，页面结构变化');
  await page.reload({ waitUntil: 'networkidle' });
  await page.click('.nav-item[data-page="hotspot"]');
  await page.waitForTimeout(350);
  await page.click('[data-act="hs-platform"][data-id="xiaohongshu"]');
  await page.waitForTimeout(400);
  const pageText2 = await page.locator('#page-root').textContent();
  if (!pageText2.includes('采集失败')) note('失败状态', '小红书', '未显示采集失败提示');
  else console.log('  采集失败提示 OK');
  if (!pageText2.includes('上次成功采集')) note('失败状态', '小红书', '未标注「上次成功采集」及采集时间');
  else console.log('  失败保留上次结果 + 采集时间标注 OK');
  await page.screenshot({ path: path.join(OUT, 'competitor-stale.png'), fullPage: false });

  // 空状态：清空数据，验证「尚未取得竞品玩家笔记」
  cleanup();
  await page.reload({ waitUntil: 'networkidle' });
  await page.click('.nav-item[data-page="hotspot"]');
  await page.waitForTimeout(350);
  await page.click('[data-act="hs-platform"][data-id="xiaohongshu"]');
  await page.waitForTimeout(400);
  const pageText3 = await page.locator('#page-root').textContent();
  if (!/尚未取得竞品玩家笔记|尚未连接/.test(pageText3)) note('空状态', '小红书', `未显示空状态：${pageText3.slice(0, 120)}`);
  else console.log('  空状态 OK（未连接/无数据时不显示示例内容）');

  // 抖音热榜不受影响
  await page.click('[data-act="hs-platform"][data-id="douyin"]');
  await page.waitForTimeout(300);
  const dyText = await page.locator('#page-root').textContent();
  if (!dyText.includes('抖音热榜') && !dyText.includes('公开热榜')) note('抖音', '热榜', '抖音热榜入口异常');
  else console.log('  抖音热榜入口 OK（未受影响）');

  await browser.close();

  // 汇总
  console.log('\n================ 竞品监控自检结果 ================');
  if (problems.length === 0) console.log('未发现问题。');
  else for (const p of problems) console.log(`[${p.kind}] ${p.where}\n    ${p.text}`);
  console.log(`截图目录：${OUT}`);
  process.exit(problems.length ? 1 : 0);
}

main().catch((e) => {
  console.error('自检脚本异常：', e);
  try { cleanup(); } catch (_) {}
  process.exit(2);
});
