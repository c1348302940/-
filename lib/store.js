'use strict';

/**
 * 业务逻辑层：数据读写 + 自动进度计算 + 站内提醒。
 * 所有持久化数据均落在 app/data/app.db（SQLite）。
 */

const dbMod = require('./db');

const DAY_MS = 86400000;

function db() {
  return dbMod.open();
}

function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function all(sql, ...params) {
  return db().prepare(sql).all(...params);
}
function get(sql, ...params) {
  return db().prepare(sql).get(...params);
}
function run(sql, ...params) {
  const r = db().prepare(sql).run(...params);
  return r;
}

/* ------------------------------------------------------------------ */
/* 读取                                                                */
/* ------------------------------------------------------------------ */

function getUsers() {
  return all('SELECT * FROM users ORDER BY sort, id');
}
function getVersions() {
  return all('SELECT * FROM versions ORDER BY sort, id');
}
function getGoals() {
  return all('SELECT * FROM goals ORDER BY id');
}
function getMilestones() {
  return all('SELECT * FROM milestones ORDER BY date, id');
}
function getScheduleItems() {
  return all('SELECT * FROM schedule_items ORDER BY id');
}
function getSellingPoints() {
  return all('SELECT * FROM selling_points ORDER BY id');
}
function getTasks() {
  return all('SELECT * FROM tasks ORDER BY personal_order IS NULL, personal_order, id');
}
function getSteps() {
  return all('SELECT * FROM task_steps ORDER BY sort, id');
}
function getContentUpdates() {
  return all('SELECT * FROM content_updates ORDER BY id DESC');
}
function getUpdateReads(userId) {
  return all('SELECT * FROM update_reads WHERE user_id = ?', userId);
}
function getConnections(userId) {
  return all('SELECT * FROM social_connections WHERE user_id = ?', userId);
}
function getTrendItems(userId) {
  // 按平台名次升序。原来是 ORDER BY id DESC，而条目是按名次顺序插入的，
  // 取回来正好整个倒序，界面上把榜单第 1 名显示成了最后一名。
  // board_rank 为空的是不占名次的条目（抖音置顶条、小红书热点搜索、关键词搜索补充），
  // 用 COALESCE 归到 0 放在最前，同组内按插入顺序。
  return all(
    'SELECT * FROM trend_items WHERE user_id = ? ORDER BY COALESCE(board_rank, 0), id',
    userId
  );
}
function getSharedTrendItems() {
  const { selectSharedTrendItems } = require('./hotspot-context');
  const rows = all('SELECT * FROM trend_items ORDER BY discovered_at DESC, COALESCE(board_rank, 0), id');
  return selectSharedTrendItems(rows);
}
function getSavedTopics(userId) {
  return all('SELECT * FROM saved_topics WHERE user_id = ? ORDER BY id DESC', userId);
}

/* ------------------------------------------------------------------ */
/* 派生计算                                                            */
/* ------------------------------------------------------------------ */

function stepsProgress(taskId, steps) {
  const mine = steps.filter((s) => s.task_id === taskId);
  const done = mine.filter((s) => s.done === 1).length;
  return { total: mine.length, done };
}

function tasksByKey(tasks) {
  const m = new Map();
  for (const t of tasks) m.set(t.id, t);
  return m;
}

function computeGoalProgress(goal, tasks) {
  const linked = tasks.filter((t) => t.goal_id === goal.id);
  const done = linked.filter((t) => t.status === 'done').length;
  let progress = null; // null => 暂无关联任务
  if (linked.length > 0) progress = done / linked.length;
  return { total: linked.length, done, progress };
}

function computeMilestoneStatus(m, tasks) {
  const linked = tasks.filter((t) => t.milestone_id === m.id);
  const done = linked.filter((t) => t.status === 'done').length;
  const auto = linked.length > 0;
  const status = auto ? (done === linked.length ? 'done' : 'pending') : m.status;
  return { total: linked.length, done, auto, status };
}

function computeScheduleStages(item, tasks) {
  function stage(stageName) {
    const t = tasks.find(
      (x) => x.schedule_item_id === item.id && x.schedule_stage === stageName
    );
    return t ? { taskId: t.id, status: t.status, assigneeId: t.assignee_id } : null;
  }
  return { make: stage('make'), publish: stage('publish') };
}

function diffDays(dateStr) {
  if (!dateStr) return null;
  const due = new Date(dateStr + 'T00:00:00');
  const today = new Date(todayStr() + 'T00:00:00');
  return Math.round((due - today) / DAY_MS);
}

/* 站内提醒：截止日期前 1 天提醒，逾期持续显示；内容更新提醒 */
function buildReminders(userId, tasks, milestones, updates, reads) {
  const myTasks = tasks.filter((t) => t.assignee_id === userId && t.status !== 'done' && t.due_date);
  const due = [];
  for (const t of myTasks) {
    const d = diffDays(t.due_date);
    if (d === null) continue;
    if (d < 0) due.push({ kind: 'overdue', refType: 'task', refId: t.id, title: t.title, date: t.due_date, diff: d });
    else if (d <= 1) due.push({ kind: 'due', refType: 'task', refId: t.id, title: t.title, date: t.due_date, diff: d });
  }
  for (const m of milestones) {
    // 只提醒已发布节点；未发布节点成员本就看不到，不应产生站内提醒。
    if (m.published !== 1) continue;
    if (!m.date) continue;
    // 用「当前计算状态」判断完成：有关联任务的节点在任务全部完成后即视为完成，
    // 不能只看存储字段 status（那只是无关联任务节点的手动值）。
    const state = m.computedStatus || m.status;
    if (state === 'done') continue;
    const d = diffDays(m.date);
    if (d === null) continue;
    if (d < 0) due.push({ kind: 'overdue', refType: 'milestone', refId: m.id, title: m.name, date: m.date, diff: d });
    else if (d <= 1) due.push({ kind: 'due', refType: 'milestone', refId: m.id, title: m.name, date: m.date, diff: d });
  }
  const readSet = new Set(reads.map((r) => r.update_id));
  const contentUpdates = updates.filter((u) => !readSet.has(u.id));
  const overdueCount = due.filter((x) => x.kind === 'overdue').length;
  const dueCount = due.filter((x) => x.kind === 'due').length;
  return { items: due, contentUpdates, overdueCount, dueCount };
}

/* ------------------------------------------------------------------ */
/* 发布记录（内容更新提醒来源）                                        */
/* ------------------------------------------------------------------ */

function recordUpdate(entityType, entityId, title) {
  run(
    'INSERT INTO content_updates (entity_type, entity_id, title, published_at) VALUES (?, ?, ?, ?)',
    entityType, entityId, title, dbMod.now()
  );
}

/* 撤回发布时移除对应的内容更新记录，避免成员首页残留无效的“内容已更新”提醒 */
function clearUpdate(entityType, entityId) {
  run('DELETE FROM content_updates WHERE entity_type = ? AND entity_id = ?', entityType, entityId);
}

/* ------------------------------------------------------------------ */
/* 已发布内容的「待发布修改」                                          */
/*                                                                     */
/* 基础列始终是成员当前看到的版本；已发布内容被编辑时，改动写入          */
/* draft_json，成员继续看到旧版本，直到主营点「发布」才应用并提醒一次。  */
/* 未发布的记录本身就是草稿，直接改基础列。                             */
/* ------------------------------------------------------------------ */

const ENTITY_TABLE = {
  goal: 'goals',
  milestone: 'milestones',
  schedule: 'schedule_items',
  selling_point: 'selling_points',
};

const ENTITY_COLUMNS = {
  goal: ['title', 'description', 'target_value', 'version_id'],
  milestone: ['version_id', 'name', 'date', 'description'],
  schedule: ['title', 'version_id', 'description', 'make_date', 'publish_date',
    'make_assignee_id', 'publish_assignee_id'],
  selling_point: ['version_id', 'title', 'one_liner', 'applicable_content', 'material_link', 'notes'],
};

/** 把入参整理成该实体的字段对象（与基础列同名同类型） */
function draftFromPayload(entity, p) {
  const s = (v) => (v === undefined || v === null ? '' : v);
  const n = (v) => (v === undefined || v === null || v === '' ? null : v);
  switch (entity) {
    case 'goal':
      return { title: s(p.title), description: s(p.description), target_value: s(p.target_value), version_id: n(p.version_id) };
    case 'milestone':
      return { version_id: n(p.version_id), name: s(p.name), date: s(p.date), description: s(p.description) };
    case 'schedule':
      return {
        title: s(p.title), version_id: n(p.version_id), description: s(p.description),
        make_date: s(p.make_date), publish_date: s(p.publish_date),
        make_assignee_id: n(p.make_assignee_id), publish_assignee_id: n(p.publish_assignee_id),
      };
    case 'selling_point':
      return {
        version_id: n(p.version_id), title: s(p.title), one_liner: s(p.one_liner),
        applicable_content: s(p.applicable_content), material_link: s(p.material_link), notes: s(p.notes),
      };
    default:
      throw new Error('未知实体: ' + entity);
  }
}

/** 把字段对象写进基础列 */
function applyEntityFields(entity, id, fields, t) {
  const table = ENTITY_TABLE[entity];
  const cols = ENTITY_COLUMNS[entity];
  run(
    `UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
    ...cols.map((c) => fields[c]), t, id
  );
}

function parseDraft(row) {
  if (!row || !row.draft_json) return null;
  try { return JSON.parse(row.draft_json); } catch (_) { return null; }
}

/**
 * 编辑一条内容。
 * @returns {{deferred:boolean}} deferred=true 表示改动进入待发布区，成员仍看旧版本
 */
function saveEntity(entity, payload, t) {
  const table = ENTITY_TABLE[entity];
  const row = get(`SELECT * FROM ${table} WHERE id = ?`, payload.id);
  if (!row) throw new Error('记录不存在');
  const fields = draftFromPayload(entity, payload);
  if (row.published === 1) {
    run(`UPDATE ${table} SET draft_json = ?, updated_at = ? WHERE id = ?`,
      JSON.stringify(fields), t, payload.id);
    return { deferred: true };
  }
  applyEntityFields(entity, payload.id, fields, t);
  return { deferred: false };
}

/** 发布一条内容：先应用待发布修改，再置为已发布并清空草稿区 */
function publishEntity(entity, id, t) {
  const table = ENTITY_TABLE[entity];
  const row = get(`SELECT * FROM ${table} WHERE id = ?`, id);
  if (!row) throw new Error('记录不存在');
  const draft = parseDraft(row);
  if (draft) applyEntityFields(entity, id, { ...draftFromPayload(entity, row), ...draft }, t);
  run(`UPDATE ${table} SET published = 1, published_at = ?, updated_at = ?, draft_json = NULL WHERE id = ?`,
    t, t, id);
  return get(`SELECT * FROM ${table} WHERE id = ?`, id);
}

/** 撤回为草稿：内容不再对外，待发布修改直接落到基础列，避免留下悬空草稿 */
function unpublishEntity(entity, id, t) {
  const table = ENTITY_TABLE[entity];
  const row = get(`SELECT * FROM ${table} WHERE id = ?`, id);
  if (!row) return;
  const draft = parseDraft(row);
  if (draft) applyEntityFields(entity, id, { ...draftFromPayload(entity, row), ...draft }, t);
  run(`UPDATE ${table} SET published = 0, updated_at = ?, draft_json = NULL WHERE id = ?`, t, id);
}

/* ------------------------------------------------------------------ */
/* 排期发布 / 编辑时同步生成任务                                       */
/* ------------------------------------------------------------------ */

const STAGE_LABEL = { make: '内部制作交付', publish: '对外发布' };

/** 最近一次排期同步的结果，随下一次状态返回带给界面（仅一次） */
let pendingSyncReport = null;

/**
 * 同步一个排期阶段对应的个人任务。排期是阶段数据的唯一来源。
 *
 * 日期：一律以排期为准，**包括清空**——排期清空日期后任务截止日期同步变空，
 *       不再因旧日期继续触发临期／逾期提醒。
 * 负责人：排期给出负责人时同步；排期只清空负责人但仍保留日期时保留原负责人，
 *       避免把任务改成没有归属、成员清单里看不到的孤儿任务，并如实回报。
 * 阶段被整体移除（日期与负责人都为空）：
 *       · 任务没有个人步骤且未完成 → 直接删除（没有个人投入，无需保留）
 *       · 任务有步骤或已完成 → 不静默删除，转为「原排期已移除」的独立任务并回报，
 *         个人步骤与完成记录原样保留。
 *
 * @param {object} item 排期行
 * @param {'make'|'publish'} stage
 * @param {object} report 同步结果，用于向主营如实说明发生了什么
 */
function upsertScheduleTask(item, stage, report) {
  const date = (stage === 'make' ? item.make_date : item.publish_date) || '';
  const assignee = (stage === 'make' ? item.make_assignee_id : item.publish_assignee_id) || null;
  const stageLabel = STAGE_LABEL[stage];
  const existing = get(
    'SELECT * FROM tasks WHERE schedule_item_id = ? AND schedule_stage = ?',
    item.id, stage
  );
  const stageExists = !!(date || assignee);

  /* ---------- 阶段被移除 ---------- */
  if (!stageExists) {
    if (!existing) return;
    const inv = taskInvestment(existing);
    if (inv.invested) detachTask(existing, 'stage', report, inv.steps);
    else dropTask(existing, report);
    return;
  }

  const title = `${item.title} · ${stageLabel}`;

  /* ---------- 已有任务：同步 ---------- */
  if (existing) {
    if (!assignee && date && (existing.assignee_id || null) !== null) {
      report.assigneeKept.push({ stage, stageLabel, title: existing.title });
    }
    const nextAssignee = assignee || existing.assignee_id;
    const dateChanged = (existing.due_date || '') !== date;
    run(
      `UPDATE tasks SET title = ?, due_date = ?, assignee_id = ?, version_id = ?,
         schedule_detached = 0, updated_at = ? WHERE id = ?`,
      title, date, nextAssignee, item.version_id, dbMod.now(), existing.id
    );
    if (dateChanged) {
      report.dateChanged.push({ stage, stageLabel, from: existing.due_date || '', to: date });
    }
    return;
  }

  /* ---------- 新建任务 ---------- */
  // 该阶段已有一条挂在排期上的任务时不重复生成（防止重复分配同一阶段）
  if (hasActiveStageTask(item.id, stage)) return;
  // 一个任务必须有且仅有一个负责人，因此只有日期没有负责人的阶段不生成任务。
  if (!assignee) {
    report.needsAssignee.push({ stage, stageLabel, date });
    return;
  }
  const maxOrder = get('SELECT MAX(personal_order) AS m FROM tasks WHERE assignee_id = ?', assignee);
  const next = (maxOrder && maxOrder.m != null ? maxOrder.m : 0) + 1;
  run(
    `INSERT INTO tasks (title, description, source, assignee_id, version_id, schedule_item_id,
       schedule_stage, due_date, priority, personal_order, status, schedule_detached, created_at, updated_at)
     VALUES (?, ?, 'schedule', ?, ?, ?, ?, ?, 2, ?, 'todo', 0, ?, ?)`,
    title, item.description || '', assignee, item.version_id, item.id, stage, date, next, dbMod.now(), dbMod.now()
  );
  report.created.push({ stage, stageLabel, assigneeId: assignee, dueDate: date });
}

/** @returns {object} 本次同步做了什么，供界面如实告知主营 */
function syncScheduleTasks(item) {
  const report = { created: [], removed: [], detached: [], dateChanged: [], assigneeKept: [], needsAssignee: [] };
  upsertScheduleTask(item, 'make', report);
  upsertScheduleTask(item, 'publish', report);
  return report;
}

/* ------------------------------------------------------------------ */
/* 排期任务退役（撤回／删除整条排期，或取消某个阶段）                   */
/*                                                                     */
/* 说明书的「已完成任务保留并可回看」同样适用于排期自动生成的任务：     */
/*   · 尚未开始且没有任何步骤 → 没有个人投入，可以移除                 */
/*   · 已有步骤，或已进入进行中／已完成 → 不能静默删除，转为独立历史    */
/*     任务保留下来，并标出是哪一种原因脱离的排期                      */
/* ------------------------------------------------------------------ */

const DETACH_REASON = {
  stage: '原排期阶段已取消',
  unpublish: '原排期已撤回',
  remove: '原排期已删除',
};

/** 单个任务是否已有个人投入（步骤或非「未开始」状态） */
function taskInvestment(task) {
  const steps = get('SELECT COUNT(*) AS c FROM task_steps WHERE task_id = ?', task.id).c;
  return { steps, started: task.status !== 'todo', invested: steps > 0 || task.status !== 'todo' };
}

/**
 * 把一个任务转为脱离排期的独立历史任务。
 * 清空排期关联，因此不会再被算作任何排期阶段的状态。
 */
function detachTask(task, reasonKey, info, steps) {
  const label = DETACH_REASON[reasonKey];
  run(
    `UPDATE tasks SET schedule_item_id = NULL, schedule_stage = '', schedule_detached = 1,
       schedule_detach_reason = ?, title = ?, updated_at = ? WHERE id = ?`,
    label, `${task.title}（${label}）`, dbMod.now(), task.id
  );
  info.detached.push({
    stage: task.schedule_stage, title: task.title, reason: label,
    steps: steps || 0, status: task.status,
  });
}

/** 移除一个没有任何个人投入的排期任务 */
function dropTask(task, info) {
  run('DELETE FROM task_steps WHERE task_id = ?', task.id);
  run('DELETE FROM tasks WHERE id = ?', task.id);
  info.removed.push({ stage: task.schedule_stage, title: task.title });
}

/**
 * 排期整体不再有效时（撤回为草稿／删除排期）处理它生成的任务。
 * @returns {object} 保留与移除的明细，供界面如实告知主营
 */
function retireScheduleTasks(scheduleId, reasonKey) {
  const info = { created: [], removed: [], detached: [], dateChanged: [], assigneeKept: [], needsAssignee: [] };
  const tasks = all('SELECT * FROM tasks WHERE schedule_item_id = ?', scheduleId);
  for (const task of tasks) {
    const inv = taskInvestment(task);
    if (inv.invested) detachTask(task, reasonKey, info, inv.steps);
    else dropTask(task, info);
  }
  return info;
}

/**
 * 预览撤回／删除某条排期对个人任务的影响，供界面在操作前给出具体后果。
 */
function scheduleImpact(scheduleId) {
  const tasks = all('SELECT * FROM tasks WHERE schedule_item_id = ?', scheduleId);
  let willRemove = 0;
  let willKeep = 0;
  const keep = [];
  for (const task of tasks) {
    const inv = taskInvestment(task);
    if (inv.invested) {
      willKeep++;
      keep.push({
        title: task.title,
        assigneeId: task.assignee_id,
        steps: inv.steps,
        status: task.status,
      });
    } else {
      willRemove++;
    }
  }
  return { total: tasks.length, willRemove, willKeep, keep };
}

/** 判断一个阶段当前是否已有「仍挂在排期上」的任务（用于避免重复分配） */
function hasActiveStageTask(scheduleId, stage) {
  return !!get(
    'SELECT id FROM tasks WHERE schedule_item_id = ? AND schedule_stage = ?',
    scheduleId, stage
  );
}

/* ------------------------------------------------------------------ */
/* 组装状态                                                            */
/* ------------------------------------------------------------------ */

/** 去掉 draft_json 原始串，换成解析后的 draft 标记（仅主营视角需要） */
function withDraft({ draft_json, ...rest }) {
  let d = null;
  if (draft_json) { try { d = JSON.parse(draft_json); } catch (_) { d = null; } }
  return { ...rest, draft: d, hasDraft: !!d };
}
function stripDraft({ draft_json, ...rest }) {
  return rest;
}

/**
 * 组装某个视角能看到的状态。
 *
 * 可见范围（说明书 §2 与体验版数据边界）：
 *  - 成员：只有自己名下的任务与个人步骤；看不到任何草稿内容。
 *  - 主营：可以只读查看成员任务及其步骤进度，用于团队看台。
 * 进度类字段一律先用全量任务在服务端算好，再按角色过滤，避免过滤后数字失真。
 */
function getState(viewUserId) {
  const viewer = get('SELECT * FROM users WHERE id = ?', viewUserId);
  const isAdmin = !!(viewer && viewer.role === 'admin');

  const users = getUsers();
  const versions = getVersions();
  const goals = getGoals();
  const milestones = getMilestones();
  const scheduleItems = getScheduleItems();
  const sellingPoints = getSellingPoints();
  const tasks = getTasks();
  const steps = getSteps();
  const updates = getContentUpdates();
  const reads = getUpdateReads(viewUserId);
  const connections = getConnections(viewUserId);
  const trendItems = getTrendItems(viewUserId);
  const savedTopics = getSavedTopics(viewUserId);

  /* ---- 先用全量任务做派生计算 ---- */
  const goalsOut = goals.map((g) => {
    const p = computeGoalProgress(g, tasks);
    return { ...g, total: p.total, done: p.done, progress: p.progress };
  });
  const milestonesOut = milestones.map((m) => {
    const c = computeMilestoneStatus(m, tasks);
    return { ...m, linkedTotal: c.total, linkedDone: c.done, auto: c.auto, computedStatus: c.status };
  });
  const schedulesOut = scheduleItems.map((s) => {
    const st = computeScheduleStages(s, tasks);
    return { ...s, makeStage: st.make, publishStage: st.publish };
  });

  /* ---- 再按角色过滤 ---- */
  const ownTaskIds = new Set(tasks.filter((t) => t.assignee_id === viewUserId).map((t) => t.id));
  const visibleTasks = isAdmin ? tasks : tasks.filter((t) => ownTaskIds.has(t.id));

  const tasksOut = visibleTasks.map((t) => {
    const own = ownTaskIds.has(t.id);
    const stepsVisible = own || isAdmin;
    const sp = stepsVisible ? stepsProgress(t.id, steps) : { total: 0, done: 0 };
    return { ...t, stepsTotal: sp.total, stepsDone: sp.done, stepsVisible };
  });
  const stepsOut = isAdmin ? steps : steps.filter((s) => ownTaskIds.has(s.task_id));

  const pickVisible = (list) => (isAdmin ? list.map(withDraft) : list.filter((x) => x.published === 1).map(stripDraft));
  const goalsVisible = pickVisible(goalsOut);
  const milestonesVisible = pickVisible(milestonesOut);
  const schedulesVisible = pickVisible(schedulesOut);
  const sellingPointsVisible = pickVisible(sellingPoints);

  const reminders = buildReminders(viewUserId, tasks, milestonesOut, updates, reads);

  return {
    serverTime: dbMod.now(),
    today: todayStr(),
    viewerId: viewUserId,
    viewerRole: isAdmin ? 'admin' : 'member',
    users,
    versions,
    goals: goalsVisible,
    milestones: milestonesVisible,
    scheduleItems: schedulesVisible,
    sellingPoints: sellingPointsVisible,
    tasks: tasksOut,
    steps: stepsOut,
    updates,
    reminders,
    connections,
    trendItems,
    savedTopics,
  };
}

/* ------------------------------------------------------------------ */
/* 变更入口                                                            */
/* ------------------------------------------------------------------ */

function insertTaskCommon(fields) {
  const maxOrder = get('SELECT MAX(personal_order) AS m FROM tasks WHERE assignee_id = ?', fields.assignee_id);
  const next = (maxOrder && maxOrder.m != null ? maxOrder.m : 0) + 1;
  return run(
    `INSERT INTO tasks (title, description, source, assignee_id, version_id, goal_id, milestone_id,
       schedule_item_id, schedule_stage, due_date, priority, personal_order, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'todo', ?, ?)`,
    fields.title, fields.description || '', fields.source || 'assigned', fields.assignee_id,
    fields.version_id || null, fields.goal_id || null, fields.milestone_id || null,
    fields.schedule_item_id || null, fields.schedule_stage || '', fields.due_date || '',
    fields.priority != null ? fields.priority : 2, next, dbMod.now(), dbMod.now()
  );
}

function apply(action, payload, actorId) {
  const t = dbMod.now();
  switch (action) {

    /* ---------- 版本 ---------- */
    case 'create_version': {
      const maxSort = get('SELECT MAX(sort) AS m FROM versions');
      const sort = (maxSort && maxSort.m != null ? maxSort.m : 0) + 1;
      run('INSERT INTO versions (name, description, status, color, sort, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        payload.name, payload.description || '', payload.status || 'active', payload.color || '#6a7ae0', sort, t, t);
      break;
    }
    case 'update_version':
      run('UPDATE versions SET name = ?, description = ?, status = ?, color = ?, updated_at = ? WHERE id = ?',
        payload.name, payload.description || '', payload.status || 'active', payload.color || '#6a7ae0', t, payload.id);
      break;
    case 'delete_version':
      run('DELETE FROM versions WHERE id = ?', payload.id);
      break;

    /* ---------- 核心目标 ---------- */
    case 'create_goal':
      run('INSERT INTO goals (title, description, target_value, version_id, published, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)',
        payload.title, payload.description || '', payload.target_value || '', payload.version_id || null, t, t);
      break;
    case 'update_goal':
      // 已发布目标：改动进入待发布区，成员继续看到原口径
      saveEntity('goal', payload, t);
      break;
    case 'publish_goal': {
      const row = publishEntity('goal', payload.id, t);
      recordUpdate('goal', row.id, row.title);
      break;
    }
    case 'unpublish_goal':
      unpublishEntity('goal', payload.id, t);
      clearUpdate('goal', payload.id);
      break;
    case 'delete_goal':
      clearUpdate('goal', payload.id);
      run('DELETE FROM goals WHERE id = ?', payload.id);
      break;

    /* ---------- 版本节点 ---------- */
    case 'create_milestone':
      run('INSERT INTO milestones (version_id, name, date, description, status, published, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)',
        payload.version_id || null, payload.name, payload.date || '', payload.description || '', payload.status || 'pending', t, t);
      break;
    case 'update_milestone':
      saveEntity('milestone', payload, t);
      break;
    case 'set_milestone_status':
      // 仅对“无关联任务”的节点手动更新状态
      run('UPDATE milestones SET status = ?, updated_at = ? WHERE id = ?', payload.status, t, payload.id);
      break;
    case 'publish_milestone': {
      const row = publishEntity('milestone', payload.id, t);
      recordUpdate('milestone', row.id, row.name);
      break;
    }
    case 'unpublish_milestone':
      unpublishEntity('milestone', payload.id, t);
      clearUpdate('milestone', payload.id);
      break;
    case 'delete_milestone':
      clearUpdate('milestone', payload.id);
      run('DELETE FROM milestones WHERE id = ?', payload.id);
      break;

    /* ---------- 本月排期 ---------- */
    case 'create_schedule':
      run('INSERT INTO schedule_items (title, version_id, description, make_date, publish_date, make_assignee_id, publish_assignee_id, published, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)',
        payload.title, payload.version_id || null, payload.description || '', payload.make_date || '', payload.publish_date || '',
        payload.make_assignee_id || null, payload.publish_assignee_id || null, t, t);
      break;
    case 'update_schedule':
      // 草稿排期不派发任务；已发布排期的改动进入待发布区。
      // 两种情况都不在这里同步任务，只有正式发布才生成／更新任务。
      saveEntity('schedule', payload, t);
      break;
    case 'publish_schedule': {
      const row = publishEntity('schedule', payload.id, t);
      // 发布后按已填写的阶段生成／同步任务，并把同步结果回报给界面
      pendingSyncReport = syncScheduleTasks(row);
      recordUpdate('schedule', row.id, row.title);
      break;
    }
    case 'unpublish_schedule':
      // 撤回为草稿：排期正文对成员不可见。它生成的任务按个人投入处理——
      // 没有投入的移除，已有步骤／已开始的保留为独立历史任务（不能静默丢失）。
      pendingSyncReport = retireScheduleTasks(payload.id, 'unpublish');
      unpublishEntity('schedule', payload.id, t);
      clearUpdate('schedule', payload.id);
      break;
    case 'delete_schedule':
      pendingSyncReport = retireScheduleTasks(payload.id, 'remove');
      clearUpdate('schedule', payload.id);
      run('DELETE FROM schedule_items WHERE id = ?', payload.id);
      break;

    /* ---------- 版本卖点 ---------- */
    case 'create_selling_point':
      run('INSERT INTO selling_points (version_id, title, one_liner, applicable_content, material_link, notes, published, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)',
        payload.version_id || null, payload.title, payload.one_liner || '', payload.applicable_content || '',
        payload.material_link || '', payload.notes || '', t, t);
      break;
    case 'update_selling_point':
      saveEntity('selling_point', payload, t);
      break;
    case 'publish_selling_point': {
      const row = publishEntity('selling_point', payload.id, t);
      recordUpdate('selling_point', row.id, row.title);
      break;
    }
    case 'unpublish_selling_point':
      unpublishEntity('selling_point', payload.id, t);
      clearUpdate('selling_point', payload.id);
      break;
    case 'delete_selling_point':
      clearUpdate('selling_point', payload.id);
      run('DELETE FROM selling_points WHERE id = ?', payload.id);
      break;

    /* ---------- 任务（主营分配） ---------- */
    case 'create_task': {
      const id = insertTaskCommon({ ...payload, source: 'assigned' });
      if (payload.steps && Array.isArray(payload.steps)) {
        payload.steps.forEach((s, i) => {
          if (s && s.trim) run('INSERT INTO task_steps (task_id, title, done, sort, created_at) VALUES (?, ?, 0, ?, ?)', id.lastInsertRowid, s, i + 1, t);
        });
      }
      break;
    }
    case 'update_task':
      run('UPDATE tasks SET title = ?, description = ?, assignee_id = ?, version_id = ?, goal_id = ?, milestone_id = ?, due_date = ?, priority = ?, updated_at = ? WHERE id = ?',
        payload.title, payload.description || '', payload.assignee_id, payload.version_id || null, payload.goal_id || null,
        payload.milestone_id || null, payload.due_date || '', payload.priority != null ? payload.priority : 2, t, payload.id);
      break;
    case 'delete_task':
      run('DELETE FROM task_steps WHERE task_id = ?', payload.id);
      run('DELETE FROM tasks WHERE id = ?', payload.id);
      break;

    /* ---------- 个人任务操作 ---------- */
    case 'set_task_status': {
      const task = get('SELECT * FROM tasks WHERE id = ?', payload.id);
      if (!task) break;
      const completedAt = payload.status === 'done' ? t : (task.status === 'done' ? '' : task.completed_at);
      run('UPDATE tasks SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?', payload.status, completedAt, t, payload.id);
      break;
    }
    case 'reorder_tasks': {
      const ids = payload.orderedIds || [];
      // 个人拖动排序不是任务进度更新，不应刷新团队看台的“最近更新”。
      const stmt = db().prepare('UPDATE tasks SET personal_order = ? WHERE id = ? AND assignee_id = ?');
      db().exec('BEGIN');
      try {
        ids.forEach((id, i) => stmt.run(i + 1, id, payload.userId));
        db().exec('COMMIT');
      } catch (e) {
        db().exec('ROLLBACK');
        throw e;
      }
      break;
    }
    case 'create_self_task': {
      insertTaskCommon({ ...payload, source: 'self', assignee_id: actorId });
      break;
    }

    /* ---------- 步骤 ---------- */
    case 'add_step': {
      const maxSort = get('SELECT MAX(sort) AS m FROM task_steps WHERE task_id = ?', payload.taskId);
      const sort = (maxSort && maxSort.m != null ? maxSort.m : 0) + 1;
      run('INSERT INTO task_steps (task_id, title, done, sort, created_at) VALUES (?, ?, 0, ?, ?)', payload.taskId, payload.title, sort, t);
      run('UPDATE tasks SET updated_at = ? WHERE id = ?', t, payload.taskId);
      break;
    }
    case 'update_step': {
      const step = get('SELECT task_id FROM task_steps WHERE id = ?', payload.id);
      run('UPDATE task_steps SET title = ? WHERE id = ?', payload.title, payload.id);
      if (step) run('UPDATE tasks SET updated_at = ? WHERE id = ?', t, step.task_id);
      break;
    }
    case 'toggle_step': {
      const s = get('SELECT * FROM task_steps WHERE id = ?', payload.id);
      if (s) {
        run('UPDATE task_steps SET done = ? WHERE id = ?', s.done === 1 ? 0 : 1, payload.id);
        run('UPDATE tasks SET updated_at = ? WHERE id = ?', t, s.task_id);
      }
      break;
    }
    case 'delete_step': {
      const step = get('SELECT task_id FROM task_steps WHERE id = ?', payload.id);
      run('DELETE FROM task_steps WHERE id = ?', payload.id);
      if (step) run('UPDATE tasks SET updated_at = ? WHERE id = ?', t, step.task_id);
      break;
    }

    /* ---------- 提醒已读 ---------- */
    case 'delete_update_record':
      // 维护用：移除单条内容更新记录（自检脚本清理自己产生的发布记录）
      run('DELETE FROM content_updates WHERE id = ?', payload.id);
      break;
    case 'mark_update_read':
      run('INSERT OR REPLACE INTO update_reads (user_id, update_id, read_at) VALUES (?, ?, ?)', actorId, payload.updateId, t);
      break;
    case 'mark_all_updates_read': {
      const updates = getContentUpdates();
      const stmt = db().prepare('INSERT OR REPLACE INTO update_reads (user_id, update_id, read_at) VALUES (?, ?, ?)');
      for (const u of updates) stmt.run(actorId, u.id, t);
      break;
    }

    /* ---------- 热点：常用板块 ---------- */
    case 'save_topic':
      run('INSERT INTO saved_topics (user_id, platform, keyword, created_at) VALUES (?, ?, ?, ?)', actorId, payload.platform, payload.keyword, t);
      break;
    case 'delete_topic':
      run('DELETE FROM saved_topics WHERE id = ? AND user_id = ?', payload.id, actorId);
      break;

    /* ---------- 热点：连接状态 ---------- */
    case 'set_connection_status':
      run(
        `INSERT INTO social_connections (user_id, platform, state_path, status, status_detail, connected_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, platform) DO UPDATE SET state_path = excluded.state_path, status = excluded.status, status_detail = excluded.status_detail, connected_at = excluded.connected_at`,
        payload.userId, payload.platform, payload.statePath || '', payload.status, payload.statusDetail || '',
        payload.status === 'connected' ? t : null
      );
      break;
    case 'clear_connection': {
      run('DELETE FROM social_connections WHERE user_id = ? AND platform = ?', payload.userId, payload.platform);
      const dir = require('path').join(require('./db').DATA_DIR, 'auth');
      const fs = require('node:fs');
      const file = require('path').join(dir, `${payload.userId}-${payload.platform}.json`);
      try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch (_) {}
      break;
    }

    default:
      throw new Error('未知操作: ' + action);
  }
  const state = getState(payload._viewUserId != null ? payload._viewUserId : actorId);
  if (pendingSyncReport) {
    state.syncReport = pendingSyncReport;
    pendingSyncReport = null;
  }
  return state;
}

module.exports = {
  apply,
  getState,
  scheduleImpact,
  todayStr,
  getTasks,
  getSteps,
  getMilestones,
  getTrendItems,
  getSharedTrendItems,
  getConnections,
  getSavedTopics,
  getVersions,
  getGoals,
  getScheduleItems,
  getSellingPoints,
  all,
  get,
  run,
};
