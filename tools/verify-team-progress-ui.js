'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const root = path.join(__dirname, '..');
const fixture = path.join(root, 'public', '__team-progress-fixture.html');
const screenshotDir = path.join(root, 'screenshots');
const base = process.env.BASE || 'http://127.0.0.1:8787';

const html = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/styles.css">
<style>body{background:#f5f6f8;padding:24px;height:auto}.fixture{max-width:1180px;margin:auto}.card{overflow:hidden}</style></head>
<body><main class="fixture"><div id="root"></div></main>
<script type="module">
import { buildTeamProgressMatrix } from '/js/team-progress-model.js';
import { renderTeamProgressPanel, mountTeamCity } from '/js/team-progress-view.js';
const members=[
 {id:'u1',name:'陈明旺',color:'#2f6bff'},{id:'u2',name:'林晓',color:'#a56de2'},
 {id:'u3',name:'周遥',color:'#12a06a'},{id:'u4',name:'沈月',color:'#e07b2a'}];
const versions=[
 {id:'v1',name:'周年庆版本',color:'#2f6bff'},{id:'v2',name:'春节版本',color:'#e5484d'},
 {id:'v3',name:'春日版本',color:'#12a06a'},{id:'v4',name:'联动版本',color:'#a56de2'}];
const tasks=[]; const steps=[]; let id=0;
const add=(member,version,status,due,stepDone=0,stepTotal=0)=>{const task={id:'t'+(++id),assignee_id:member,version_id:version,status,due_date:due,title:'营销任务 '+id,description:'版本营销内容'};tasks.push(task);for(let i=0;i<stepTotal;i++)steps.push({task_id:task.id,done:i<stepDone?1:0});};
add('u1','v1','done','2026-10-10',3,3);add('u1','v1','doing','2026-10-14',2,4);add('u1','v2','todo','2026-11-01');
add('u2','v1','done','2026-10-09',2,2);add('u2','v1','done','2026-10-10');add('u2','v2','doing','2026-10-18',1,3);add('u2','v3','todo','2026-11-10');
add('u3','v1','done','2026-10-08');add('u3','v2','done','2026-10-12');add('u3','v2','done','2026-10-13');add('u3','v3','doing','2026-10-20',3,5);add('u3','v4','todo','2026-12-01');
add('u4','v1','todo','2026-10-12');add('u4','v2','doing','2026-10-15',1,4);add('u4','v3','done','2026-10-12');add('u4',null,'doing','2026-10-17');
const matrix=buildTeamProgressMatrix({members,versions,tasks,steps,today:'2026-10-16',versionFilter:'all',statusFilter:'all',query:''});
const root=document.querySelector('#root');
window.showView=(view)=>{root.innerHTML=renderTeamProgressPanel(matrix,{view,memberId:'u2',versionId:'v2',versionLabel:'全部版本'});if(view==='3d')mountTeamCity(document,matrix,{memberId:'u2',versionId:'v2',yaw:Math.PI/6,onYaw:value=>window.lastYaw=value});};
window.matrix=matrix; window.showView('2d'); window.ready=true;
</script></body></html>`;

(async () => {
  fs.mkdirSync(screenshotDir, { recursive: true });
  fs.writeFileSync(fixture, html, 'utf8');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
    await page.goto(`${base}/__team-progress-fixture.html`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.ready === true);
    assert.equal(await page.getByRole('heading', { name: '团队进度', exact: true }).count(), 1, '标题应简化为“团队进度”');
    const panelWidth = await page.locator('.team-focus-card').evaluate((panel) => panel.getBoundingClientRect().width);
    assert.equal(panelWidth >= 1170, true, '进度卡应横向铺满可用内容区');
    assert.equal(await page.locator('.team-focus-stat').count(), 3, '主卡应包含 3 个紧凑统计指标');
    assert.equal(await page.locator('.team-matrix-cell').count(), 20, '2D 应显示 4 名成员 × 5 个版本列');
    assert.equal(await page.locator('.team-matrix-version').evaluateAll((labels) => labels.every((label) => label.scrollWidth <= label.clientWidth)), true, '版本名称应完整显示');
    assert.equal(await page.locator('.team-matrix-member').evaluateAll((labels) => labels.every((label) => label.scrollWidth <= label.clientWidth)), true, '成员名称应完整显示');
    assert.equal(await page.locator('.team-matrix-cell').evaluateAll((cells) => cells.every((cell) => cell.textContent.trim() === '')), true, '2D 色块内部不应塞入文字');
    assert.equal(await page.locator('.team-matrix-cell.selected').count(), 1, '2D 应用黑色描边标记选中项');
    assert.equal(await page.locator('.team-focus-detail').count(), 1, '主卡底部应显示当前成员与版本的详情行');
    await page.screenshot({ path: path.join(screenshotDir, 'team-progress-2d.png'), fullPage: true });

    await page.evaluate(() => window.showView('3d'));
    assert.equal(await page.locator('.team-city-block').count(), 20, '3D 应使用与 2D 相同的 20 个数据单元');
    assert.equal(await page.locator('.team-city-block text').count(), 0, '3D 建筑表面不应放百分比文字');
    assert.equal(await page.locator('.team-city-block.selected').count(), 1, '3D 应用黑色屋顶描边标记选中项');
    const city = page.locator('.team-city');
    const box = await city.boundingBox();
    await page.mouse.move(box.x + box.width * .55, box.y + box.height * .5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * .7, box.y + box.height * .5, { steps: 5 });
    await page.mouse.up();
    assert.equal(await page.evaluate(() => Number.isFinite(window.lastYaw)), true, '拖动 3D 城市应更新视角');
    await page.screenshot({ path: path.join(screenshotDir, 'team-progress-3d.png'), fullPage: true });
    console.log('team progress UI passed: 2D cells=20, 3D blocks=20, drag=ok');
  } finally {
    await browser.close();
    fs.rmSync(fixture, { force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
