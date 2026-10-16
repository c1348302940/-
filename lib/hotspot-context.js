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

function trendGroupKey(row) {
  const platform = String(row?.platform || '');
  if (platform === 'xiaohongshu' && row?.competitor_key) {
    return `${platform}:competitor:${row.competitor_key}`;
  }
  return `${platform}:${row?.source_kind || 'hotlist'}:${row?.query || ''}`;
}

/**
 * 从本机所有账号的采集记录中选出团队共享结果。
 * 每个平台榜单／每个小红书竞品只保留最近一次成功采集，随后去除
 * 旧账号迁移或多人同时采集产生的重复条目。
 */
function selectSharedTrendItems(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const latestByGroup = new Map();
  for (const row of list) {
    const group = trendGroupKey(row);
    const stamp = String(row?.discovered_at || '');
    if (!latestByGroup.has(group) || stamp > latestByGroup.get(group)) latestByGroup.set(group, stamp);
  }

  const seen = new Set();
  const selected = [];
  for (const row of list) {
    const group = trendGroupKey(row);
    if (String(row?.discovered_at || '') !== latestByGroup.get(group)) continue;
    const identity = [group, row?.title || '', row?.link || '', row?.board_rank ?? ''].join('|');
    if (seen.has(identity)) continue;
    seen.add(identity);
    selected.push(row);
  }
  return selected.sort((a, b) => {
    const platform = String(a.platform || '').localeCompare(String(b.platform || ''));
    if (platform) return platform;
    const group = trendGroupKey(a).localeCompare(trendGroupKey(b));
    if (group) return group;
    return Number(a.board_rank ?? 0) - Number(b.board_rank ?? 0) || Number(a.id || 0) - Number(b.id || 0);
  });
}

/**
 * 平台登录状态保存在当前电脑且按账号隔离；采集结果由调用方整理为团队共享列表。
 * 其它工作台数据（包括 Supabase 中的常用板块）保持不变。
 */
function mergeLocalHotspotState(cloudState, localState, useCloudHotspots = false) {
  if (useCloudHotspots) return cloudState;
  return {
    ...cloudState,
    connections: localState?.connections || [],
    trendItems: localState?.trendItems?.length ? localState.trendItems : (cloudState?.trendItems || []),
  };
}

module.exports = { normalizeUserId, authenticatedUserId, selectSharedTrendItems, mergeLocalHotspotState };
