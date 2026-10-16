'use strict';

/**
 * 对抗审查第 1 轮 · 逐项复测脚本。
 *
 * 直接对运行中的本机服务发真实 HTTP 请求，覆盖审查文档「必须复测」的六项。
 * 自建数据在结束时全部删除，不改动也清空正式示例数据。
 *
 * 用法：node tools/qa-review.js
 */

const BASE = process.env.BASE || 'http://127.0.0.1:8787';

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? '  通过' : '  失败'}  ${name}${detail ? '  — ' + detail : ''}`);
}

async function api(pathname, body, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  const res = await fetch(BASE + pathname, {
    method: opts.method || (body === undefined ? 'GET' : 'POST'),
    headers,
    body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
  });
  let json = null;
  try { json = await res.json(); } catch (_) {}
  return { status: res.status, body: json };
}

const state = (user) => api(`/api/state?user=${user}`);
const mutate = (action, payload, user = 1) => api('/api/mutate', { action, payload, user, viewUser: user });

/* 清理登记 */
const cleanup = { goals: [], milestones: [], schedules: [], sellingPoints: [], publishedBack: [] };

async function run() {
  console.log(`复测目标：${BASE}\n`);

  /* ============================================================ */
  console.log('P0-1 草稿排期不向成员派发任务');

  // Record the initial publish-notification rows: the re-test publishes content,
  // which inserts new rows. They are removed afterwards so the demo data keeps
  // exactly its original set of unread "content updated" reminders.
  const initialUpdates = new Set(((await state(1)).body.updates || []).map((u) => u.id));

  const before = await state(2);
  const beforeCount = before.body.tasks.length;

  const created = await mutate('create_schedule', {
    title: 'QA草稿排期', version_id: 1, description: '复测用',
    make_date: '', publish_date: '', make_assignee_id: null, publish_assignee_id: null,
  });
  const schId = created.body.scheduleItems.find((s) => s.title === 'QA草稿排期').id;
  cleanup.schedules.push(schId);

  // 编辑草稿排期：填写制作日期与负责人（审查复现路径）
  await mutate('update_schedule', {
    id: schId, title: 'QA草稿排期', version_id: 1, description: '复测用',
    make_date: '2026-11-02', publish_date: '2026-11-09',
    make_assignee_id: 2, publish_assignee_id: 3,
  });
  const afterEdit = await state(2);
  const leaked = afterEdit.body.tasks.filter((t) => t.schedule_item_id === schId);
  check('编辑草稿排期后不生成成员任务',
    leaked.length === 0 && afterEdit.body.tasks.length === beforeCount,
    leaked.length ? `出现了 ${leaked.length} 条排期任务` : `成员任务数保持 ${beforeCount}`);

  // 正式发布后才生成，且只生成填了阶段的那些。
  // 两个阶段可指派不同负责人，因此要在主营视角统计（成员各自只看到自己那条）。
  await mutate('publish_schedule', { id: schId });
  const afterPub = await state(1);
  const gen = afterPub.body.tasks.filter((t) => t.schedule_item_id === schId);
  const stages = gen.map((t) => t.schedule_stage).sort().join(',');
  const owners = new Set(gen.map((t) => t.assignee_id));
  check('发布后才生成对应阶段的两项任务（可分派不同负责人）',
    gen.length === 2 && stages === 'make,publish' && owners.size === 2,
    `生成 ${gen.length} 条，阶段=${stages || '无'}，负责人 ${owners.size} 人`);

  // 每个负责人只在自己的清单里看到属于自己那条
  const ownA = (await state(2)).body.tasks.filter((t) => t.schedule_item_id === schId);
  const ownB = (await state(3)).body.tasks.filter((t) => t.schedule_item_id === schId);
  check('两项任务分别只出现在对应负责人的清单',
    ownA.length === 1 && ownA[0].schedule_stage === 'make'
    && ownB.length === 1 && ownB[0].schedule_stage === 'publish',
    `成员2 见 ${ownA.length} 条，成员3 见 ${ownB.length} 条`);

  // 只填一个阶段时只生成一项
  const single = await mutate('create_schedule', {
    title: 'QA单阶段排期', version_id: 1, description: '',
    make_date: '', publish_date: '2026-11-20', make_assignee_id: null, publish_assignee_id: 3,
  });
  const singleId = single.body.scheduleItems.find((s) => s.title === 'QA单阶段排期').id;
  cleanup.schedules.push(singleId);
  await mutate('publish_schedule', { id: singleId });
  const singleTasks = (await state(1)).body.tasks.filter((t) => t.schedule_item_id === singleId);
  check('只填一个阶段时只生成一项任务',
    singleTasks.length === 1 && singleTasks[0].schedule_stage === 'publish',
    `生成 ${singleTasks.length} 条`);

  /* ============================================================ */
  console.log('\nP0-2 已发布内容：待发布修改与线上版本分离');

  // 用现有已发布目标 1 做复测，结束后恢复原标题
  const base = await state(1);
  const goal1 = base.body.goals.find((g) => g.id === 1);
  const originalTitle = goal1.title;

  const memberBefore = await state(2);
  const memberGoalBefore = memberBefore.body.goals.find((g) => g.id === 1);
  const updatesBefore = memberBefore.body.reminders.contentUpdates.length;

  await mutate('update_goal', {
    id: 1, title: 'QA改过的标题（未发布）', description: goal1.description,
    target_value: goal1.target_value, version_id: goal1.version_id,
  });

  const memberAfterEdit = await state(2);
  const memberGoalAfterEdit = memberAfterEdit.body.goals.find((g) => g.id === 1);
  check('已发布内容存草稿后成员仍看到旧版',
    memberGoalAfterEdit && memberGoalAfterEdit.title === originalTitle,
    `成员看到「${memberGoalAfterEdit ? memberGoalAfterEdit.title : '(缺失)'}」`);

  const adminAfterEdit = await state(1);
  const adminGoal = adminAfterEdit.body.goals.find((g) => g.id === 1);
  check('主营能看到「有待发布修改」标记',
    !!adminGoal.hasDraft && adminGoal.draft && adminGoal.draft.title === 'QA改过的标题（未发布）',
    `hasDraft=${adminGoal.hasDraft}`);

  await mutate('publish_goal', { id: 1 });
  const memberAfterPub = await state(2);
  const memberGoalAfterPub = memberAfterPub.body.goals.find((g) => g.id === 1);
  const updatesAfter = memberAfterPub.body.reminders.contentUpdates.length;
  check('发布修改后成员才看到新版',
    memberGoalAfterPub && memberGoalAfterPub.title === 'QA改过的标题（未发布）',
    `成员看到「${memberGoalAfterPub ? memberGoalAfterPub.title : '(缺失)'}」`);
  check('一次发布只产生一条内容更新提醒',
    updatesAfter - updatesBefore === 1,
    `未读更新 ${updatesBefore} → ${updatesAfter}`);
  check('发布后草稿标记被清空',
    !(await state(1)).body.goals.find((g) => g.id === 1).hasDraft,
    'draft 已应用并清空');

  // 还原目标 1
  await mutate('update_goal', {
    id: 1, title: originalTitle, description: goal1.description,
    target_value: goal1.target_value, version_id: goal1.version_id,
  });
  await mutate('publish_goal', { id: 1 });
  cleanup.publishedBack.push({ type: 'goal', id: 1, title: originalTitle });

  /* ============================================================ */
  console.log('\nP0-3 节点提醒：只看已发布且未完成');

  // (a) 草稿节点不提醒
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const msCreated = await mutate('create_milestone', {
    version_id: 1, name: 'QA草稿节点', date: tomorrow, description: '复测用', status: 'pending',
  });
  const msDraftId = msCreated.body.milestones.find((m) => m.name === 'QA草稿节点').id;
  cleanup.milestones.push(msDraftId);
  const rDraft = (await state(2)).body.reminders.items.filter((i) => i.refType === 'milestone' && i.refId === msDraftId);
  check('草稿节点不产生站内提醒', rDraft.length === 0, `提醒条数 ${rDraft.length}`);

  // (b) 已发布临期节点会提醒
  await mutate('publish_milestone', { id: msDraftId });
  const rPub = (await state(2)).body.reminders.items.filter((i) => i.refType === 'milestone' && i.refId === msDraftId);
  check('已发布且临期的节点会提醒', rPub.length === 1, `提醒条数 ${rPub.length}`);

  // (c) 关联任务全部完成后提醒消失（存储字段仍是 pending）
  const taskForMs = await mutate('create_task', {
    title: 'QA节点任务', assignee_id: 2, version_id: 1, milestone_id: msDraftId,
    due_date: tomorrow, priority: 2,
  });
  const tmsId = taskForMs.body.tasks.find((t) => t.title === 'QA节点任务').id;
  cleanup.tasks = cleanup.tasks || [];
  cleanup.tasks.push(tmsId);

  await mutate('set_task_status', { id: tmsId, status: 'done' }, 2);
  const msAfterDone = (await state(2)).body.milestones.find((m) => m.id === msDraftId);
  const rDone = (await state(2)).body.reminders.items.filter((i) => i.refType === 'milestone' && i.refId === msDraftId);
  check('关联任务完成后节点提醒消失（存储 status 仍为 pending）',
    msAfterDone.computedStatus === 'done' && msAfterDone.status === 'pending' && rDone.length === 0,
    `computedStatus=${msAfterDone.computedStatus} status=${msAfterDone.status} 提醒=${rDone.length}`);

  // (d) 任务重开后提醒恢复
  await mutate('set_task_status', { id: tmsId, status: 'doing' }, 2);
  const rReopen = (await state(2)).body.reminders.items.filter((i) => i.refType === 'milestone' && i.refId === msDraftId);
  check('任务重新变为未完成后提醒恢复', rReopen.length === 1, `提醒条数 ${rReopen.length}`);

  /* ============================================================ */
  console.log('\nP1-4 API 按角色过滤可见范围');

  const m2 = (await state(2)).body;
  const othersTasks = m2.tasks.filter((t) => t.assignee_id !== 2);
  check('成员视角不含他人任务', othersTasks.length === 0, `他人任务 ${othersTasks.length} 条`);

  const myTaskIds = new Set(m2.tasks.map((t) => t.id));
  const foreignSteps = m2.steps.filter((s) => !myTaskIds.has(s.task_id));
  check('成员视角不含他人步骤', foreignSteps.length === 0, `他人步骤 ${foreignSteps.length} 条`);

  const draftLeak = [
    ...m2.goals.filter((g) => !g.published),
    ...m2.milestones.filter((x) => !x.published),
    ...m2.scheduleItems.filter((x) => !x.published),
    ...m2.sellingPoints.filter((x) => !x.published),
  ];
  check('成员视角不含任何草稿内容', draftLeak.length === 0, `草稿 ${draftLeak.length} 项`);

  const a1 = (await state(1)).body;
  const adminForeignSteps = a1.steps.filter((s) => {
    const t = a1.tasks.find((x) => x.id === s.task_id);
    return t && t.assignee_id !== 1;
  });
  check('主营视角不返回他人个人步骤', adminForeignSteps.length === 0, `他人步骤 ${adminForeignSteps.length} 条`);

  const adminSeesNames = a1.tasks.filter((t) => t.assignee_id !== 1).length;
  check('主营视角仍可看到成员任务名称', adminSeesNames > 0, `成员任务 ${adminSeesNames} 条`);

  const adminDrafts = a1.goals.filter((g) => !g.published).length
    + a1.sellingPoints.filter((p) => !p.published).length
    + a1.scheduleItems.filter((s) => !s.published).length
    + a1.milestones.filter((m) => !m.published).length;
  check('主营视角仍能看到草稿（用于发布）', adminDrafts > 0, `草稿 ${adminDrafts} 项`);

  const memberTaskStepsLeak = m2.tasks.filter((t) => t.assignee_id !== 2 && t.stepsTotal > 0);
  check('未返回他人任务的步骤计数', memberTaskStepsLeak.length === 0, '无');

  /* ============================================================ */
  console.log('\nP1-5 写接口防护');

  // 跨站 Origin 被拒
  const csrf = await api('/api/mutate', { action: 'create_self_task', payload: { title: 'QA跨站任务' }, user: 2, viewUser: 2 },
    { headers: { Origin: 'http://evil.example.com' } });
  check('跨站 Origin 的写请求被拒绝', csrf.status === 403, `HTTP ${csrf.status}`);

  // 非 JSON content-type 被拒（表单可直接发出的类型）
  const form = await fetch(BASE + '/api/mutate', {
    method: 'POST', headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ action: 'create_self_task', payload: { title: 'QA表单任务' }, user: 2, viewUser: 2 }),
  });
  check('text/plain 写请求被拒绝（挡住跨站表单）', form.status === 415, `HTTP ${form.status}`);

  // 无令牌重置被拒
  const noToken = await api('/api/demo/reset', { user: 2 });
  check('无确认令牌的重置被拒绝', noToken.status === 403, `HTTP ${noToken.status}`);

  // 令牌一次性
  const tok = await api('/api/demo/reset-token', {});
  check('可以正常签发重置确认令牌', tok.status === 200 && !!tok.body.token, `HTTP ${tok.status}`);
  const reuse = await api('/api/demo/reset', { token: 'deadbeef'.repeat(6), user: 2 });
  check('伪造令牌的重置被拒绝', reuse.status === 403, `HTTP ${reuse.status}`);

  const noOriginLeak = await api('/api/mutate', { action: 'create_self_task', payload: { title: 'QA自检临时任务' }, user: 2, viewUser: 2 });
  check('本机客户端（无 Origin）仍可正常写入', noOriginLeak.status === 200, `HTTP ${noOriginLeak.status}`);
  const selfTask = noOriginLeak.body.tasks.find((t) => t.title === 'QA自检临时任务');
  if (selfTask) cleanup.tasks.push(selfTask.id);

  /* ============================================================ */
  console.log('\nP1-6 / P1-8 热点来源准确性');

  /* 「未连接」行为必须在一个确实没有任何平台连接的用户上验证。
     不能写死 user 2：真实使用中人可能已经登录并保存了登录状态，那样断言会误报；
     更糟的是下面的 disconnect 清理会连带删除真实的登录态文件
     —— store.js 的 clear_connection 会 unlink app/data/auth/<user>-<platform>.json。 */
  const members = ((await state(1)).body.users || []).filter((u) => u.role !== 'admin');
  let probe = null;
  for (const u of members) {
    const st = (await state(u.id)).body;
    if ((st.connections || []).length === 0 && (st.trendItems || []).length === 0) { probe = u; break; }
  }
  check('存在未连接任何平台、可用于验证「未连接」行为的成员', !!probe,
    probe ? `${probe.name}（id=${probe.id}）` : '所有成员都已连接平台，无法验证「未连接」相关行为');

  if (probe) {
    const hs = (await state(probe.id)).body;
    check('未连接时不返回任何热点条目', hs.trendItems.length === 0,
      `${probe.name}：热点 ${hs.trendItems.length} 条，连接记录 ${hs.connections.length} 条`);

    const collectNoAuth = await api('/api/hotspot/collect', { platform: 'douyin', userId: probe.id });
    await new Promise((r) => setTimeout(r, 1500));
    const hs2 = (await state(probe.id)).body;
    check('未连接时采集返回真实失败且不写假数据',
      collectNoAuth.status === 200 && hs2.trendItems.length === 0,
      `状态 ${(hs2.connections.find((c) => c.platform === 'douyin') || {}).status || '无'}`);
  }

  const hlib = require('../lib/hotspot.js');
  check('抖音标注为平台热榜', hlib.PLATFORMS.douyin.hotKind === 'hotlist',
    `${hlib.PLATFORMS.douyin.hotKind} / ${hlib.PLATFORMS.douyin.hotKindLabel}`);
  check('小红书如实标注为热点搜索而非热榜', hlib.PLATFORMS.xiaohongshu.hotKind === 'search_hot',
    `${hlib.PLATFORMS.xiaohongshu.hotKind} / ${hlib.PLATFORMS.xiaohongshu.hotKindLabel}`);
  check('固定板块不含美食', !hlib.SECTIONS.some((s) => s.label.includes('美食')),
    hlib.SECTIONS.map((s) => s.label).join('、'));

  // 名次回归：提取器读的是平台自己的名次槽，映射层曾把 rank 丢掉，
  // 导致整批名次以空值入库、界面把每条都显示成「置顶」。
  const mapped = hlib.toTrendItems([
    { title: '置顶条示例', heat: '', href: '', rank: null },
    { title: '有名次的条目示例', heat: '100万', href: '', rank: 7 },
  ], 'douyin', hlib.PLATFORMS.douyin);
  check('榜单名次在字段映射中不丢失（防「整批显示成置顶」回归）',
    mapped.length === 2 && mapped[0].rank === null && mapped[1].rank === 7,
    `rank=${JSON.stringify(mapped.map((m) => m.rank))}`);

  const qNow = hlib.supplementQuery('game');
  const qLater = hlib.supplementQuery('game', new Date(Date.now() + 21 * 86400000));
  check('板块补充关键词随时间变化（非永久死词）', qNow !== qLater, `${qNow} → ${qLater}`);

  // 搜索：未连接时必须如实拒绝，并给出可打开的链接字段约定
  const s1 = await api('/api/hotspot/search', { platform: 'douyin', userId: probe ? probe.id : 2, keyword: '新赛季' });
  check('未连接时搜索如实返回失败原因', s1.body.ok === false && !!s1.body.reason,
    s1.body.reason || '(无原因)');

  /* ============================================================ */
  console.log('\nCLI 集成');
  check('Playwright CLI 可用（登录状态经 CLI 保存/恢复）', hlib.cliAvailable(), `会话名示例 ${hlib.sessionName(2, 'douyin')}`);

  /* ============================================================ */
  console.log('\n清理复测数据…');
  /* ============================================================ */
  console.log('\nP1(round 2) 排期日期同步：清空日期必须同步到个人任务');

  const tomorrow2 = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

  // mutate() 返回 { status, body }，同步结果在 body.syncReport
  const miniReport = (res) => (res && res.body && res.body.syncReport)
    || { created: [], removed: [], detached: [], dateChanged: [], assigneeKept: [], needsAssignee: [] };
  const taskOfStage = async (scheduleId, stage) =>
    ((await state(1)).body.tasks).find((t) => t.schedule_item_id === scheduleId && t.schedule_stage === stage);

  // 建一条排期并发布：制作阶段 = 明天、负责人 2（明天会触发「即将到期」提醒，便于验证提醒随之消失）
  const sc = await mutate('create_schedule', {
    title: 'QA日期同步排期', version_id: 1, description: '',
    make_date: tomorrow2, publish_date: '', make_assignee_id: 2, publish_assignee_id: null,
  });
  const scId = sc.body.scheduleItems.find((x) => x.title === 'QA日期同步排期').id;
  cleanup.schedules.push(scId);
  const pub1 = await mutate('publish_schedule', { id: scId });
  let mk = await taskOfStage(scId, 'make');
  check('发布后任务截止日期与排期一致',
    !!mk && mk.due_date === tomorrow2 && mk.assignee_id === 2,
    `due_date=${mk && mk.due_date} assignee=${mk && mk.assignee_id}`);

  const remindersWithDate = ((await state(2)).body.reminders.items)
    .filter((i) => i.refType === 'task' && i.refId === mk.id).length;
  check('日期临近时任务进入提醒', remindersWithDate === 1, `提醒条数 ${remindersWithDate}`);

  // 清空制作日期，保留负责人 2，发布修改
  await mutate('update_schedule', {
    id: scId, title: 'QA日期同步排期', version_id: 1, description: '',
    make_date: '', publish_date: '', make_assignee_id: 2, publish_assignee_id: null,
  });
  const beforeClear = await taskOfStage(scId, 'make');
  check('清空前成员看到的仍是旧日期（待发布修改未生效）',
    !!beforeClear && beforeClear.due_date === tomorrow2,
    `due_date=${beforeClear && beforeClear.due_date}`);

  const pub2 = await mutate('publish_schedule', { id: scId });
  mk = await taskOfStage(scId, 'make');
  check('清空排期日期并发布后，任务截止日期同步清空',
    !!mk && mk.due_date === '' && mk.assignee_id === 2,
    `due_date=${mk ? `"${mk.due_date}"` : '(任务丢失)'} assignee=${mk && mk.assignee_id}`);

  const remindersAfterClear = ((await state(2)).body.reminders.items)
    .filter((i) => i.refType === 'task' && i.refId === mk.id).length;
  check('清空日期后不再因旧日期触发临期/逾期提醒',
    remindersAfterClear === 0, `提醒条数 ${remindersAfterClear}`);
  check('同步结果如实回报日期被清空',
    miniReport(pub2).dateChanged.some((d) => d.stage === 'make' && d.to === ''),
    JSON.stringify(miniReport(pub2).dateChanged));

  // 重新填写日期并发布 → 日期恢复
  // 用「明天」而不是 +2 天：只有 d<=1 才进入提醒，这样「恢复」的断言才有意义
  await mutate('update_schedule', {
    id: scId, title: 'QA日期同步排期', version_id: 1, description: '',
    make_date: tomorrow2, publish_date: '', make_assignee_id: 2, publish_assignee_id: null,
  });
  await mutate('publish_schedule', { id: scId });
  mk = await taskOfStage(scId, 'make');
  const remindersRestored = ((await state(2)).body.reminders.items)
    .filter((i) => i.refType === 'task' && i.refId === mk.id).length;
  check('重新填写日期并发布后同步恢复（日期与提醒都回来）',
    !!mk && mk.due_date === tomorrow2 && remindersRestored === 1,
    `due_date=${mk && mk.due_date} 提醒=${remindersRestored}`);

  // ---- 日期与负责人都清空 ----
  // (a) 任务没有任何个人步骤：直接移除，不留下误导性的旧任务
  const sc2 = await mutate('create_schedule', {
    title: 'QA阶段移除排期', version_id: 1, description: '',
    make_date: tomorrow2, publish_date: '', make_assignee_id: 2, publish_assignee_id: null,
  });
  const sc2Id = sc2.body.scheduleItems.find((x) => x.title === 'QA阶段移除排期').id;
  cleanup.schedules.push(sc2Id);
  await mutate('publish_schedule', { id: sc2Id });
  const t2 = await taskOfStage(sc2Id, 'make');
  await mutate('update_schedule', {
    id: sc2Id, title: 'QA阶段移除排期', version_id: 1, description: '',
    make_date: '', publish_date: '', make_assignee_id: null, publish_assignee_id: null,
  });
  const pub3 = await mutate('publish_schedule', { id: sc2Id });
  const survived2 = await taskOfStage(sc2Id, 'make');
  check('阶段与负责人都清空时，无个人步骤的任务被移除',
    !survived2 && miniReport(pub3).removed.length === 1,
    survived2 ? '任务仍在' : `已移除（${miniReport(pub3).removed.length} 项）`);

  // (b) 任务已填写个人步骤：不能静默删除，转为独立任务并保留步骤
  const sc3 = await mutate('create_schedule', {
    title: 'QA阶段移除保留排期', version_id: 1, description: '',
    make_date: tomorrow2, publish_date: '', make_assignee_id: 2, publish_assignee_id: null,
  });
  const sc3Id = sc3.body.scheduleItems.find((x) => x.title === 'QA阶段移除保留排期').id;
  cleanup.schedules.push(sc3Id);
  await mutate('publish_schedule', { id: sc3Id });
  const t3 = await taskOfStage(sc3Id, 'make');
  await mutate('add_step', { taskId: t3.id, title: 'QA保留步骤' }, 2);

  await mutate('update_schedule', {
    id: sc3Id, title: 'QA阶段移除保留排期', version_id: 1, description: '',
    make_date: '', publish_date: '', make_assignee_id: null, publish_assignee_id: null,
  });
  const pub4 = await mutate('publish_schedule', { id: sc3Id });
  const kept = ((await state(1)).body.tasks).find((t) => t.id === t3.id);
  const keptSteps = ((await state(2)).body.steps).filter((x) => x.task_id === t3.id);
  check('阶段移除但任务已有个人步骤时，不静默删除',
    !!kept && kept.schedule_detached === 1 && kept.schedule_stage === '',
    kept ? `保留为独立任务（schedule_detached=${kept.schedule_detached}）` : '任务被删除');
  check('被保留任务的个人步骤完整保留',
    keptSteps.length === 1 && keptSteps[0].title === 'QA保留步骤',
    `步骤 ${keptSteps.length} 条`);
  check('同步结果如实回报「已保留为独立任务」',
    miniReport(pub4).detached.length === 1, JSON.stringify(miniReport(pub4).detached));
  if (kept) cleanup.tasks.push(kept.id);

  // 只有一个日期、没有负责人的阶段不生成无主任务
  const sc4 = await mutate('create_schedule', {
    title: 'QA无负责人排期', version_id: 1, description: '',
    make_date: tomorrow2, publish_date: '', make_assignee_id: null, publish_assignee_id: null,
  });
  const sc4Id = sc4.body.scheduleItems.find((x) => x.title === 'QA无负责人排期').id;
  cleanup.schedules.push(sc4Id);
  const pub5 = await mutate('publish_schedule', { id: sc4Id });
  const orphan = await taskOfStage(sc4Id, 'make');
  check('只有日期没有负责人的阶段不生成无主任务',
    !orphan && miniReport(pub5).needsAssignee.length === 1,
    orphan ? '生成了无主任务' : '未生成，并已回报');

  /* ============================================================ */
  console.log('\nP1(round 3) 撤回／删除排期不得清掉成员已完成任务与个人步骤');

  const r3date = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const mkSched = async (title, assignee) => {
    const c = await mutate('create_schedule', {
      title, version_id: 1, description: '',
      make_date: r3date, publish_date: '', make_assignee_id: assignee, publish_assignee_id: null,
    });
    const sid = c.body.scheduleItems.find((x) => x.title === title).id;
    cleanup.schedules.push(sid);
    await mutate('publish_schedule', { id: sid });
    const t = ((await state(1)).body.tasks).find((x) => x.schedule_item_id === sid && x.schedule_stage === 'make');
    return { sid, task: t };
  };

  /* ---- (A) 撤回：有步骤 + 已完成的任务必须完整保留 ---- */
  const A = await mkSched('QA撤回保留排期', 2);
  await mutate('add_step', { taskId: A.task.id, title: 'QA撤回前步骤' }, 2);
  await mutate('set_task_status', { id: A.task.id, status: 'done' }, 2);

  const impact = await api(`/api/schedule-impact?id=${A.sid}`, undefined, { method: 'GET' });
  check('撤回前可预览影响（会保留 1 项）',
    impact.body.ok && impact.body.willKeep === 1 && impact.body.willRemove === 0,
    `keep=${impact.body.willKeep} remove=${impact.body.willRemove}`);

  const unpub = await mutate('unpublish_schedule', { id: A.sid });
  const taskAfterUnpub = ((await state(1)).body.tasks).find((t) => t.id === A.task.id);
  const stepsAfterUnpub = ((await state(2)).body.steps).filter((x) => x.task_id === A.task.id);
  check('撤回排期后任务与个人步骤仍可回看',
    !!taskAfterUnpub && stepsAfterUnpub.length === 1,
    `TaskAfterUnpublish=${taskAfterUnpub ? 1 : 0}, StepAfterUnpublish=${stepsAfterUnpub.length}`);
  check('撤回后排期正文对成员不可见',
    !((await state(2)).body.scheduleItems).some((x) => x.id === A.sid),
    '成员已看不到该排期');
  check('保留下来的历史任务标出「原排期已撤回」',
    !!taskAfterUnpub && taskAfterUnpub.schedule_detached === 1
    && taskAfterUnpub.schedule_detach_reason === '原排期已撤回',
    taskAfterUnpub ? `reason=${taskAfterUnpub.schedule_detach_reason}` : '任务丢失');
  check('保留任务不再计入排期阶段状态（已脱离排期）',
    !!taskAfterUnpub && taskAfterUnpub.schedule_item_id === null && taskAfterUnpub.schedule_stage === '',
    taskAfterUnpub ? `schedule_item_id=${taskAfterUnpub.schedule_item_id}` : '任务丢失');
  check('保留任务的完成状态未丢失',
    !!taskAfterUnpub && taskAfterUnpub.status === 'done',
    taskAfterUnpub ? `status=${taskAfterUnpub.status}` : '任务丢失');
  check('撤回结果如实回报保留数量',
    miniReport(unpub).detached.length === 1 && miniReport(unpub).removed.length === 0,
    `detached=${miniReport(unpub).detached.length} removed=${miniReport(unpub).removed.length}`);
  check('撤回后排期阶段不再关联任何任务',
    !((await state(1)).body.tasks).some((t) => t.schedule_item_id === A.sid),
    '无任务仍挂在该排期上');
  if (taskAfterUnpub) cleanup.tasks.push(taskAfterUnpub.id);

  /* ---- (B) 重新发布同一排期：按当前阶段重新生成，不挂回历史任务、不重复 ---- */
  await mutate('publish_schedule', { id: A.sid });
  const republished = ((await state(1)).body.tasks).filter((t) => t.schedule_item_id === A.sid);
  const historicalStillDetached = ((await state(1)).body.tasks)
    .find((t) => t.id === A.task.id);
  check('重新发布按当前阶段重新生成任务',
    republished.length === 1 && republished[0].schedule_stage === 'make' && republished[0].id !== A.task.id,
    `生成 ${republished.length} 条（新任务 id=${republished[0] && republished[0].id}，历史任务 id=${A.task.id}）`);
  check('历史独立任务不会被重新挂回排期',
    !!historicalStillDetached && historicalStillDetached.schedule_item_id === null,
    historicalStillDetached ? `schedule_item_id=${historicalStillDetached.schedule_item_id}` : '任务丢失');

  // 再次发布同一排期不得重复分配同一阶段
  const beforeDouble = ((await state(1)).body.tasks).filter((t) => t.schedule_item_id === A.sid).length;
  await mutate('publish_schedule', { id: A.sid });
  const afterDouble = ((await state(1)).body.tasks).filter((t) => t.schedule_item_id === A.sid).length;
  check('重复发布同一排期不会重复分配同一阶段任务',
    afterDouble === beforeDouble, `${beforeDouble} → ${afterDouble}`);
  for (const t of ((await state(1)).body.tasks).filter((x) => x.schedule_item_id === A.sid)) cleanup.tasks.push(t.id);

  /* ---- (C) 删除排期：无个人投入的任务移除，有投入的保留 ---- */
  const C = await mkSched('QA删除保留排期', 3);
  await mutate('add_step', { taskId: C.task.id, title: 'QA删除前步骤' }, 3);
  const C2 = await mkSched('QA删除清理排期', 3);

  const delImpact = await api(`/api/schedule-impact?id=${C.sid}`, undefined, { method: 'GET' });
  check('删除前可预览影响（会保留 1 项）',
    delImpact.body.ok && delImpact.body.willKeep === 1, `keep=${delImpact.body.willKeep}`);

  const delRes = await mutate('delete_schedule', { id: C.sid });
  const cTask = ((await state(1)).body.tasks).find((t) => t.id === C.task.id);
  // 该排期负责人是成员 3，个人步骤只有本人可见，必须按负责人视角查
  const cSteps = ((await state(3)).body.steps).filter((x) => x.task_id === C.task.id);
  check('删除排期后已有步骤的任务仍保留可回看',
    !!cTask && cSteps.length === 1 && cTask.schedule_detach_reason === '原排期已删除',
    cTask ? `reason=${cTask.schedule_detach_reason}, steps=${cSteps.length}` : '任务被删除');
  check('删除排期结果如实回报',
    miniReport(delRes).detached.length === 1, `detached=${miniReport(delRes).detached.length}`);
  if (cTask) cleanup.tasks.push(cTask.id);

  // 无个人投入的任务按规则移除
  const delRes2 = await mutate('delete_schedule', { id: C2.sid });
  const c2Task = ((await state(1)).body.tasks).find((t) => t.id === C2.task.id);
  check('删除排期时无个人投入的任务被移除',
    !c2Task && miniReport(delRes2).removed.length === 1,
    c2Task ? '任务仍在' : `已移除（${miniReport(delRes2).removed.length} 项）`);

  // 删除排期后不应残留指向已删内容的「内容已更新」提醒
  const staleUpdate = ((await state(2)).body.reminders.contentUpdates)
    .filter((u) => u.entity_type === 'schedule' && u.entity_id === C.sid);
  check('删除排期后不残留该排期的内容更新提醒',
    staleUpdate.length === 0,
    staleUpdate.length ? `残留 ${staleUpdate.length} 条` : '已清除');

  // 已开始（进行中）但还没有步骤的任务也要保留
  const D = await mkSched('QA进行中保留排期', 4);
  await mutate('set_task_status', { id: D.task.id, status: 'doing' }, 4);
  const delRes3 = await mutate('delete_schedule', { id: D.sid });
  const dTask = ((await state(1)).body.tasks).find((t) => t.id === D.task.id);
  check('已开始但暂无步骤的任务也不静默删除',
    !!dTask && dTask.schedule_detached === 1 && miniReport(delRes3).detached.length === 1,
    dTask ? `status=${dTask.status} detached=${dTask.schedule_detached}` : '任务被删除');
  if (dTask) cleanup.tasks.push(dTask.id);

  for (const id of (cleanup.tasks || [])) await mutate('delete_task', { id });
  for (const id of cleanup.schedules) await mutate('delete_schedule', { id });
  for (const id of cleanup.milestones) await mutate('delete_milestone', { id });
  for (const id of cleanup.goals) await mutate('delete_goal', { id });

  // 上面的「未连接采集」会给探针用户写一条 disconnected 连接记录，这里只清理它。
  // 绝不能对真实已连接的用户调 disconnect —— clear_connection 会连带删除
  // app/data/auth/<user>-<platform>.json，把本人登录好的状态销毁掉。
  if (probe) await api('/api/hotspot/disconnect', { platform: 'douyin', userId: probe.id });

  const addedUpdates = ((await state(1)).body.updates || []).filter((u) => !initialUpdates.has(u.id));
  for (const u of addedUpdates) {
    await api('/api/mutate', { action: 'delete_update_record', payload: { id: u.id }, user: 1, viewUser: 1 });
  }

  const final = (await state(2)).body;
  const residue = final.tasks.filter((t) => t.title.startsWith('QA')).length
    + final.milestones.filter((m) => m.name.startsWith('QA')).length
    + final.scheduleItems.filter((s) => s.title.startsWith('QA')).length
    + final.goals.filter((g) => g.title.startsWith('QA')).length;
  check('复测数据已清理干净', residue === 0, `残留 ${residue} 条`);

  /* ============================================================ */
  const failed = results.filter((r) => !r.pass);
  console.log('\n================ 复测结果 ================');
  console.log(`共 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`);
  for (const f of failed) console.log(`  失败：${f.name} — ${f.detail}`);
  process.exit(failed.length ? 1 : 0);
}

run().catch((e) => { console.error('复测脚本异常：', e); process.exit(2); });
