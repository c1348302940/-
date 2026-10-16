'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright');

const base = process.env.BASE || 'http://127.0.0.1:8787';
const out = path.join(__dirname, '..', 'screenshots', 'redesign');
const pages = ['dashboard', 'mywork', 'milestones', 'schedule', 'sellingpoints', 'hotspot', 'admin'];

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1586, height: 992 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base, { waitUntil: 'networkidle' });
  for (const name of pages) {
    await page.locator(`.nav-item[data-page="${name}"]`).click();
    await page.locator(`.page-${name}`).waitFor();
    await page.screenshot({ path: path.join(out, `${name}.png`) });
    if (name === 'dashboard') await page.screenshot({ path: path.join(out, 'dashboard-full.png'), fullPage: true });
    const state = await page.evaluate(() => {
      const doc = document.documentElement;
      const content = document.querySelector('.content');
      return {
        title: document.querySelector('.page-title')?.textContent?.trim(),
        horizontalOverflow: doc.scrollWidth > window.innerWidth,
        contentHorizontalOverflow: content.scrollWidth > content.clientWidth,
        buttons: document.querySelectorAll('.page button').length,
      };
    });
    console.log(name, JSON.stringify(state));
  }
  await page.locator('[data-act="toggle-account"]').click();
  await page.locator('.popover [data-act="set-role"][data-role="admin"]').click();
  await page.waitForFunction(() => document.querySelector('.account-name')?.textContent?.includes('林晚'));
  await page.locator('.page-admin').waitFor();
  await page.screenshot({ path: path.join(out, 'admin-owner.png') });
  await browser.close();
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
