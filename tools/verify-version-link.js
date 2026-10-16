'use strict';

const { chromium } = require('playwright');
const base = process.env.BASE || 'http://127.0.0.1:8787';
const name = `界面联动检查-${Date.now()}`;

(async () => {
  const browser = await chromium.launch({ headless: true });
  let createdId = null;
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.locator('[data-act="toggle-account"]').click();
    await page.locator('.popover [data-act="set-role"][data-role="admin"]').click();
    await page.waitForFunction(() => document.querySelector('.account-name')?.textContent?.includes('林晚'));
    await page.locator('.nav-item[data-page="milestones"]').click();
    await page.locator('[data-act="ms-new-version"]').click();
    await page.locator('.modal [name="name"]').fill(name);
    await page.locator('.modal [name="description"]').fill('临时联动检查');
    await page.locator('.modal [data-act="save-version"]').click();
    await page.locator('.modal').waitFor({ state: 'detached' });
    await page.locator('.page-milestones .toolbar').getByText(name).waitFor();

    const state = await (await page.request.get(`${base}/api/state?user=1`)).json();
    createdId = state.versions.find((v) => v.name === name)?.id;
    if (!createdId) throw new Error('新版本未写入数据');

    await page.locator('.nav-item[data-page="admin"]').click();
    for (const action of ['new-goal', 'new-ms', 'new-schedule', 'new-sp', 'new-task']) {
      await page.locator(`.page-admin [data-act="${action}"]`).first().click();
      const option = page.locator(`.modal select[name="version_id"] option[value="${createdId}"]`);
      if (await option.count() !== 1) throw new Error(`${action} 未包含新版本`);
      await page.locator('.modal [data-act="close-modal"]').first().click();
    }
    console.log('新建版本并关联到目标、节点、排期、卖点和任务：通过');
  } finally {
    if (createdId) {
      const result = await fetch(`${base}/api/mutate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete_version', payload: { id: createdId }, user: 1, viewUser: 1 }),
      });
      if (!result.ok) console.error('临时版本清理失败', result.status);
    }
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
