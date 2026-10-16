import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sql = await readFile(new URL('../supabase/migrations/202610150001_initial_schema.sql', import.meta.url), 'utf8');

const requiredTables = [
  'teams', 'profiles', 'versions', 'goals', 'milestones', 'schedule_items',
  'selling_points', 'tasks', 'task_steps', 'content_updates', 'update_reads',
  'trend_items', 'saved_topics', 'daily_stats',
];
for (const table of requiredTables) {
  assert.match(sql, new RegExp(`create\\s+table\\s+public\\.${table}\\b`, 'i'), `missing table ${table}`);
  assert.match(sql, new RegExp(`alter\\s+table\\s+public\\.${table}\\s+enable\\s+row\\s+level\\s+security`, 'i'), `RLS not enabled for ${table}`);
}

for (const table of ['goals', 'milestones', 'schedule_items', 'selling_points']) {
  const block = sql.match(new RegExp(`create\\s+table\\s+public\\.${table}\\s*\\(([\\s\\S]*?)\\n\\);`, 'i'))?.[1] || '';
  assert.match(block, /draft_payload\s+jsonb/i, `${table} lacks draft_payload`);
  assert.match(block, /published_at\s+timestamptz/i, `${table} lacks published_at`);
}

assert.match(sql, /foreign key\s*\(version_id\)[\s\S]*?references\s+public\.versions\s*\(id\)[\s\S]*?on delete restrict/i, 'version references must restrict deletion');
assert.match(sql, /unique\s*\(schedule_item_id,\s*schedule_stage\)/i, 'schedule stage tasks must be unique');
assert.match(sql, /unique\s+(?:nulls\s+not\s+distinct\s*)?\(team_id,\s*snapshot_date,\s*member_id,\s*version_id\)/i, 'daily snapshots must be idempotent');
assert.match(sql, /create\s+or\s+replace\s+function\s+public\.take_daily_stats_snapshot/i, 'daily snapshot function missing');
assert.match(sql, /interval\s+'12 months'/i, '12-month cleanup missing');
assert.match(sql, /auth\.uid\(\)/i, 'policies must derive identity from auth.uid()');
assert.match(sql, /alter\s+publication\s+supabase_realtime\s+add\s+table/i, 'Realtime publication missing');

console.log(`schema contract passed: ${requiredTables.length} tables`);
