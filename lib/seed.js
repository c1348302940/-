'use strict';

/**
 * 示例数据（单机体验版首次打开时自动载入，均标注“示例”，不代表真实项目资料）。
 * 用法：
 *   node lib/seed.js            已载入则跳过
 *   node lib/seed.js --force    已载入也重新载入（覆盖）
 *   node lib/seed.js --reset    清空全部业务数据后重新载入
 */

const dbMod = require('./db');
const db = dbMod.open();

function now() { return dbMod.now(); }

function day(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

const D = {
  minus2: day(-2), minus1: day(-1),
  p1: day(1), p2: day(2), p3: day(3), p4: day(4), p5: day(5), p6: day(6),
  p7: day(7), p8: day(8), p9: day(9), p10: day(10), p12: day(12),
};

function clearAll() {
  db.exec(`
    DELETE FROM update_reads; DELETE FROM content_updates; DELETE FROM task_steps; DELETE FROM tasks;
    DELETE FROM selling_points; DELETE FROM schedule_items; DELETE FROM milestones; DELETE FROM goals;
    DELETE FROM versions; DELETE FROM users; DELETE FROM saved_topics; DELETE FROM trend_items;
    DELETE FROM social_connections; DELETE FROM settings;
  `);
}

function run(sql, ...p) { return db.prepare(sql).run(...p); }

function runSeed(opts) {
  const reset = !!(opts && opts.reset);
  const force = !!(opts && opts.force);
  const already = db.prepare("SELECT value FROM settings WHERE key='seeded'").get();
  if (already && !reset && !force) {
    console.log('示例数据已存在，跳过（使用 --force 重新载入，--reset 清空后重载）。');
    return false;
  }
  if (reset || force) clearAll();
  seedData();
  return true;
}

module.exports = { runSeed, clearAll };

if (require.main === module) {
  const args = process.argv.slice(2);
  runSeed({ reset: args.includes('--reset'), force: args.includes('--force') });
  dbMod.close();
}

function seedData() {
  const t = now();

  // ---- 用户 ----
  run('INSERT INTO users (id, name, role, title, color, sort) VALUES (?,?,?,?,?,?)', 1, '林晚', 'admin', '主营销', '#5b6ee1', 1);
  run('INSERT INTO users (id, name, role, title, color, sort) VALUES (?,?,?,?,?,?)', 2, '陈晓', 'member', '内容策划', '#2fa37e', 2);
  run('INSERT INTO users (id, name, role, title, color, sort) VALUES (?,?,?,?,?,?)', 3, '苏雨', 'member', '短视频运营', '#c98a2e', 3);
  run('INSERT INTO users (id, name, role, title, color, sort) VALUES (?,?,?,?,?,?)', 4, '赵磊', 'member', '社区运营', '#6a7ae0', 4);

  // ---- 版本 ----
  run('INSERT INTO versions (id, name, description, status, color, sort, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)',
    1, '版本 A · 新赛季预热（示例）', '示例：围绕新赛季内容做预热传播。', 'active', '#5b6ee1', 1, t, t);
  run('INSERT INTO versions (id, name, description, status, color, sort, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)',
    2, '版本 B · 周年庆典（示例）', '示例：周年庆活动与情感向传播。', 'active', '#c98a2e', 2, t, t);
  run('INSERT INTO versions (id, name, description, status, color, sort, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)',
    3, '版本 C · 联动企划（示例）', '示例：跨 IP 联动，规划中。', 'planning', '#9aa7c4', 3, t, t);

  // ---- 核心目标 ----
  run('INSERT INTO goals (id, title, description, target_value, version_id, published, created_at, updated_at, published_at) VALUES (?,?,?,?,?,?,?,?,?)',
    1, '版本 A 内容准备（示例）', '完成版本 A 预热期内容素材的制作与确认。', '示例业务指标：全渠道曝光 5000 万', 1, 1, t, t, t);
  run('INSERT INTO goals (id, title, description, target_value, version_id, published, created_at, updated_at, published_at) VALUES (?,?,?,?,?,?,?,?,?)',
    2, '版本 B 前期规划（示例）', '推进版本 B 卖点梳理及传播方向确认。', '', 2, 1, t, t, t);
  run('INSERT INTO goals (id, title, description, target_value, version_id, published, created_at, updated_at, published_at) VALUES (?,?,?,?,?,?,?,?,?)',
    3, '本月传播重点说明（示例）', '示例草稿：说明本月传播重心与口径。', '', null, 0, t, t, null);

  // ---- 版本节点 ----
  run('INSERT INTO milestones (id, version_id, name, date, description, status, published, created_at, updated_at, published_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    1, 1, '卖点确认（示例）', D.minus1, '示例：确认版本 A 核心卖点与一句话表达。', 'pending', 1, t, t, t);
  run('INSERT INTO milestones (id, version_id, name, date, description, status, published, created_at, updated_at, published_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    2, 1, '素材定稿（示例）', D.p1, '示例：全部预热素材定稿并归档。', 'pending', 1, t, t, t);
  run('INSERT INTO milestones (id, version_id, name, date, description, status, published, created_at, updated_at, published_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    3, 1, '版本预热（示例）', D.p5, '示例：预热内容开始铺量。', 'pending', 1, t, t, t);
  run('INSERT INTO milestones (id, version_id, name, date, description, status, published, created_at, updated_at, published_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    4, 1, '上线发布（示例）', D.p12, '示例：新赛季版本正式上线。', 'pending', 1, t, t, t);
  run('INSERT INTO milestones (id, version_id, name, date, description, status, published, created_at, updated_at, published_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    5, 2, '卖点确认（示例）', D.p4, '示例：确认周年庆卖点。', 'pending', 1, t, t, t);
  run('INSERT INTO milestones (id, version_id, name, date, description, status, published, created_at, updated_at, published_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    6, 2, '传播节奏确认（示例）', D.p9, '示例：确认周年庆传播节奏。', 'pending', 1, t, t, t);
  run('INSERT INTO milestones (id, version_id, name, date, description, status, published, created_at, updated_at, published_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    7, 1, '复盘会（示例·草稿）', D.p7, '示例：预热阶段复盘，尚未发布。', 'pending', 0, t, t, null);

  // ---- 本月排期 ----
  run('INSERT INTO schedule_items (id, title, version_id, description, make_date, publish_date, make_assignee_id, publish_assignee_id, published, created_at, updated_at, published_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    1, '小红书内容制作（示例）', 1, '示例：新赛季预热笔记的图文制作与发布。', D.p3, D.p8, 2, 3, 1, t, t, t);
  run('INSERT INTO schedule_items (id, title, version_id, description, make_date, publish_date, make_assignee_id, publish_assignee_id, published, created_at, updated_at, published_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    2, '抖音话题投放（示例）', 2, '示例：周年庆话题短视频的制作与投放。', D.p5, D.p10, 4, 2, 1, t, t, t);
  run('INSERT INTO schedule_items (id, title, version_id, description, make_date, publish_date, make_assignee_id, publish_assignee_id, published, created_at, updated_at, published_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    3, '公众号长文（示例）', null, '示例：仅对外发布阶段。', '', D.p6, null, 3, 1, t, t, t);
  run('INSERT INTO schedule_items (id, title, version_id, description, make_date, publish_date, make_assignee_id, publish_assignee_id, published, created_at, updated_at, published_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    4, '短视频脚本（示例·草稿）', 1, '示例：尚未发布的排期草稿。', D.p7, '', 2, null, 0, t, t, null);

  // ---- 版本卖点 ----
  run('INSERT INTO selling_points (id, version_id, title, one_liner, applicable_content, material_link, notes, published, created_at, updated_at, published_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    1, 1, '核心卖点摘要（示例）', '示例：一句话表达——「新赛季，全新起点」。', '适用：预热海报、短视频口播、社区话题。', '素材入口：//素材库/版本A/卖点包（示例）', '注意事项：口径以本页为准，避免使用旧版本文案。', 1, t, t, t);
  run('INSERT INTO selling_points (id, version_id, title, one_liner, applicable_content, material_link, notes, published, created_at, updated_at, published_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    2, 1, '联动内容口径（示例）', '示例：联动角色与主线的结合表达。', '适用：联动预热内容。', '', '注意事项：联动细节待法务确认后再使用。', 1, t, t, t);
  run('INSERT INTO selling_points (id, version_id, title, one_liner, applicable_content, material_link, notes, published, created_at, updated_at, published_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    3, 2, '版本 B 卖点方向（示例·草稿）', '示例：待确认表达。', '', '', '', 0, t, t, null);

  // ---- 任务（个人）----
  // 主营分配的任务 + 排期自动生成的任务 + 成员自建任务。
  const T = [];
  function addTask(fields, steps) {
    const r = run(
      `INSERT INTO tasks (title, description, source, assignee_id, version_id, goal_id, milestone_id,
        schedule_item_id, schedule_stage, due_date, priority, personal_order, status, created_at, updated_at, completed_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      fields.title, fields.desc || '', fields.source, fields.assignee, fields.version || null, fields.goal || null,
      fields.milestone || null, fields.sched || null, fields.stage || '', fields.due || '', fields.priority != null ? fields.priority : 2,
      fields.order, fields.status || 'todo', t, t, fields.status === 'done' ? t : null
    );
    const taskId = r.lastInsertRowid;
    (steps || []).forEach((s, i) => {
      run('INSERT INTO task_steps (task_id, title, done, sort, created_at) VALUES (?,?,?,?,?)',
        taskId, s.title, s.done ? 1 : 0, i + 1, t);
    });
    T.push(taskId);
  }

  // 陈晓（成员A）的任务
  addTask({ title: '完成版本 A 主视觉文案初稿（示例）', desc: '示例：输出主视觉上的核心文案初稿，供内部评审。', source: 'assigned', assignee: 2, version: 1, goal: 1, milestone: 2, due: D.minus2, priority: 0, order: 1, status: 'doing' },
    [{ title: '梳理核心卖点', done: true }, { title: '草拟主视觉文案', done: false }, { title: '内部评审并修订', done: false }]);
  addTask({ title: '整理版本 B 卖点沟通问题（示例）', desc: '示例：汇总版本 B 卖点确认需要沟通的问题清单。', source: 'assigned', assignee: 2, version: 2, goal: 2, milestone: 5, due: D.p2, priority: 1, order: 2, status: 'todo' });
  addTask({ title: '提交小红书内容选题方向（示例）', desc: '示例：给出本周小红书选题方向建议。', source: 'assigned', assignee: 2, version: 1, goal: 1, due: D.p4, priority: 1, order: 3, status: 'todo' });
  addTask({ title: '更新竞品内容观察记录（示例）', desc: '示例：临时任务，未关联版本与节点。', source: 'assigned', assignee: 2, due: D.p6, priority: 2, order: 4, status: 'todo' },
    [{ title: '收集竞品动态', done: true }, { title: '整理观察记录', done: false }]);
  addTask({ title: '完成版本 A 视频脚本第一轮整理（示例）', desc: '示例：已完成的历史任务。', source: 'assigned', assignee: 2, version: 1, goal: 1, milestone: 2, due: D.minus2, priority: 2, order: 5, status: 'done' });
  addTask({ title: '自建待办：整理灵感库（示例）', desc: '示例：成员自建任务，关联了版本 A 目标。', source: 'self', assignee: 2, goal: 1, order: 6, status: 'todo' });
  // 排期自动生成的任务（陈晓）
  addTask({ title: '小红书内容制作（示例） · 内部制作交付', desc: '示例：新赛季预热笔记的图文制作与发布。', source: 'schedule', assignee: 2, version: 1, sched: 1, stage: 'make', due: D.p3, order: 7, status: 'todo' });
  addTask({ title: '抖音话题投放（示例） · 对外发布', desc: '示例：周年庆话题短视频的制作与投放。', source: 'schedule', assignee: 2, version: 2, sched: 2, stage: 'publish', due: D.p10, order: 8, status: 'todo' });

  // 苏雨（成员B）的任务
  addTask({ title: '准备抖音投放素材（示例）', desc: '示例：整理抖音投放所需视频与文案素材。', source: 'assigned', assignee: 3, version: 2, goal: 2, due: D.p5, priority: 1, order: 1, status: 'todo' });
  addTask({ title: '小红书内容制作（示例） · 对外发布', desc: '示例：新赛季预热笔记的图文制作与发布。', source: 'schedule', assignee: 3, version: 1, sched: 1, stage: 'publish', due: D.p8, order: 2, status: 'todo' });
  addTask({ title: '公众号长文（示例） · 对外发布', desc: '示例：仅对外发布阶段。', source: 'schedule', assignee: 3, sched: 3, stage: 'publish', due: D.p6, order: 3, status: 'todo' });

  // 赵磊（成员C）的任务
  addTask({ title: '排期确认邮件（示例）', desc: '示例：向各协作方确认周年庆排期。', source: 'assigned', assignee: 4, version: 2, goal: 2, due: D.minus1, priority: 1, order: 1, status: 'done' });
  addTask({ title: '抖音话题投放（示例） · 内部制作交付', desc: '示例：周年庆话题短视频的制作与投放。', source: 'schedule', assignee: 4, version: 2, sched: 2, stage: 'make', due: D.p5, order: 2, status: 'todo' });

  // ---- 一条“内容已更新”示例提醒（成员未读）----
  run('INSERT INTO content_updates (entity_type, entity_id, title, published_at) VALUES (?,?,?,?)',
    'selling_point', 1, '核心卖点摘要（示例）', t);

  // ---- 个人常用板块示例 ----
  run('INSERT INTO saved_topics (user_id, platform, keyword, created_at) VALUES (?,?,?,?)', 2, 'douyin', '新赛季预热', t);

  run('INSERT INTO settings (key, value) VALUES (?,?)', 'seeded', '1');
  console.log('示例数据已载入（users/versions/goals/milestones/schedules/selling_points/tasks/steps）。');
}
