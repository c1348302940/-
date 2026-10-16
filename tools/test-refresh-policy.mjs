import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.join(here, '..', 'public', 'js', 'refresh-policy.js');
let mod = {};
try {
  const source = await fs.readFile(sourcePath, 'utf8');
  mod = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
} catch (_) {
  // The first TDD run intentionally reaches the assertions before this module exists.
}

assert.equal(typeof mod.shouldAutoRefresh, 'function', '应提供自动刷新条件判断');
assert.equal(mod.AUTO_REFRESH_MS, 10 * 60 * 1000, '自动刷新间隔应为 10 分钟');
assert.equal(mod.shouldAutoRefresh({ hidden: false, loading: false, modalOpen: false, editing: false }), true,
  '空闲且页面可见时允许自动刷新');
for (const blocked of [
  { hidden: true },
  { loading: true },
  { modalOpen: true },
  { editing: true },
]) {
  assert.equal(mod.shouldAutoRefresh({ hidden: false, loading: false, modalOpen: false, editing: false, ...blocked }), false,
    '页面隐藏、保存中、弹窗打开或正在编辑时不应自动刷新');
}

const [mainSource, shellSource, teamboardSource] = await Promise.all([
  fs.readFile(path.join(here, '..', 'public', 'js', 'main.js'), 'utf8'),
  fs.readFile(path.join(here, '..', 'public', 'js', 'shell.js'), 'utf8'),
  fs.readFile(path.join(here, '..', 'public', 'js', 'pages', 'teamboard.js'), 'utf8'),
]);
assert.match(mainSource, /startAutoRefresh\(\)/, '登录并加载数据后应启动全局自动刷新');
assert.match(shellSource, /data-act="refresh-data"/, '顶部栏应提供手动刷新按钮');
assert.doesNotMatch(teamboardSource, /30000/, '团队看台不应保留旧的 30 秒独立轮询');

console.log('PASS 十分钟自动刷新策略');
