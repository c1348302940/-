'use strict';

/**
 * 将旧本地账号的个人平台登录状态和采集结果复制给新的 Supabase 用户。
 * 幂等：目标用户已有同平台数据时不会重复插入，也不会删除源数据。
 *
 * 用法：node tools/migrate-hotspot-user.js <旧用户ID> <新用户ID> <平台>
 */

const fs = require('node:fs');
const path = require('node:path');
const store = require('../lib/store');
const { DATA_DIR, now } = require('../lib/db');
const { normalizeUserId } = require('../lib/hotspot-context');

const TREND_COLUMNS = [
  'platform', 'title', 'category', 'heat', 'link', 'discovered_at', 'is_real',
  'source_kind', 'query', 'video_like_count', 'video_comment_count',
  'video_published_at', 'video_link', 'board_rank', 'competitor_key',
  'note_published_at', 'note_like_count', 'note_comment_count',
  'topic_post_count', 'topic_summary', 'topic_evidence', 'sample_count',
  'body_read_count',
];

function migrateHotspotUser(sourceId, targetId, platform) {
  const from = normalizeUserId(sourceId);
  const to = normalizeUserId(targetId);
  if (!['douyin', 'xiaohongshu'].includes(platform)) throw new Error('平台参数无效');
  if (from === to) return { copiedAuth: false, copiedConnection: false, copiedItems: 0 };

  const authDir = path.join(DATA_DIR, 'auth');
  const sourceAuth = path.join(authDir, `${from}-${platform}.json`);
  const targetAuth = path.join(authDir, `${to}-${platform}.json`);
  let copiedAuth = false;
  if (fs.existsSync(sourceAuth) && !fs.existsSync(targetAuth)) {
    fs.mkdirSync(authDir, { recursive: true });
    fs.copyFileSync(sourceAuth, targetAuth);
    copiedAuth = true;
  }

  let copiedConnection = false;
  const existingConnection = store.get(
    'SELECT id FROM social_connections WHERE user_id = ? AND platform = ?', to, platform
  );
  const sourceConnection = store.get(
    'SELECT status, status_detail, connected_at FROM social_connections WHERE user_id = ? AND platform = ?', from, platform
  );
  if (!existingConnection && sourceConnection) {
    store.run(
      `INSERT INTO social_connections
       (user_id, platform, state_path, status, status_detail, connected_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      to, platform, targetAuth,
      sourceConnection.status || 'connected',
      sourceConnection.status_detail || '',
      sourceConnection.connected_at || now()
    );
    copiedConnection = true;
  }

  let copiedItems = 0;
  const targetCount = store.get(
    'SELECT COUNT(*) AS count FROM trend_items WHERE user_id = ? AND platform = ?', to, platform
  )?.count || 0;
  if (!targetCount) {
    const sourceItems = store.all(
      'SELECT * FROM trend_items WHERE user_id = ? AND platform = ? ORDER BY id', from, platform
    );
    if (sourceItems.length) {
      const placeholders = ['?', ...TREND_COLUMNS.map(() => '?')].join(', ');
      const sql = `INSERT INTO trend_items (user_id, ${TREND_COLUMNS.join(', ')}) VALUES (${placeholders})`;
      for (const item of sourceItems) {
        store.run(sql, to, ...TREND_COLUMNS.map((column) => item[column]));
      }
      copiedItems = sourceItems.length;
    }
  }

  return { copiedAuth, copiedConnection, copiedItems };
}

if (require.main === module) {
  const [, , sourceId, targetId, platform] = process.argv;
  if (!sourceId || !targetId || !platform) {
    console.error('用法：node tools/migrate-hotspot-user.js <旧用户ID> <新用户ID> <平台>');
    process.exit(1);
  }
  const result = migrateHotspotUser(sourceId, targetId, platform);
  console.log(JSON.stringify({ ok: true, ...result }));
}

module.exports = { migrateHotspotUser };
