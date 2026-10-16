'use strict';

/** UI smoke test: injects a fake API response; never writes to the real database. */
const { chromium } = require('playwright');
const path = require('node:path');

const games = [
  ['nishuihan', '逆水寒手游'], ['nishuihan-gold', '逆水寒黄金服'],
  ['yimeng', '一梦江湖'], ['tianya', '天涯明月刀手游'],
  ['qiannv', '倩女幽魂手游'],
];

(async () => {
  const browser = await chromium.launch({ headless: true });
  let page;
  try {
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.route('**/api/state**', async (route) => {
      const response = await route.fetch();
      const data = await response.json();
      data.trendItems = (data.trendItems || []).filter((t) => t.platform !== 'xiaohongshu');
      data.trendItems.push(...games.flatMap(([key, label]) => [1, 2, 3].map((i) => ({
        id: 99000 + games.findIndex((g) => g[0] === key) * 3 + i,
        platform: 'xiaohongshu', source_kind: 'competitor_filtered_v2', competitor_key: key,
        title: `${label} 测试话题 ${i}`, topic_summary: `依据帖子内容归纳的话题 ${i}`,
        topic_post_count: 8 - i, sample_count: 30, body_read_count: 30, note_comment_count: String(20 - i),
        topic_evidence: JSON.stringify([{ title: `${label} 代表帖`, link: 'https://www.xiaohongshu.com/explore/test' }]),
        query: label, discovered_at: new Date().toISOString(),
      }))));
      await route.fulfill({ response, body: JSON.stringify(data), contentType: 'application/json' });
    });
    await page.goto('http://127.0.0.1:8787/', { waitUntil: 'networkidle' });
    await page.click('.nav-item[data-page="hotspot"]');
    await page.click('[data-act="hs-platform"][data-id="xiaohongshu"]');
    await page.waitForSelector('.competitor-tabs', { timeout: 10000 });
    if (await page.locator('.competitor-tabs [data-act="hs-competitor"]').count() !== 5) throw new Error('缺少五个竞品分类');
    if (await page.locator('.competitor-topic').count() !== 3) throw new Error('初始分类不是三个话题');
    if (!(await page.locator('.page-hotspot').innerText()).includes('30 篇有效游戏讨论帖')) throw new Error('有效样本说明未显示');
    await page.click('[data-act="hs-competitor"][data-id="qiannv"]');
    await page.waitForFunction(() => document.querySelector('[data-act="hs-competitor"][data-id="qiannv"]')?.classList.contains('on')
      && document.querySelector('.competitor-topic .card-head h3')?.textContent.includes('倩女幽魂手游'));
    if (await page.locator('.competitor-topic').count() !== 3) throw new Error('切换分类后不是三个话题');
    const titles = await page.locator('.competitor-topic .card-head h3').allTextContents();
    if (!titles.every((t) => t.includes('倩女幽魂手游'))) throw new Error('分类切换内容错误');
    await page.screenshot({ path: path.join(__dirname, '..', 'screenshots', 'competitor-topics.png') });
    console.log('五个分类、单游戏 Top 3、分类切换：通过');
  } finally {
    if (page) await page.unrouteAll({ behavior: 'ignoreErrors' });
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
