'use strict';

const { getAdminClient } = require('./supabase');

const DAY_MS = 86400000;

function shanghaiToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function asPublished(row) {
  const draft = row.draft_payload || null;
  const { draft_payload, ...rest } = row;
  return { ...rest, published: row.published ? 1 : 0, draft, hasDraft: !!draft };
}

function asMemberContent(row) {
  const { draft_payload, ...rest } = row;
  return { ...rest, published: row.published ? 1 : 0 };
}

function asStep(row) {
  return { ...row, done: row.done ? 1 : 0 };
}

function diffDays(dateStr, today) {
  if (!dateStr) return null;
  const due = new Date(`${dateStr}T00:00:00Z`);
  const current = new Date(`${today}T00:00:00Z`);
  return Math.round((due - current) / DAY_MS);
}

async function query(client, table, teamId, columns = '*') {
  const { data, error } = await client.from(table).select(columns).eq('team_id', teamId);
  if (error) throw error;
  return data || [];
}

async function getState(auth) {
  const client = getAdminClient();
  const { profile } = auth;
  const teamId = profile.team_id;
  const admin = profile.role === 'admin';

  const [
    profilesResult,
    versionsResult,
    goalsResult,
    milestonesResult,
    schedulesResult,
    sellingResult,
    tasksResult,
    updatesResult,
    readsResult,
    connectionsResult,
    trendsResult,
    topicsResult,
    statsResult,
  ] = await Promise.all([
    client.from('profiles').select('id,name,role,title,color,sort,is_active').eq('team_id', teamId).order('sort'),
    client.from('versions').select('*').eq('team_id', teamId).order('sort'),
    client.from('goals').select('*').eq('team_id', teamId),
    client.from('milestones').select('*').eq('team_id', teamId).order('date'),
    client.from('schedule_items').select('*').eq('team_id', teamId),
    client.from('selling_points').select('*').eq('team_id', teamId),
    client.from('tasks').select('*').eq('team_id', teamId).order('personal_order'),
    client.from('content_updates').select('*').eq('team_id', teamId).order('published_at', { ascending: false }),
    client.from('update_reads').select('*').eq('user_id', profile.id),
    client.from('social_connections').select('*').eq('user_id', profile.id),
    client.from('trend_items').select('*').eq('team_id', teamId).order('discovered_at', { ascending: false }),
    client.from('saved_topics').select('*').eq('user_id', profile.id).order('created_at', { ascending: false }),
    client.from('daily_stats').select('*').eq('team_id', teamId).order('snapshot_date'),
  ]);

  for (const result of [profilesResult, versionsResult, goalsResult, milestonesResult,
    schedulesResult, sellingResult, tasksResult, updatesResult, readsResult,
    connectionsResult, trendsResult, topicsResult, statsResult]) {
    if (result.error) throw result.error;
  }

  const users = (profilesResult.data || []).filter((u) => u.is_active || admin);
  const versions = versionsResult.data || [];
  const allTasks = tasksResult.data || [];
  const allTaskIds = allTasks.map((t) => t.id);
  let allSteps = [];
  if (allTaskIds.length) {
    const { data, error } = await client.from('task_steps').select('*').in('task_id', allTaskIds).order('sort');
    if (error) throw error;
    allSteps = data || [];
  }

  const ownTaskIds = new Set(allTasks.filter((t) => t.assignee_id === profile.id).map((t) => t.id));
  const visibleTasks = admin ? allTasks : allTasks.filter((t) => ownTaskIds.has(t.id));
  const visibleSteps = (admin ? allSteps : allSteps.filter((s) => ownTaskIds.has(s.task_id))).map(asStep);

  const tasks = visibleTasks.map((task) => {
    const steps = allSteps.filter((step) => step.task_id === task.id);
    return {
      ...task,
      stepsTotal: steps.length,
      stepsDone: steps.filter((step) => step.done).length,
      stepsVisible: admin || ownTaskIds.has(task.id),
    };
  });

  const goals = (goalsResult.data || []).filter((row) => admin || row.published).map((row) => {
    const linked = allTasks.filter((task) => task.goal_id === row.id);
    const done = linked.filter((task) => task.status === 'done').length;
    return {
      ...(admin ? asPublished(row) : asMemberContent(row)),
      total: linked.length,
      done,
      progress: linked.length ? done / linked.length : null,
    };
  });

  const milestones = (milestonesResult.data || []).filter((row) => admin || row.published).map((row) => {
    const linked = allTasks.filter((task) => task.milestone_id === row.id);
    const done = linked.filter((task) => task.status === 'done').length;
    return {
      ...(admin ? asPublished(row) : asMemberContent(row)),
      linkedTotal: linked.length,
      linkedDone: done,
      auto: linked.length > 0,
      computedStatus: linked.length ? (done === linked.length ? 'done' : 'pending') : row.status,
    };
  });

  const scheduleItems = (schedulesResult.data || []).filter((row) => admin || row.published).map((row) => {
    const stage = (name) => {
      const task = allTasks.find((t) => t.schedule_item_id === row.id && t.schedule_stage === name);
      return task ? { taskId: task.id, status: task.status, assigneeId: task.assignee_id } : null;
    };
    return {
      ...(admin ? asPublished(row) : asMemberContent(row)),
      makeStage: stage('make'),
      publishStage: stage('publish'),
    };
  });
  const sellingPoints = (sellingResult.data || []).filter((row) => admin || row.published)
    .map((row) => admin ? asPublished(row) : asMemberContent(row));

  const today = shanghaiToday();
  const remindersItems = [];
  for (const task of allTasks.filter((t) => t.assignee_id === profile.id && t.status !== 'done')) {
    const diff = diffDays(task.due_date, today);
    if (diff !== null && diff <= 1) {
      remindersItems.push({ kind: diff < 0 ? 'overdue' : 'due', refType: 'task', refId: task.id,
        title: task.title, date: task.due_date, diff });
    }
  }
  const readSet = new Set((readsResult.data || []).map((row) => row.update_id));
  const contentUpdates = (updatesResult.data || []).filter((row) => !readSet.has(row.id));

  return {
    serverTime: new Date().toISOString(),
    today,
    viewerId: profile.id,
    viewerRole: profile.role,
    users,
    versions,
    goals,
    milestones,
    scheduleItems,
    sellingPoints,
    tasks,
    steps: visibleSteps,
    updates: updatesResult.data || [],
    reminders: {
      items: remindersItems,
      contentUpdates,
      overdueCount: remindersItems.filter((item) => item.kind === 'overdue').length,
      dueCount: remindersItems.filter((item) => item.kind === 'due').length,
    },
    connections: connectionsResult.data || [],
    trendItems: trendsResult.data || [],
    savedTopics: topicsResult.data || [],
    dailyStats: (statsResult.data || []).filter((row) => admin || row.member_id === profile.id),
  };
}

function ensureAdmin(auth) {
  if (auth.profile.role !== 'admin') {
    const error = new Error('仅主营销可以执行此操作');
    error.statusCode = 403;
    throw error;
  }
}

function cleanDate(value) {
  return value || null;
}

function entityConfig(action) {
  const configs = {
    goal: { table: 'goals', title: 'title', fields: ['title', 'description', 'target_value', 'version_id'] },
    milestone: { table: 'milestones', title: 'name', fields: ['version_id', 'name', 'date', 'description', 'status'] },
    schedule: { table: 'schedule_items', title: 'title', fields: ['title', 'version_id', 'description', 'make_date', 'publish_date', 'make_assignee_id', 'publish_assignee_id'] },
    selling_point: { table: 'selling_points', title: 'title', fields: ['version_id', 'title', 'one_liner', 'applicable_content', 'material_link', 'notes'] },
  };
  return configs[action];
}

async function one(client, table, id, teamId) {
  const { data, error } = await client.from(table).select('*').eq('id', id).eq('team_id', teamId).single();
  if (error) throw error;
  return data;
}

async function adminEntityUpdate(auth, kind, payload) {
  ensureAdmin(auth);
  const config = entityConfig(kind);
  const client = getAdminClient();
  const current = await one(client, config.table, payload.id, auth.profile.team_id);
  const values = Object.fromEntries(config.fields.filter((key) => key in payload).map((key) => [key, payload[key] || null]));
  if ('description' in values && values.description == null) values.description = '';
  if (current.published) {
    const { error } = await client.from(config.table).update({ draft_payload: { ...current, ...values } }).eq('id', current.id);
    if (error) throw error;
  } else {
    const { error } = await client.from(config.table).update(values).eq('id', current.id);
    if (error) throw error;
  }
}

async function publishEntity(auth, kind, id) {
  ensureAdmin(auth);
  const config = entityConfig(kind);
  const client = getAdminClient();
  const current = await one(client, config.table, id, auth.profile.team_id);
  const update = { published: true, published_at: new Date().toISOString(), draft_payload: null };
  if (current.draft_payload) {
    for (const field of config.fields) {
      if (Object.hasOwn(current.draft_payload, field)) update[field] = current.draft_payload[field];
    }
  }
  const { data, error } = await client.from(config.table).update(update).eq('id', id).select('*').single();
  if (error) throw error;
  const { error: updateError } = await client.from('content_updates').insert({
    team_id: auth.profile.team_id,
    entity_type: kind,
    entity_id: id,
    title: data[config.title] || '',
  });
  if (updateError) throw updateError;
  return data;
}

async function clearUpdates(client, kind, id) {
  const { error } = await client.from('content_updates').delete().eq('entity_type', kind).eq('entity_id', id);
  if (error) throw error;
}

async function nextTaskOrder(client, assigneeId) {
  const { data, error } = await client.from('tasks').select('personal_order').eq('assignee_id', assigneeId)
    .order('personal_order', { ascending: false }).limit(1);
  if (error) throw error;
  return Number(data?.[0]?.personal_order || 0) + 1;
}

async function syncScheduleTasks(auth, item) {
  const client = getAdminClient();
  const report = { created: [], removed: [], detached: [], dateChanged: [], assigneeKept: [], needsAssignee: [] };
  for (const stage of ['make', 'publish']) {
    const stageLabel = stage === 'make' ? '制作' : '发布';
    const date = item[`${stage}_date`] || null;
    const requestedAssignee = item[`${stage}_assignee_id`] || null;
    const { data: existing, error: existingError } = await client.from('tasks').select('*')
      .eq('schedule_item_id', item.id).eq('schedule_stage', stage).maybeSingle();
    if (existingError) throw existingError;
    if (!date) {
      if (!existing) continue;
      const { count, error: countError } = await client.from('task_steps').select('id', { count: 'exact', head: true }).eq('task_id', existing.id);
      if (countError) throw countError;
      if ((count || 0) > 0 || existing.status !== 'todo') {
        const reason = '原排期阶段已取消';
        const { error } = await client.from('tasks').update({
          source: 'self', schedule_item_id: null, schedule_stage: null, schedule_detached: true,
          schedule_detach_reason: reason, title: `${existing.title}（${reason}）`,
        }).eq('id', existing.id);
        if (error) throw error;
        report.detached.push({ stage, stageLabel, title: existing.title, reason, steps: count || 0, status: existing.status });
      } else {
        const { error } = await client.from('tasks').delete().eq('id', existing.id);
        if (error) throw error;
        report.removed.push({ stage, stageLabel, title: existing.title });
      }
      continue;
    }

    const title = `${item.title} · ${stageLabel}`;
    if (existing) {
      const assignee = requestedAssignee || existing.assignee_id;
      if (!requestedAssignee) report.assigneeKept.push({ stage, stageLabel, title: existing.title });
      if ((existing.due_date || null) !== date) report.dateChanged.push({ stage, stageLabel, from: existing.due_date || '', to: date });
      const { error } = await client.from('tasks').update({
        title, description: item.description || '', due_date: date, assignee_id: assignee,
        version_id: item.version_id, schedule_detached: false, schedule_detach_reason: '',
      }).eq('id', existing.id);
      if (error) throw error;
      continue;
    }
    if (!requestedAssignee) {
      report.needsAssignee.push({ stage, stageLabel, date });
      continue;
    }
    const order = await nextTaskOrder(client, requestedAssignee);
    const { error } = await client.from('tasks').insert({
      team_id: auth.profile.team_id, title, description: item.description || '', source: 'schedule',
      created_by: auth.profile.id, assignee_id: requestedAssignee, version_id: item.version_id,
      schedule_item_id: item.id, schedule_stage: stage, due_date: date, priority: 2,
      personal_order: order, status: 'todo',
    });
    if (error) throw error;
    report.created.push({ stage, stageLabel, assigneeId: requestedAssignee, dueDate: date });
  }
  return report;
}

async function retireScheduleTasks(auth, scheduleId, reason) {
  const client = getAdminClient();
  const report = { created: [], removed: [], detached: [], dateChanged: [], assigneeKept: [], needsAssignee: [] };
  const { data: tasks, error } = await client.from('tasks').select('*').eq('team_id', auth.profile.team_id).eq('schedule_item_id', scheduleId);
  if (error) throw error;
  const label = reason === 'remove' ? '原排期已删除' : '原排期已撤回';
  for (const task of tasks || []) {
    const { count, error: countError } = await client.from('task_steps').select('id', { count: 'exact', head: true }).eq('task_id', task.id);
    if (countError) throw countError;
    if ((count || 0) > 0 || task.status !== 'todo') {
      const { error: updateError } = await client.from('tasks').update({
        source: 'self', schedule_item_id: null, schedule_stage: null, schedule_detached: true,
        schedule_detach_reason: label, title: `${task.title}（${label}）`,
      }).eq('id', task.id);
      if (updateError) throw updateError;
      report.detached.push({ stage: task.schedule_stage, title: task.title, reason: label, steps: count || 0, status: task.status });
    } else {
      const { error: deleteError } = await client.from('tasks').delete().eq('id', task.id);
      if (deleteError) throw deleteError;
      report.removed.push({ stage: task.schedule_stage, title: task.title });
    }
  }
  return report;
}

async function apply(action, payload, auth) {
  const teamId = auth.profile.team_id;
  const adminClient = getAdminClient();
  const userClient = auth.client;
  let syncReport = null;

  if (action.startsWith('create_') || action.startsWith('update_') || action.startsWith('delete_') ||
      action.startsWith('publish_') || action.startsWith('unpublish_')) {
    const memberActions = new Set(['create_self_task', 'update_step', 'delete_step', 'delete_topic']);
    if (!memberActions.has(action)) ensureAdmin(auth);
  }

  switch (action) {
    case 'create_version': {
      const { data } = await adminClient.from('versions').select('sort').eq('team_id', teamId).order('sort', { ascending: false }).limit(1);
      const { error } = await adminClient.from('versions').insert({ team_id: teamId, name: payload.name,
        description: payload.description || '', status: payload.status || 'active', color: payload.color || '#6a7ae0',
        sort: Number(data?.[0]?.sort || 0) + 1 });
      if (error) throw error; break;
    }
    case 'update_version': {
      const { error } = await adminClient.from('versions').update({ name: payload.name, description: payload.description || '',
        status: payload.status || 'active', color: payload.color || '#6a7ae0' }).eq('id', payload.id).eq('team_id', teamId);
      if (error) throw error; break;
    }
    case 'delete_version': {
      const { error } = await adminClient.from('versions').delete().eq('id', payload.id).eq('team_id', teamId);
      if (error) throw error; break;
    }
    case 'create_goal':
    case 'create_milestone':
    case 'create_schedule':
    case 'create_selling_point': {
      const kind = action.slice(7);
      const config = entityConfig(kind);
      const row = { team_id: teamId, published: false };
      for (const field of config.fields) if (field in payload) row[field] = payload[field] || null;
      if ('description' in row && row.description == null) row.description = '';
      if (kind === 'milestone') row.status = payload.status || 'pending';
      const { error } = await adminClient.from(config.table).insert(row);
      if (error) throw error; break;
    }
    case 'update_goal': await adminEntityUpdate(auth, 'goal', payload); break;
    case 'update_milestone': await adminEntityUpdate(auth, 'milestone', payload); break;
    case 'update_schedule': await adminEntityUpdate(auth, 'schedule', payload); break;
    case 'update_selling_point': await adminEntityUpdate(auth, 'selling_point', payload); break;
    case 'publish_goal': await publishEntity(auth, 'goal', payload.id); break;
    case 'publish_milestone': await publishEntity(auth, 'milestone', payload.id); break;
    case 'publish_selling_point': await publishEntity(auth, 'selling_point', payload.id); break;
    case 'publish_schedule': {
      const row = await publishEntity(auth, 'schedule', payload.id);
      syncReport = await syncScheduleTasks(auth, row);
      break;
    }
    case 'unpublish_goal':
    case 'unpublish_milestone':
    case 'unpublish_selling_point':
    case 'unpublish_schedule': {
      const kind = action.slice(10);
      const config = entityConfig(kind);
      if (kind === 'schedule') syncReport = await retireScheduleTasks(auth, payload.id, 'unpublish');
      const { error } = await adminClient.from(config.table).update({ published: false, draft_payload: null }).eq('id', payload.id).eq('team_id', teamId);
      if (error) throw error;
      await clearUpdates(adminClient, kind, payload.id);
      break;
    }
    case 'delete_goal':
    case 'delete_milestone':
    case 'delete_selling_point':
    case 'delete_schedule': {
      const kind = action.slice(7);
      const config = entityConfig(kind);
      if (kind === 'schedule') syncReport = await retireScheduleTasks(auth, payload.id, 'remove');
      await clearUpdates(adminClient, kind, payload.id);
      const { error } = await adminClient.from(config.table).delete().eq('id', payload.id).eq('team_id', teamId);
      if (error) throw error; break;
    }
    case 'set_milestone_status': {
      const client = auth.profile.role === 'admin' ? adminClient : userClient;
      const { error } = await client.from('milestones').update({ status: payload.status }).eq('id', payload.id);
      if (error) throw error; break;
    }
    case 'create_task': {
      const order = await nextTaskOrder(adminClient, payload.assignee_id);
      const { data: task, error } = await adminClient.from('tasks').insert({ team_id: teamId,
        title: payload.title, description: payload.description || '', source: 'assigned', created_by: auth.profile.id,
        assignee_id: payload.assignee_id, version_id: payload.version_id || null, goal_id: payload.goal_id || null,
        milestone_id: payload.milestone_id || null, due_date: cleanDate(payload.due_date), priority: payload.priority ?? 2,
        personal_order: order, status: 'todo' }).select('id').single();
      if (error) throw error;
      if (Array.isArray(payload.steps) && payload.steps.length) {
        const rows = payload.steps.filter(Boolean).map((title, index) => ({ task_id: task.id, title, sort: index + 1 }));
        const { error: stepError } = await adminClient.from('task_steps').insert(rows);
        if (stepError) throw stepError;
      }
      break;
    }
    case 'create_self_task': {
      const order = await nextTaskOrder(userClient, auth.profile.id);
      const { error } = await userClient.from('tasks').insert({ team_id: teamId, title: payload.title,
        description: payload.description || '', source: 'self', created_by: auth.profile.id, assignee_id: auth.profile.id,
        version_id: payload.version_id || null, goal_id: payload.goal_id || null, milestone_id: payload.milestone_id || null,
        due_date: cleanDate(payload.due_date), priority: payload.priority ?? 2, personal_order: order, status: 'todo' });
      if (error) throw error; break;
    }
    case 'update_task': {
      const client = auth.profile.role === 'admin' ? adminClient : userClient;
      const fields = { title: payload.title, description: payload.description || '', version_id: payload.version_id || null,
        goal_id: payload.goal_id || null, milestone_id: payload.milestone_id || null,
        due_date: cleanDate(payload.due_date), priority: payload.priority ?? 2 };
      if (auth.profile.role === 'admin') fields.assignee_id = payload.assignee_id;
      const { error } = await client.from('tasks').update(fields).eq('id', payload.id);
      if (error) throw error; break;
    }
    case 'delete_task': {
      const client = auth.profile.role === 'admin' ? adminClient : userClient;
      const { error } = await client.from('tasks').delete().eq('id', payload.id);
      if (error) throw error; break;
    }
    case 'set_task_status': {
      const completed_at = payload.status === 'done' ? new Date().toISOString() : null;
      const { error } = await userClient.from('tasks').update({ status: payload.status, completed_at }).eq('id', payload.id);
      if (error) throw error; break;
    }
    case 'reorder_tasks': {
      await Promise.all((payload.orderedIds || []).map((id, index) => userClient.from('tasks')
        .update({ personal_order: index + 1 }).eq('id', id).eq('assignee_id', auth.profile.id).then(({ error }) => { if (error) throw error; })));
      break;
    }
    case 'add_step': {
      const { data } = await userClient.from('task_steps').select('sort').eq('task_id', payload.taskId).order('sort', { ascending: false }).limit(1);
      const { error } = await userClient.from('task_steps').insert({ task_id: payload.taskId, title: payload.title,
        sort: Number(data?.[0]?.sort || 0) + 1 });
      if (error) throw error; break;
    }
    case 'update_step': {
      const { error } = await userClient.from('task_steps').update({ title: payload.title }).eq('id', payload.id);
      if (error) throw error; break;
    }
    case 'toggle_step': {
      const { data, error: readError } = await userClient.from('task_steps').select('done').eq('id', payload.id).single();
      if (readError) throw readError;
      const { error } = await userClient.from('task_steps').update({ done: !data.done }).eq('id', payload.id);
      if (error) throw error; break;
    }
    case 'delete_step': {
      const { error } = await userClient.from('task_steps').delete().eq('id', payload.id);
      if (error) throw error; break;
    }
    case 'mark_update_read': {
      const { error } = await userClient.from('update_reads').upsert({ user_id: auth.profile.id, update_id: payload.updateId });
      if (error) throw error; break;
    }
    case 'mark_all_updates_read': {
      const { data, error: readError } = await userClient.from('content_updates').select('id').eq('team_id', teamId);
      if (readError) throw readError;
      if (data?.length) {
        const { error } = await userClient.from('update_reads').upsert(data.map((item) => ({ user_id: auth.profile.id, update_id: item.id })));
        if (error) throw error;
      }
      break;
    }
    case 'save_topic': {
      const { error } = await userClient.from('saved_topics').insert({ team_id: teamId, user_id: auth.profile.id,
        platform: payload.platform, keyword: payload.keyword });
      if (error) throw error; break;
    }
    case 'delete_topic': {
      const { error } = await userClient.from('saved_topics').delete().eq('id', payload.id).eq('user_id', auth.profile.id);
      if (error) throw error; break;
    }
    default: throw new Error(`未知操作: ${action}`);
  }

  const state = await getState(auth);
  if (syncReport) state.syncReport = syncReport;
  return state;
}

async function scheduleImpact(auth, scheduleId) {
  ensureAdmin(auth);
  const client = getAdminClient();
  const { data: tasks, error } = await client.from('tasks').select('*').eq('team_id', auth.profile.team_id).eq('schedule_item_id', scheduleId);
  if (error) throw error;
  const keep = [];
  let willRemove = 0;
  for (const task of tasks || []) {
    const { count, error: countError } = await client.from('task_steps').select('id', { count: 'exact', head: true }).eq('task_id', task.id);
    if (countError) throw countError;
    if ((count || 0) > 0 || task.status !== 'todo') keep.push({ title: task.title, assigneeId: task.assignee_id,
      steps: count || 0, status: task.status });
    else willRemove++;
  }
  return { total: (tasks || []).length, willRemove, willKeep: keep.length, keep };
}

module.exports = { getState, apply, scheduleImpact, shanghaiToday, diffDays };
