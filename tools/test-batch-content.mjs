import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.join(here, '..', 'public', 'js', 'batch-ops.js');
const source = await fs.readFile(sourcePath, 'utf8');
const mod = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

assert.deepEqual(
  mod.validateBatchItems(
    [{ title: '首条' }, { title: '' }, { title: '第三条' }],
    (item) => item.title ? '' : '请填写排期事项',
  ),
  { index: 1, message: '第 2 条：请填写排期事项' },
  '批量校验应明确指出第几条内容有问题',
);

assert.equal(
  mod.validateBatchItems([{ title: '首条' }], (item) => item.title ? '' : '缺少标题'),
  null,
  '全部条目有效时应通过校验',
);

const rows = [{ id: 'existing', title: '同名内容' }];
const calls = [];
let nextId = 1;
const result = await mod.runBatchCreate({
  items: [{ title: '同名内容' }, { title: '同名内容' }, { title: '第三条' }],
  initialIds: rows.map((row) => row.id),
  async createItem(item, index) {
    calls.push(`create:${index}:${item.title}`);
    rows.push({ id: `new-${nextId++}`, title: item.title });
    return { rows: rows.map((row) => ({ ...row })) };
  },
  async publishItem(id, item, index) {
    calls.push(`publish:${index}:${id}:${item.title}`);
    return { id, syncReport: index === 1 ? { created: [{ stage: 'make' }] } : null };
  },
  listFromState(state) { return state.rows; },
});

assert.deepEqual(result.createdIds, ['new-1', 'new-2', 'new-3'], '即使标题重复也必须找准每条新记录');
assert.deepEqual(calls, [
  'create:0:同名内容', 'publish:0:new-1:同名内容',
  'create:1:同名内容', 'publish:1:new-2:同名内容',
  'create:2:第三条', 'publish:2:new-3:第三条',
]);
assert.equal(result.publishStates[1].syncReport.created.length, 1, '排期发布结果应保留给界面提示');

console.log('batch content behavior passed');
