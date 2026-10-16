'use strict';

/**
 * 界面自检：用 Playwright 打开成员页面与主营总台，收集控制台错误与页面异常，
 * 执行一遍关键交互（新增待办、勾选步骤、发布草稿、切换视角），并输出截图。
 *
 * 用法：node tools/verify-ui.js [输出目录]
 * 说明：仅访问本机 127.0.0.1，不访问任何外部平台。
 */

const path = require('node:path');
const fs = require('node:fs');

const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const OUT = process.argv[2] || path.join(__dirname, '..', 'screenshots');

const PAGES = [
  ['dashboard', '我的工作台'],
  ['mywork', '我的工作'],
  ['milestones', '版本节点'],
  ['schedule', '本月排期'],
  ['sellingpoints', '版本卖点'],
  ['hotspot', '热点雷达'],
];

const problems = [];

function note(kind, where, text) {
  problems.push({ kind, where, text });
}

/* 自检会写入数据；结束后把自己造的记录清掉，保证示例数据回到初始状态 */
const cleanup = { tasks: [], published: [], topics: [], steps: [] };

async function api(pathname, body) {
  const res = await fetch(BASE + pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function cleanupAll() {
  for (const id of cleanup.tasks) {
    try { await api('/api/mutate', { action: 'delete_task', payload: { id }, user: 1, viewUser: 1 }); } catch (_) {}
  }
  for (const p of cleanup.published) {
    try { await api('/api/mutate', { action: p.undo, payload: { id: p.id }, user: 1, viewUser: 1 }); } catch (_) {}
  }
  for (const id of cleanup.steps) {
    try { await api('/api/mutate', { action: 'delete_step', payload: { id }, user: 2, viewUser: 2 }); } catch (_) {}
  }
  for (const kw of cleanup.topics) {
    try { await api('/api/mutate', { action: 'delete_topic', payload: { id: kw }, user: 2, viewUser: 2 }); } catch (_) {}
  }
}

async function main() {
  const { chromium } = require('playwright');
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  page.on('console', (m) => {
    if (m.type() === 'error') note('console', page.url(), m.text());
  });
  page.on('pageerror', (e) => note('pageerror', page.url(), e.message));
  page.on('requestfailed', (r) => {
    if (r.url().startsWith(BASE)) note('requestfailed', r.url(), r.failure()?.errorText || '');
  });

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('.sidebar', { timeout: 10000 });

  // 逐个打开页面并截图
  for (const [key, label] of PAGES) {
    await page.click(`.nav-item[data-page="${key}"]`);
    await page.waitForTimeout(350);
    const rootExists = await page.locator('#page-root').count();
    if (!rootExists) note('render', key, '页面根节点缺失');
    const title = await page.locator('.page-title').first().textContent().catch(() => null);
    if (!title) note('render', key, '缺少页面标题');
    await page.screenshot({ path: path.join(OUT, `${key}.png`), fullPage: false });
    console.log(`  截图 ${key.padEnd(14)} ${label}  标题=${title}`);
  }

  /* ---------------- 交互冒烟 ---------------- */

  // 1. 成员视角：添加个人待办
  await page.click('.nav-item[data-page="mywork"]');
  await page.waitForTimeout(250);
  const before = await page.locator('[data-task-row]').count();
  await page.click('[data-act="add-self-task"]');
  await page.waitForSelector('.modal');
  await page.fill('.modal [name="title"]', '自检用临时待办');
  await page.click('[data-act="submit-self-task"]');
  await page.waitForTimeout(600);
  const after = await page.locator('[data-task-row]').count();
  if (after <= before) note('interaction', '添加个人待办', `任务数未增加（${before} → ${after}）`);
  else console.log(`  添加个人待办 OK（${before} → ${after}）`);
  const selfIds = await page.evaluate(async () => {
    const s = await (await fetch('/api/state?user=2')).json();
    return s.tasks.filter((t) => t.title === '自检用临时待办').map((t) => t.id);
  });
  cleanup.tasks.push(...selfIds);

  // 2. 勾选任务完成（随后改回未开始，避免留下脏状态）
  const firstRow = page.locator('[data-task-row]').first();
  const firstId = Number(await firstRow.getAttribute('data-task-row'));
  const taskTitle = await firstRow.locator('.t').textContent();
  await firstRow.locator('[data-act="toggle-task"]').click();
  await page.waitForTimeout(500);
  const nowDone = await page.evaluate(async (id) => {
    const s = await (await fetch('/api/state?user=2')).json();
    return s.tasks.find((t) => t.id === id)?.status;
  }, firstId);
  if (nowDone !== 'done') note('interaction', '切换任务状态', `勾选后状态为 ${nowDone}，预期 done`);
  else console.log(`  切换任务状态 OK（${taskTitle.trim().slice(0, 16)}）`);
  await api('/api/mutate', { action: 'set_task_status', payload: { id: firstId, status: 'doing' }, user: 2, viewUser: 2 });

  // 3. 打开详情、添加步骤、勾选步骤
  await page.locator('[data-task-row]').first().click({ position: { x: 200, y: 12 } });
  await page.waitForTimeout(350);
  const hasDetail = await page.locator('#detail-panel .card-head').count();
  if (!hasDetail) note('interaction', '任务详情', '点击任务行后未打开详情面板');
  else {
    const stepsBefore = await page.evaluate(async () => {
      const s = await (await fetch('/api/state?user=2')).json();
      return s.steps.map((x) => x.id);
    });
    await page.fill('[data-step-input]', '自检步骤一');
    await page.click('[data-act="add-step"]');
    await page.waitForTimeout(500);
    const steps = await page.locator('#detail-panel .step').count();
    if (steps === 0) note('interaction', '添加步骤', '步骤未写入');
    else console.log(`  添加步骤 OK（步骤数 ${steps}）`);
    cleanup.steps = await page.evaluate(async (before) => {
      const s = await (await fetch('/api/state?user=2')).json();
      return s.steps.filter((x) => !before.includes(x.id)).map((x) => x.id);
    }, stepsBefore);
    await page.screenshot({ path: path.join(OUT, 'detail.png') });
  }

  // 4. 拖动排序接口（直接调用一次 reorder 以验证后端契约）
  const reorderOk = await page.evaluate(async () => {
    const res = await fetch('/api/mutate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reorder_tasks', payload: { orderedIds: [], userId: 2 }, user: 2, viewUser: 2 }),
    });
    return res.ok;
  });
  if (!reorderOk) note('interaction', '个人排序', 'reorder_tasks 接口返回失败');

  // 5. 主营视角：发布草稿
  await page.click('.account');
  await page.waitForSelector('.popover');
  await page.click('[data-act="set-role"][data-role="admin"]');
  await page.waitForTimeout(600);
  await page.click('.nav-item[data-page="admin"]');
  await page.waitForTimeout(350);
  const draftBtn = page.locator('[data-act="publish-check"]');
  const draftDisabled = await draftBtn.isDisabled();
  if (!draftDisabled) {
    const draftsBefore = await page.evaluate(async () => {
      const s = await (await fetch('/api/state?user=1')).json();
      const out = [];
      for (const g of s.goals) if (!g.published) out.push({ id: g.id, undo: 'unpublish_goal' });
      for (const x of s.scheduleItems) if (!x.published) out.push({ id: x.id, undo: 'unpublish_schedule' });
      for (const x of s.sellingPoints) if (!x.published) out.push({ id: x.id, undo: 'unpublish_selling_point' });
      for (const x of s.milestones) if (!x.published) out.push({ id: x.id, undo: 'unpublish_milestone' });
      return out;
    });
    cleanup.published.push(...draftsBefore);
    await draftBtn.click();
    await page.waitForSelector('.modal');
    await page.click('[data-act="publish-all"]');
    await page.waitForTimeout(900);
    const leftOver = await page.evaluate(async () => {
      const s = await (await fetch('/api/state?user=1')).json();
      return s.goals.filter((g) => !g.published).length
        + s.scheduleItems.filter((x) => !x.published).length
        + s.sellingPoints.filter((x) => !x.published).length
        + s.milestones.filter((x) => !x.published).length;
    });
    if (leftOver !== 0) note('interaction', '检查并发布', `发布后仍有 ${leftOver} 项草稿`);
    else console.log(`  检查并发布 OK（发布 ${draftsBefore.length} 项）`);
  } else {
    console.log('  检查并发布：当前无草稿，跳过');
  }
  await page.screenshot({ path: path.join(OUT, 'admin-after.png') });

  // 6. 主营分配任务给多人
  await page.click('[data-act="new-task"]');
  await page.waitForSelector('.modal');
  await page.fill('.modal [name="title"]', '自检用分配任务');
  await page.click('.check-item[data-assignee="3"]');
  await page.click('.check-item[data-assignee="4"]');
  await page.click('[data-act="save-task"]');
  await page.waitForTimeout(900);
  const created = await page.evaluate(async () => {
    const s = await (await fetch('/api/state?user=1')).json();
    return s.tasks.filter((t) => t.title === '自检用分配任务').map((t) => ({ id: t.id, assignee: t.assignee_id }));
  });
  cleanup.tasks.push(...created.map((c) => c.id));
  if (created.length !== 2) note('interaction', '多人分配', `预期生成 2 条独立任务，实际 ${created.length}`);
  else console.log(`  多人分配生成独立任务 OK（负责人 ${created.map((c) => c.assignee).join(', ')}）`);

  // 7. 热点雷达未连接状态
  await page.click('.account');
  await page.waitForSelector('.popover');
  await page.click('[data-act="set-role"][data-role="member"]');
  await page.waitForTimeout(500);
  await page.click('.nav-item[data-page="hotspot"]');
  await page.waitForTimeout(400);
  const bannerText = await page.locator('.banner').first().textContent().catch(() => '');
  if (!/未连接|连接/.test(bannerText)) note('interaction', '热点雷达空状态', `未显示未连接提示：${bannerText}`);
  else console.log('  热点雷达未连接状态 OK');
  const hasTable = await page.locator('.tbl').count();
  if (hasTable > 0) note('interaction', '热点雷达', '未连接时不应显示任何热点列表（疑似示例数据冒充实时数据）');
  await page.screenshot({ path: path.join(OUT, 'hotspot-disconnected.png') });

  // 8. 切换平台标签
  await page.click('[data-act="hs-platform"][data-id="xiaohongshu"]');
  await page.waitForTimeout(400);
  const xhsBanner = await page.locator('.page-hotspot .banner').allTextContents();
  const xhsActive = await page.locator('[data-act="hs-platform"][data-id="xiaohongshu"]').evaluate((el) => el.classList.contains('on'));
  if (!xhsActive || !xhsBanner.some((text) => /小红书/.test(text))) note('interaction', '热点雷达平台切换', '切换小红书后未显示对应平台提示');
  else console.log('  热点雷达平台切换 OK');

  // 9. 固定板块中不应出现「美食」
  const chipTexts = await page.locator('.chip').allTextContents();
  if (chipTexts.some((t) => t.includes('美食'))) note('interaction', '板块列表', '出现了「美食」板块（说明书明确不设美食板块）');
  else console.log(`  板块列表 OK（${chipTexts.length} 个：${chipTexts.map((t) => t.trim().split(' ')[0]).join('、')}）`);

  await browser.close();

  /* ---------------- 还原自检产生的数据 ---------------- */
  await cleanupAll();
  const residue = await (await fetch(`${BASE}/api/state?user=2`)).json();
  const left = residue.tasks.filter((t) => t.title.startsWith('自检用')).length;
  if (left) note('cleanup', '示例数据', `自检后仍残留 ${left} 条测试任务`);
  else console.log('\n  已清理自检产生的测试数据');

  /* ---------------- 汇总 ---------------- */
  console.log('\n================ 自检结果 ================');
  if (problems.length === 0) {
    console.log('未发现控制台错误、页面异常或交互失败。');
  } else {
    for (const p of problems) console.log(`[${p.kind}] ${p.where}\n    ${p.text}`);
  }
  console.log(`截图目录：${OUT}`);
  process.exit(problems.length ? 1 : 0);
}

main().catch((e) => {
  console.error('自检脚本异常：', e);
  process.exit(2);
});
