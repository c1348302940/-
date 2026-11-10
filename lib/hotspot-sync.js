'use strict';

/**
 * 热点共享：把本机 SQLite 采集到的 trend_items 同步到 Supabase（按团队共享）。
 * 采集仍在本机完成（登录 Cookie 只在本机），采集成功后由 server 调用本模块，
 * 将结果写入云端 trend_items（team_id + collected_by），供团队所有人只读。
 */

const store = require('./store');
const { getAdminClient } = require('./supabase');

/** 本地 topic_evidence 是 TEXT，云端是 jsonb；解析失败回退 null。 */
function safeJson(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    return null;
  }
}

async function syncTrendItems(teamId, userId, platform) {
  const rows = store.all(
    'SELECT * FROM trend_items WHERE user_id = ? AND platform = ?', userId, platform);

  const client = getAdminClient();
  // 与本地 insertTrends 的 clearTrends 语义一致：先清掉「该采集者该平台」旧数据，再全量写入。
  await client.from('trend_items').delete()
    .eq('team_id', teamId)
    .eq('platform', platform)
    .eq('collected_by', userId);

  if (!rows.length) return;

  const payload = rows.map((r) => ({
    team_id: teamId,
    collected_by: userId,
    platform: r.platform,
    title: r.title,
    category: r.category,
    heat: r.heat,
    link: r.link,
    source_kind: r.source_kind || 'hotlist',
    query: r.query || '',
    competitor_key: r.competitor_key || '',
    note_published_at: r.note_published_at,
    note_like_count: r.note_like_count,
    note_comment_count: r.note_comment_count,
    topic_post_count: r.topic_post_count,
    topic_summary: r.topic_summary,
    topic_evidence: safeJson(r.topic_evidence),
    sample_count: r.sample_count,
    body_read_count: r.body_read_count,
    is_real: !!r.is_real,
    board_rank: r.board_rank,
    video_like_count: r.video_like_count,
    video_comment_count: r.video_comment_count,
    video_published_at: r.video_published_at,
    video_link: r.video_link,
    discovered_at: r.discovered_at,
  }));

  const { error } = await client.from('trend_items').insert(payload);
  if (error) throw error;
}

module.exports = { syncTrendItems, safeJson };
