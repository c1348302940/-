'use strict';

const assert = require('node:assert/strict');
const store = require('../lib/store');
const { normalizeUserId, authenticatedUserId, mergeLocalHotspotState } = require('../lib/hotspot-context');

const UUID = '00000000-0000-4000-8000-000000000123';

assert.equal(authenticatedUserId({ profile: { id: UUID } }), UUID, 'Supabase UUID 必须原样保留');
assert.equal(normalizeUserId(UUID), UUID, '热点子进程入口也必须原样保留 UUID');
assert.throws(() => authenticatedUserId({ profile: { id: '' } }), /用户身份/, '缺失身份必须明确报错');

const merged = mergeLocalHotspotState(
  { connections: [{ platform: 'douyin', status: 'cloud' }], trendItems: [{ title: 'cloud' }], savedTopics: [{ keyword: '保留' }] },
  { connections: [{ platform: 'douyin', status: 'connected' }], trendItems: [{ title: 'local' }] },
);
assert.equal(merged.connections[0].status, 'connected', '页面应使用本机连接状态');
assert.equal(merged.trendItems[0].title, 'local', '页面应使用本机采集结果');
assert.equal(merged.savedTopics[0].keyword, '保留', 'Supabase 常用板块仍应保留');

try {
  store.apply('set_connection_status', {
    userId: UUID,
    platform: 'douyin',
    status: 'connected',
    statusDetail: 'UUID bridge test',
    statePath: '',
  }, UUID);
  const row = store.all('SELECT user_id, status FROM social_connections WHERE user_id = ? AND platform = ?', UUID, 'douyin')[0];
  assert.equal(row.user_id, UUID, 'SQLite 兼容层必须保存 UUID 文本');
  assert.equal(row.status, 'connected');
} finally {
  store.run('DELETE FROM social_connections WHERE user_id = ? AND platform = ?', UUID, 'douyin');
}

console.log('hotspot auth bridge passed');
