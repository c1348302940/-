'use strict';

/**
 * 本地 SQLite 数据层（Node 24 内置 node:sqlite，无需原生编译依赖）。
 * 数据文件保存在 app/data/app.db，应用关闭或电脑重启后仍可读取。
 */

const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'app.db');

let db = null;

function now() {
  return new Date().toISOString();
}

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function open() {
  if (db) return db;
  ensureDir();
  db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  migrate();
  return db;
}

function migrate() {
  db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    title TEXT DEFAULT '',
    color TEXT DEFAULT '#6a7ae0',
    sort INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS versions (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    status TEXT DEFAULT 'active',
    color TEXT DEFAULT '#6a7ae0',
    sort INTEGER DEFAULT 0,
    created_at TEXT,
    updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS goals (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    target_value TEXT DEFAULT '',
    version_id INTEGER,
    published INTEGER DEFAULT 0,
    created_at TEXT,
    updated_at TEXT,
    published_at TEXT
  );

  CREATE TABLE IF NOT EXISTS milestones (
    id INTEGER PRIMARY KEY,
    version_id INTEGER,
    name TEXT NOT NULL,
    date TEXT DEFAULT '',
    description TEXT DEFAULT '',
    status TEXT DEFAULT 'pending',
    published INTEGER DEFAULT 0,
    created_at TEXT,
    updated_at TEXT,
    published_at TEXT
  );

  CREATE TABLE IF NOT EXISTS schedule_items (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    version_id INTEGER,
    description TEXT DEFAULT '',
    make_date TEXT DEFAULT '',
    publish_date TEXT DEFAULT '',
    make_assignee_id INTEGER,
    publish_assignee_id INTEGER,
    published INTEGER DEFAULT 0,
    created_at TEXT,
    updated_at TEXT,
    published_at TEXT
  );

  CREATE TABLE IF NOT EXISTS selling_points (
    id INTEGER PRIMARY KEY,
    version_id INTEGER,
    title TEXT NOT NULL,
    one_liner TEXT DEFAULT '',
    applicable_content TEXT DEFAULT '',
    material_link TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    published INTEGER DEFAULT 0,
    created_at TEXT,
    updated_at TEXT,
    published_at TEXT
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    source TEXT DEFAULT 'assigned',
    assignee_id INTEGER,
    version_id INTEGER,
    goal_id INTEGER,
    milestone_id INTEGER,
    schedule_item_id INTEGER,
    schedule_stage TEXT DEFAULT '',
    due_date TEXT DEFAULT '',
    priority INTEGER DEFAULT 2,
    personal_order REAL,
    status TEXT DEFAULT 'todo',
    created_at TEXT,
    updated_at TEXT,
    completed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS task_steps (
    id INTEGER PRIMARY KEY,
    task_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    done INTEGER DEFAULT 0,
    sort INTEGER DEFAULT 0,
    created_at TEXT
  );

  CREATE TABLE IF NOT EXISTS content_updates (
    id INTEGER PRIMARY KEY,
    entity_type TEXT NOT NULL,
    entity_id INTEGER NOT NULL,
    title TEXT DEFAULT '',
    published_at TEXT
  );

  CREATE TABLE IF NOT EXISTS update_reads (
    user_id INTEGER NOT NULL,
    update_id INTEGER NOT NULL,
    read_at TEXT,
    PRIMARY KEY (user_id, update_id)
  );

  CREATE TABLE IF NOT EXISTS social_connections (
    id INTEGER PRIMARY KEY,
    user_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    state_path TEXT DEFAULT '',
    status TEXT DEFAULT 'disconnected',
    status_detail TEXT DEFAULT '',
    connected_at TEXT,
    UNIQUE(user_id, platform)
  );

  CREATE TABLE IF NOT EXISTS trend_items (
    id INTEGER PRIMARY KEY,
    user_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    title TEXT NOT NULL,
    category TEXT DEFAULT '',
    heat TEXT DEFAULT '',
    link TEXT DEFAULT '',
    discovered_at TEXT,
    is_real INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS saved_topics (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    platform TEXT NOT NULL,
    keyword TEXT NOT NULL,
    created_at TEXT
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
  `);

  migrateDraftColumns();
}

/**
 * 增量迁移（只加列，不动既有数据）。
 *
 * draft_json：已发布内容的「待发布修改」。为 NULL 表示没有未发布的改动；
 * 有值时基础列仍是成员看到的已发布版本，主营点「发布」后才把草稿应用到基础列。
 *
 * source_kind / query：热点条目的真实来源类型与命中关键词，
 * 用于区分「平台热榜」与「搜索发现」，避免把搜索结果标成热榜。
 */
function migrateDraftColumns() {
  addColumn('goals', 'draft_json', 'TEXT');
  addColumn('milestones', 'draft_json', 'TEXT');
  addColumn('schedule_items', 'draft_json', 'TEXT');
  addColumn('selling_points', 'draft_json', 'TEXT');
  addColumn('trend_items', 'source_kind', "TEXT DEFAULT 'hotlist'");
  addColumn('trend_items', 'query', "TEXT DEFAULT ''");
  // 竞品玩家讨论监控：笔记归属的竞品 key、笔记发布时间、点赞数、评论数。
  // 这些字段只在真实采集成功后写入；搜索页取不到的字段留空（NULL），界面如实显示「未提供」。
  addColumn('trend_items', 'competitor_key', "TEXT DEFAULT ''");
  addColumn('trend_items', 'note_published_at', 'TEXT');
  addColumn('trend_items', 'note_like_count', 'TEXT');
  addColumn('trend_items', 'note_comment_count', 'TEXT');
  addColumn('trend_items', 'topic_post_count', 'INTEGER');
  addColumn('trend_items', 'topic_summary', 'TEXT');
  addColumn('trend_items', 'topic_evidence', 'TEXT');
  addColumn('trend_items', 'sample_count', 'INTEGER');
  addColumn('trend_items', 'body_read_count', 'INTEGER');
  addColumn('trend_items', 'video_like_count', 'TEXT');
  addColumn('trend_items', 'video_comment_count', 'TEXT');
  addColumn('trend_items', 'video_published_at', 'TEXT');
  addColumn('trend_items', 'video_link', 'TEXT');
  // 平台自己的榜单名次（1 起）。为空表示该条不占名次：
  // 抖音热榜最前面的置顶条，以及小红书搜索结果（本就没有名次）。
  // 不能再用数组下标当名次——它会因为置顶条而整体错位。
  if (addColumn('trend_items', 'board_rank', 'INTEGER')) backfillBoardRank();

  // 排期阶段被移除、但任务已有个人步骤或完成记录时，任务不静默删除，
  // 而是脱离排期保留下来并置此标记，成员与主营都能看出它的来历。
  addColumn('tasks', 'schedule_detached', 'INTEGER DEFAULT 0');
  // 脱离排期的具体原因（阶段取消／排期撤回／排期删除），供界面如实标注
  addColumn('tasks', 'schedule_detach_reason', "TEXT DEFAULT ''");
}

/** @returns {boolean} 本次是否真的新增了列（用于只跑一次的数据回填） */
function addColumn(table, column, decl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (cols.some((c) => c.name === column)) return false;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
  return true;
}

/**
 * 一次性回填：给「加上 board_rank 之前」采集的热点补上平台名次。
 *
 * 依据：每个用户每平台只有一批数据（采集前先 clearTrends 清空），所以插入顺序
 * 就是平台展示顺序；抖音热榜的第 1 条是不占名次的置顶条，其后依次是名次 1..50。
 * 用真实数据验证过这一点：user 2 那批第 2..51 条的热度严格递减（49 降 0 升），
 * 与「位置 2 起即名次 1 起」一致。
 *
 * 只在列刚被加上时跑，不会覆盖之后采集写入的真实名次。
 */
function backfillBoardRank() {
  const groups = db.prepare(
    "SELECT DISTINCT user_id, platform FROM trend_items WHERE source_kind = 'hotlist'"
  ).all();
  const pick = db.prepare(
    "SELECT id FROM trend_items WHERE user_id = ? AND platform = ? AND source_kind = 'hotlist' ORDER BY id"
  );
  const upd = db.prepare('UPDATE trend_items SET board_rank = ? WHERE id = ?');
  for (const g of groups) {
    // 小红书搜索结果本来就没有平台名次，全部留空。
    if (g.platform !== 'douyin') continue;
    pick.all(g.user_id, g.platform).forEach((row, i) => {
      if (i > 0) upd.run(i, row.id);   // i=0 是置顶条，不占名次，留空
    });
  }
}

function close() {
  if (db) {
    try { db.close(); } catch (_) {}
    db = null;
  }
}

module.exports = { open, close, now, DB_PATH, DATA_DIR, backfillBoardRank };
