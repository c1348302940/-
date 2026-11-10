'use strict';

/** 热点采集使用 Supabase 当前会话的 UUID；不接受前端自报的用户 ID。 */
function normalizeUserId(id) {
  if ((typeof id !== 'string' && typeof id !== 'number') || !String(id).trim()) {
    throw new Error('无法确认当前用户身份，请重新登录');
  }
  return String(id);
}

function authenticatedUserId(auth) {
  return normalizeUserId(auth?.profile?.id);
}

/**
 * 登录 Cookie 与平台采集结果只保存在当前电脑，因此用本机数据覆盖云端占位字段。
 * 其它工作台数据（包括 Supabase 中的常用板块）保持不变。
 */
function mergeLocalHotspotState(cloudState, localState, useCloudHotspots = false) {
  if (useCloudHotspots) return cloudState;
  return {
    ...cloudState,
    connections: localState?.connections || [],
    // trendItems / savedTopics 直接走云端：trendItems 按团队共享（采集端同步写入），
    // savedTopics 仍是 per-user，保持各账号独立。
  };
}

module.exports = { normalizeUserId, authenticatedUserId, mergeLocalHotspotState };
