'use strict';

const { chromium } = require('playwright');
const { COMPETITOR_EXTRACT } = require('../lib/hotspot');

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route('https://www.xiaohongshu.com/**', (route) => route.fulfill({
      status: 200, contentType: 'text/html; charset=utf-8', body: `<!doctype html><html><body>
        <section class="note-item"><a class="cover" href="/search_result/a?xsec_token=first"></a>
          <div class="footer"><a class="title" href="/search_result/a?xsec_token=first">逆水寒玩家讨论副本机制</a>
          <span class="like-count">42</span></div></section>
        <section class="note-item"><a class="cover" href="/search_result/b?xsec_token=second"></a>
          <div class="footer"><a class="title" href="/search_result/b?xsec_token=second">逆水寒玩家讨论新时装</a></div></section>
      </body></html>`,
    }));
    await page.goto('https://www.xiaohongshu.com/search_result?keyword=test');
    const notes = JSON.parse(await page.evaluate(eval(COMPETITOR_EXTRACT)));
    if (notes.length !== 2 || notes[0].title !== '逆水寒玩家讨论副本机制' || notes[1].title !== '逆水寒玩家讨论新时装')
      throw new Error('未正确跳过空封面链接并读取标题链接');
    if (!notes[0].href.includes('xsec_token=first')) throw new Error('笔记链接丢失访问参数');
    if (!notes[0].href.includes('/explore/a?')) throw new Error('搜索卡片链接未转成可打开的详情页链接');
    console.log('空封面链接、真实标题、可打开的详情链接：通过');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
