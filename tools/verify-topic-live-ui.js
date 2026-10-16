'use strict';

/** Read-only live UI check after an authorized collection. */
const { chromium } = require('playwright');
const path = require('node:path');

(async () => {
  const partial = process.argv.includes('--partial');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto('http://127.0.0.1:8787/', { waitUntil: 'networkidle' });
    await page.click('.nav-item[data-page="hotspot"]');
    await page.click('[data-act="hs-platform"][data-id="xiaohongshu"]');
    await page.waitForSelector('.competitor-tabs');
    const games = ['nishuihan', 'nishuihan-gold', 'yimeng', 'tianya', 'qiannv'];
    if (await page.locator('.competitor-tabs button').count() !== 5) throw new Error('五个分类未全部显示');
    for (const game of games) {
      await page.click(`[data-act="hs-competitor"][data-id="${game}"]`);
      await page.waitForFunction((key) => document.querySelector(`[data-act="hs-competitor"][data-id="${key}"]`)?.classList.contains('on'), game);
      const count = await page.locator('.competitor-topic').count();
      if (partial && ['yimeng', 'qiannv'].includes(game)) {
        if (count !== 0) throw new Error(`${game} 应显示未完成而非旧话题`);
        continue;
      }
      if (count !== 3) throw new Error(`${game} 仅显示 ${count} 个话题`);
      const text = await page.locator('.page-hotspot').innerText();
      if (!text.includes('基于 30 篇有效游戏讨论帖 · 已读正文 30 篇')) throw new Error(`${game} 样本量显示不正确`);
    }
    const chip = await page.locator('.status-chip').innerText();
    if (!chip.includes(partial ? '采集失败' : '已连接')) throw new Error('连接状态不符合预期：' + chip);
    await page.screenshot({ path: path.join(__dirname, '..', 'screenshots', 'competitor-live.png') });
    console.log(partial
      ? '真实页面：三个分类各 30 篇有效帖；两个未完成分类和平台限流已明确显示。'
      : '真实页面：已连接；五个分类各 3 个话题；每组 30 篇有效帖、30 篇正文。');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
