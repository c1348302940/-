'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mergeLocalHotspotState, selectSharedTrendItems } = require('../lib/hotspot-context');

const rows = [
  { id: 1, user_id: 'admin', platform: 'douyin', source_kind: 'hotlist', title: '旧榜单', link: 'old', discovered_at: '2026-10-15T10:00:00Z', board_rank: 1 },
  { id: 2, user_id: 'member', platform: 'douyin', source_kind: 'hotlist', title: '新榜单', link: 'new', discovered_at: '2026-10-16T10:00:00Z', board_rank: 1 },
  { id: 3, user_id: 'admin', platform: 'xiaohongshu', source_kind: 'competitor_filtered_v2', competitor_key: 'nishuihan', title: '旧话题', discovered_at: '2026-10-15T10:00:00Z' },
  { id: 4, user_id: 'member', platform: 'xiaohongshu', source_kind: 'competitor_filtered_v2', competitor_key: 'nishuihan', title: '新话题', discovered_at: '2026-10-16T10:00:00Z' },
  { id: 5, user_id: 'copy', platform: 'xiaohongshu', source_kind: 'competitor_filtered_v2', competitor_key: 'nishuihan', title: '新话题', discovered_at: '2026-10-16T10:00:00Z' },
  { id: 6, user_id: 'admin', platform: 'xiaohongshu', source_kind: 'competitor_filtered_v2', competitor_key: 'yimeng', title: '另一话题', discovered_at: '2026-10-14T10:00:00Z' },
];

const shared = selectSharedTrendItems(rows);
assert.deepEqual(shared.filter((row) => row.platform === 'douyin').map((row) => row.title), ['新榜单'],
  '抖音应共享全团队最近一次采集的榜单');
assert.deepEqual(shared.filter((row) => row.competitor_key === 'nishuihan').map((row) => row.title), ['新话题'],
  '小红书每个竞品应取最近一次采集并去除跨账号重复数据');
assert.equal(shared.some((row) => row.competitor_key === 'yimeng'), true,
  '某个竞品没有新采集时应保留上次成功结果');

const merged = mergeLocalHotspotState(
  { connections: [{ platform: 'douyin', status: 'cloud' }], trendItems: [] },
  { connections: [{ platform: 'xiaohongshu', status: 'connected' }], trendItems: shared },
);
assert.equal(merged.connections[0].platform, 'xiaohongshu', '平台登录状态仍应属于当前账号');
assert.deepEqual(merged.trendItems, shared, '热点内容应使用团队共享结果');

const hotspotUi = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'pages', 'hotspot.js'), 'utf8');
assert.match(hotspotUi, /热点内容由团队共享/, '热点页面应明确说明内容为团队共享');
assert.doesNotMatch(hotspotUi, /热点仅供个人查看/, '热点页面不应继续显示个人内容说明');

console.log('PASS 热点内容团队共享，登录状态保持个人隔离');
