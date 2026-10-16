import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.join(here, '..', 'public', 'js', 'team-progress-model.js');
const source = await fs.readFile(sourcePath, 'utf8');
const mod = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

const members = [
  { id: 'u1', name: '甲' },
  { id: 'u2', name: '乙' },
];
const versions = [
  { id: 'v1', name: '当前版本' },
  { id: 'v2', name: '后续版本' },
];
const tasks = [
  { id: 't1', assignee_id: 'u1', version_id: 'v1', status: 'done', due_date: '2026-10-01', title: '已完成' },
  { id: 't2', assignee_id: 'u1', version_id: 'v1', status: 'doing', due_date: '2026-10-10', title: '逾期制作' },
  { id: 't3', assignee_id: 'u1', version_id: 'v2', status: 'todo', due_date: '', title: '后续准备' },
  { id: 't4', assignee_id: 'u2', version_id: null, status: 'done', due_date: '', title: '临时工作' },
  { id: 't5', assignee_id: 'admin', version_id: 'v1', status: 'done', due_date: '', title: '主营任务' },
];
const steps = [
  { task_id: 't1', done: 1 },
  { task_id: 't2', done: 1 },
  { task_id: 't2', done: 0 },
];

const matrix = mod.buildTeamProgressMatrix({
  members, versions, tasks, steps, today: '2026-10-16',
  versionFilter: 'all', statusFilter: 'all', query: '',
});

assert.deepEqual(matrix.columns.map((column) => column.id), ['v1', 'v2', 'none'], '应按版本显示并包含未关联版本');
assert.equal(matrix.rows.length, 2, '只统计传入的团队成员');

const current = matrix.rows[0].cells[0];
assert.deepEqual(
  { total: current.total, done: current.done, doing: current.doing, todo: current.todo, overdue: current.overdue, rate: current.rate },
  { total: 2, done: 1, doing: 1, todo: 0, overdue: 1, rate: 50 },
  '单元格应准确汇总成员在某个版本中的任务进度',
);
assert.deepEqual(
  { stepDone: current.stepDone, stepTotal: current.stepTotal },
  { stepDone: 2, stepTotal: 3 },
  '步骤进度应与任务完成率分开统计',
);
assert.equal(matrix.rows[1].cells[2].rate, 100, '未关联版本也应正确计算完成率');

const filtered = mod.buildTeamProgressMatrix({
  members, versions, tasks, steps, today: '2026-10-16',
  versionFilter: 'v1', statusFilter: 'overdue', query: '制作',
});
assert.deepEqual(filtered.columns.map((column) => column.id), ['v1'], '版本筛选应缩小可视化列');
assert.equal(filtered.rows[0].cells[0].matchCount, 1, '状态与关键词用于标记匹配任务');
assert.equal(filtered.rows[0].cells[0].rate, 50, '筛选不应篡改真实总体完成率');
assert.equal(filtered.rows[1].cells[0].dimmed, true, '没有匹配任务的单元格应弱化显示');

console.log('team progress matrix passed');
