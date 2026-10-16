'use strict';

const assert = require('node:assert/strict');
const { mergeLocalHotspotState } = require('../lib/hotspot-context');

const cloudState = {
  viewerId: 'user-1',
  connections: [{ platform: 'douyin', status: 'connected' }],
  trendItems: [{ id: 'trend-1', title: '云端热点' }],
};

const onlineState = mergeLocalHotspotState(cloudState, null, true);
assert.deepEqual(onlineState.connections, cloudState.connections,
  'Vercel 线上环境应保留 Supabase 中的平台连接数据');
assert.deepEqual(onlineState.trendItems, cloudState.trendItems,
  'Vercel 线上环境应保留 Supabase 中的热点数据');

const localState = {
  connections: [{ platform: 'xiaohongshu', status: 'connected' }],
  trendItems: [{ id: 'trend-local', title: '本机采集热点' }],
};
const desktopState = mergeLocalHotspotState(cloudState, localState, false);
assert.deepEqual(desktopState.connections, localState.connections,
  '本地环境应继续使用当前电脑的平台登录状态');
assert.deepEqual(desktopState.trendItems, localState.trendItems,
  '本地环境应继续使用当前电脑采集的热点数据');

console.log('PASS Vercel 使用云端状态，本地版使用本机热点状态');
