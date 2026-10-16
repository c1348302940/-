/* 主营总台：核心目标、本月排期、版本卖点、版本节点的草稿与发布入口 */

import { esc, ICON, md, emptyState, toast, ymdCn } from '../util.js';
import { store, isAdmin, mutate, versionById, userById } from '../api.js';
import {
  openModal, closeModal, confirmModal, field, versionOptions, userOptions,
  selectOptions, SOURCE_TEXT, progressBar,
} from '../ui.js';
import { go, render as renderApp } from '../shell.js';
import { authFetch } from '../auth.js';
import { openScheduleModal } from './schedule.js';
import { openBatchContentModal } from '../batch-content.js';
import * as teamboard from './teamboard.js';
import * as accountsPage from './accounts.js';

export const keepScroll = true;

function sectionTabs() {
  const current = store.ui.adminSection || 'content';
  return `<div class="seg admin-sections" role="tablist" aria-label="主营总台板块">
    <button role="tab" aria-selected="${current === 'content'}" class="${current === 'content' ? 'on' : ''}" data-act="admin-section" data-section="content">内容管理</button>
    <button role="tab" aria-selected="${current === 'team'}" class="${current === 'team' ? 'on' : ''}" data-act="admin-section" data-section="team">团队看台</button>
    <button role="tab" aria-selected="${current === 'accounts'}" class="${current === 'accounts' ? 'on' : ''}" data-act="admin-section" data-section="accounts">账号管理</button>
  </div>`;
}

export function render() {
  const s = store.state;
  const drafts = collectDrafts();
  const admin = isAdmin();

  if (!admin) return `<div class="page-head"><h1 class="page-title">主营总台</h1></div>
    <div class="banner warn">${ICON.lock}<span>主营总台仅在主营视角开放。</span></div>`;

  if (store.ui.adminSection === 'team') return `<div class="page-head">
    <h1 class="page-title">主营总台</h1>
    <p class="page-sub">统一维护团队需要的版本信息，并查看成员工作进度。</p>
  </div>${sectionTabs()}${teamboard.render({ embedded: true })}`;

  if (store.ui.adminSection === 'accounts') return `<div class="page-head">
    <h1 class="page-title">主营总台</h1>
    <p class="page-sub">创建成员用户名、重置密码，以及停用或恢复账号。</p>
  </div>${sectionTabs()}${accountsPage.render()}`;

  return `
    <div class="page-head">
      <h1 class="page-title">主营总台</h1>
      <p class="page-sub">统一维护团队需要的版本信息，发布后成员可见。</p>
    </div>

    ${sectionTabs()}

    <div class="card" style="margin-bottom:16px">
      <div class="card-head" style="background:var(--blue-soft);border-bottom-color:var(--blue-line)">
        ${ICON.inbox}
        <h3 style="color:#23478f">待发布 ${drafts.length} 项</h3>
        <span class="spacer"></span>
        <button class="btn dark" data-act="publish-check" ${drafts.length === 0 ? 'disabled' : ''}>检查并发布</button>
      </div>
      <div class="card-body" style="font-size:var(--fs-sm);color:var(--text-3)">
        请检查内容，确认无误后发布，成员工作台将同步显示，并产生「内容已更新」提醒。
        新草稿对成员完全不可见；已发布内容上的修改在你点「发布」之前，成员看到的仍是旧版本。
      </div>
    </div>

    <div class="grid-half">
      ${goalCard()}
      ${scheduleCard()}
      ${sellingPointCard()}
      ${milestoneCard()}
    </div>

    <div class="section-title">任务分配</div>
    ${taskCard()}

    <div class="section-title">版本管理</div>
    ${versionCard()}

    <div style="margin-top:18px;display:flex;align-items:center;gap:8px;color:var(--text-3);font-size:var(--fs-sm)">
      ${ICON.bell} 发布更新后，成员工作台显示内容更新提醒。切换到上方「团队看台」可只读查看成员的任务与步骤进度。
    </div>`;
}

export function afterRender(root) {
  if (store.ui.adminSection === 'team') teamboard.afterRender(root);
  if (store.ui.adminSection === 'accounts') accountsPage.afterRender(root);
}

/* ---------------- 草稿统计 ---------------- */

/**
 * 待发布项包含两类：
 *   new  —— 从未发布过的草稿（成员完全看不到）
 *   edit —— 已发布内容上积累的待发布修改（成员当前仍看到旧版本）
 */
function collectDrafts() {
  const s = store.state;
  const out = [];
  const push = (type, id, title, label, published, hasDraft) => {
    if (!published) out.push({ type, id, title, label, kind: 'new' });
    else if (hasDraft) out.push({ type, id, title, label, kind: 'edit' });
  };
  for (const g of s.goals) push('goal', g.id, g.title, '工作核心目标', g.published, g.hasDraft);
  for (const it of s.scheduleItems) push('schedule', it.id, it.title, '本月排期', it.published, it.hasDraft);
  for (const p of s.sellingPoints) push('selling_point', p.id, p.title, '版本卖点', p.published, p.hasDraft);
  for (const m of s.milestones) push('milestone', m.id, m.name, '版本节点', m.published, m.hasDraft);
  return out;
}

/**
 * 把排期同步结果翻译成主营能看懂的一句话。
 * 阶段被移除、任务被保留或删除、日期被清空都必须如实说明，不能只回一句「已发布」。
 */
function syncReportMessage(r) {
  if (!r) return '已发布';
  const parts = [];
  if (r.created.length) parts.push(`生成 ${r.created.length} 项任务`);
  for (const d of r.dateChanged) {
    parts.push(`${d.stageLabel}截止日期${d.to ? '改为 ' + d.to : '已清空（不再触发临期提醒）'}`);
  }
  if (r.removed.length) parts.push(`移除 ${r.removed.length} 项尚未开始且无步骤的任务`);
  if (r.detached.length) {
    parts.push(r.detached.map((x) => `「${x.title}」${x.reason || '阶段已移除'}，因已有步骤或已开始，已保留为独立历史任务`).join('；'));
  }
  if (r.assigneeKept.length) {
    parts.push(`${r.assigneeKept.map((x) => x.stageLabel).join('、')}仍有日期但未指定负责人，已保留原负责人`);
  }
  if (r.needsAssignee.length) {
    parts.push(`${r.needsAssignee.map((x) => x.stageLabel).join('、')}只有日期没有负责人，未生成任务（一个任务必须有负责人）`);
  }
  return parts.length ? '已发布：' + parts.join('；') : '已发布，任务无变化';
}

/** 编辑时优先载入待发布修改，避免主营看不到自己上次改了什么 */
function editSource(item) {
  if (!item) return item;
  return item.draft ? { ...item, ...item.draft, id: item.id } : item;
}

/* ---------------- 模块卡片 ---------------- */

function moduleCard(icon, title, actionLabel, actionAct, rows, emptyTitle, emptyDesc) {
  return `<div class="card">
    <div class="card-head">
      ${ICON[icon]}
      <h3>${title}</h3>
      <span class="spacer"></span>
      <button class="btn sm ghost" data-act="${actionAct}">${ICON.plus} ${actionLabel}</button>
    </div>
    ${rows.length === 0
      ? emptyState(emptyTitle, emptyDesc, '', icon)
      : `<div>${rows.join('')}</div>`}
  </div>`;
}

function badge(published) {
  return published
    ? '<span class="pill green">已发布</span>'
    : '<span class="pill gray">草稿</span>';
}

function itemRow({ title, meta, published, editAct, id, deleteAct, publishAct, extra, hasDraft }) {
  const admin = isAdmin();
  return `<div class="pub-item ${admin ? 'editable' : ''}">
    <div class="pub-item-main">
      <div class="p-title">${esc(title)}</div>
      <div class="p-meta">${meta}</div>
      ${extra ? `<div class="pub-item-extra">${extra}</div>` : ''}
    </div>
    <div class="pub-item-actions">
      ${published && hasDraft ? '<span class="pill orange" title="已发布内容上有未发布的修改，成员当前仍看到旧版本">有待发布修改</span>' : ''}
      ${badge(published)}
      ${admin ? `<button class="icon-btn" data-act="${editAct}" data-id="${id}" title="编辑">${ICON.edit}</button>` : ''}
      ${admin && !published && publishAct ? `<button class="btn sm" data-act="${publishAct}" data-id="${id}" title="发布">发布</button>` : ''}
      ${admin && published && publishAct ? `<button class="btn sm ghost" data-act="unpublish" data-type="${publishAct}" data-id="${id}" title="撤回为草稿">撤回</button>` : ''}
      ${admin && deleteAct ? `<button class="icon-btn danger" data-act="${deleteAct}" data-id="${id}" title="删除">${ICON.trash}</button>` : ''}
    </div>
  </div>`;
}

/* ---------------- 工作核心目标 ---------------- */

function goalCard() {
  const goals = store.state.goals;
  const rows = goals.slice(0, 5).map((g) => {
    const v = versionById(g.version_id);
    const progress = g.progress === null
      ? '<span style="color:var(--text-3);font-size:var(--fs-xs)">暂无关联任务</span>'
      : progressBar(g.done, g.total, g.progress === 1 ? 'done' : 'doing');
    return itemRow({
      title: g.title,
      meta: `${v ? esc(v.name) + ' · ' : '全项目 · '}${g.target_value ? esc(g.target_value) : '无量化指标'}`,
      published: g.published, hasDraft: g.hasDraft,
      editAct: 'edit-goal', id: g.id, deleteAct: 'del-goal', publishAct: 'publish-goal',
      extra: `<span style="min-width:104px;display:flex;justify-content:flex-end">${progress}</span>`,
    });
  });
  return moduleCard('target', '工作核心目标', '批量新增', 'new-goal', rows, '暂无核心目标', '新增目标并发布后，成员工作台会显示，并可按关联任务自动计算执行进度。');
}

/* ---------------- 本月排期 ---------------- */

function scheduleCard() {
  const items = store.state.scheduleItems;
  const rows = items.slice(0, 5).map((it) => {
    const v = versionById(it.version_id);
    const parts = [];
    if (it.make_date) parts.push(`制作 ${md(it.make_date)}`);
    if (it.publish_date) parts.push(`发布 ${md(it.publish_date)}`);
    return itemRow({
      title: it.title,
      meta: `${parts.join(' · ') || '未设置日期'}${v ? ' · ' + esc(v.name) : ''}`,
      published: it.published, hasDraft: it.hasDraft,
      editAct: 'edit-schedule', id: it.id, deleteAct: 'del-schedule', publishAct: 'publish-schedule',
    });
  });
  return moduleCard('cal', '本月排期', '批量新增', 'new-schedule', rows, '暂无排期', '新增排期并发布后自动为对应负责人生成独立任务。');
}

/* ---------------- 版本卖点 ---------------- */

function sellingPointCard() {
  const list = store.state.sellingPoints;
  const rows = list.slice(0, 5).map((p) => {
    const v = versionById(p.version_id);
    return itemRow({
      title: p.title,
      meta: `${v ? esc(v.name) + ' · ' : ''}${esc((p.one_liner || '—').slice(0, 34))}`,
      published: p.published, hasDraft: p.hasDraft,
      editAct: 'edit-sp', id: p.id, deleteAct: 'del-sp', publishAct: 'publish-sp',
    });
  });
  return moduleCard('star', '版本卖点', '批量新增', 'new-sp', rows, '暂无版本卖点', '维护每个版本的传播口径、素材入口与注意事项。');
}

/* ---------------- 版本节点 ---------------- */

function milestoneCard() {
  const list = store.state.milestones.slice().sort((a, b) => (a.date || '9999') < (b.date || '9999') ? -1 : 1);
  const rows = list.slice(0, 6).map((m) => {
    const v = versionById(m.version_id);
    const auto = m.auto;
    return itemRow({
      title: m.name,
      meta: `${v ? esc(v.name) + ' · ' : ''}${m.date ? md(m.date) : '日期待定'} · ${auto ? `关联任务 ${m.linkedDone}/${m.linkedTotal}（自动）` : '手动维护状态'}`,
      published: m.published, hasDraft: m.hasDraft,
      editAct: 'edit-ms', id: m.id, deleteAct: 'del-ms', publishAct: 'publish-ms',
    });
  });
  return moduleCard('flag', '版本节点', '批量新增', 'new-ms', rows, '暂无版本节点', '为并行版本分别维护关键时间节点，有关联任务的节点会自动计算状态。');
}

/* ---------------- 任务分配 ---------------- */

function taskCard() {
  const tasks = store.state.tasks.slice().reverse().slice(0, 6);
  const rows = tasks.map((t) => {
    const u = userById(t.assignee_id);
    const v = versionById(t.version_id);
    return `<div class="pub-item">
      <span class="avatar" style="background:${esc(u?.color || '#9aa7c4')};width:24px;height:24px;font-size:var(--fs-xs)">${esc((u?.name || '?').slice(0, 1))}</span>
      <div style="flex:1;min-width:0">
        <div class="p-title">${esc(t.title)}</div>
        <div class="p-meta">${esc(u?.name || '')} · ${SOURCE_TEXT[t.source] || ''}${v ? ' · ' + esc(v.name) : ''}${t.due_date ? ' · 截止 ' + md(t.due_date) : ' · 无截止日期'}</div>
      </div>
      <span class="pill ${t.status === 'done' ? 'green' : t.status === 'doing' ? 'blue' : 'gray'}">${t.status === 'done' ? '已完成' : t.status === 'doing' ? '进行中' : '未开始'}</span>
      <button class="icon-btn" data-act="edit-task" data-id="${t.id}" title="编辑任务">${ICON.edit}</button>
      <button class="icon-btn danger" data-act="del-task" data-id="${t.id}" title="删除任务">${ICON.trash}</button>
    </div>`;
  });
  return `<div class="card">
    <div class="card-head">
      ${ICON.send}<h3>分配任务</h3>
      <span class="spacer"></span>
      <span style="font-size:var(--fs-xs);color:var(--text-3);margin-right:8px">这里用于分配任务；查看完整团队进度请切换到上方「团队看台」</span>
      <button class="btn sm ghost" data-act="new-task">${ICON.plus} 分配任务</button>
    </div>
    ${rows.length === 0 ? emptyState('暂无分配的任务', '点击「分配任务」给成员派发工作。', '', 'send') : `<div>${rows.join('')}</div>`}
  </div>`;
}

/* ---------------- 版本管理 ---------------- */

function versionCard() {
  const rows = store.state.versions.map((v) => {
    const ms = store.state.milestones.filter((m) => m.version_id === v.id).length;
    const tk = store.state.tasks.filter((t) => t.version_id === v.id).length;
    return `<div class="pub-item">
      <span class="vtag"><i style="background:${esc(v.color)};width:9px;height:9px"></i></span>
      <div style="flex:1;min-width:0">
        <div class="p-title">${esc(v.name)}</div>
        <div class="p-meta">${esc(v.description || '—')} · ${ms} 个节点 · ${tk} 项任务</div>
      </div>
      <span class="pill ${v.status === 'active' ? 'blue' : 'gray'}">${v.status === 'active' ? '进行中' : '规划中'}</span>
      <button class="icon-btn" data-act="edit-version" data-id="${v.id}" title="编辑版本">${ICON.edit}</button>
      <button class="icon-btn danger" data-act="del-version" data-id="${v.id}" title="删除版本">${ICON.trash}</button>
    </div>`;
  });
  return `<div class="card">
    <div class="card-head">
      ${ICON.folder}<h3>版本</h3>
      <span class="spacer"></span>
      <button class="btn sm ghost" data-act="new-version">${ICON.plus} 新建版本</button>
    </div>
    ${rows.length ? `<div>${rows.join('')}</div>` : emptyState('暂无版本', '创建版本后即可为它维护节点、排期与卖点。', '', 'folder')}
  </div>`;
}

/* ================================================================== */
/* 弹窗                                                                */
/* ================================================================== */

function guardAdmin() {
  if (!isAdmin()) { toast('请先切换到主营视角', 'err'); return false; }
  return true;
}

/* ---- 目标 ---- */
function goalModal(g) {
  if (!g) {
    openBatchContentModal({
      title: '批量新增核心目标', itemLabel: '核心目标', listKey: 'goals',
      createAction: 'create_goal', publishAction: 'publish_goal', titleKey: 'title',
      renderFields: (it) => `
        ${field('目标名称', `<input class="input" name="title" value="${esc(it.title || '')}">`, '', true)}
        ${field('目标说明', `<textarea class="input" name="description" rows="3">${esc(it.description || '')}</textarea>`, '可以是文字方向，也可以带量化指标', true)}
        ${field('业务指标目标值', `<input class="input" name="target_value" value="${esc(it.target_value || '')}" placeholder="例如：全渠道曝光 5000 万">`, '仅展示目标值，不会与任务完成率混算', false)}
        ${field('适用范围', `<select class="input" name="version_id">${versionOptions(it.version_id || '')}</select>`, '不选择则适用于整个项目', false)}`,
      readItem: (row) => ({
        title: row.querySelector('[name="title"]').value.trim(),
        description: row.querySelector('[name="description"]').value.trim(),
        target_value: row.querySelector('[name="target_value"]').value.trim(),
        version_id: row.querySelector('[name="version_id"]').value || null,
      }),
      validateItem: (it) => it.title ? '' : '请填写目标名称',
    });
    return;
  }
  const it = g || {};
  openModal({
    title: g ? '编辑核心目标' : '新增核心目标',
    body: `<div class="form-grid">
      ${field('目标名称', `<input class="input" name="title" value="${esc(it.title || '')}">`, '', true)}
      ${field('目标说明', `<textarea class="input" name="description" rows="3">${esc(it.description || '')}</textarea>`, '可以是文字方向，也可以带量化指标', true)}
      ${field('业务指标目标值', `<input class="input" name="target_value" value="${esc(it.target_value || '')}" placeholder="例如：全渠道曝光 5000 万">`, '仅展示目标值，不会与任务完成率混算', false)}
      ${field('适用范围', `<select class="input" name="version_id">${versionOptions(it.version_id || '')}</select>`, '不选择则适用于整个项目', false)}
    </div>`,
    footer: `<button class="btn" data-act="close-modal">取消</button>
             <button class="btn" data-act="save-goal-draft">${g && g.published ? '保存为待发布修改' : '保存草稿'}</button>
             <button class="btn primary" data-act="save-goal-publish">${g && g.published ? '发布修改' : '保存并发布'}</button>`,
    onMount(el) {
      el.querySelector('[name="title"]').focus();
      const read = () => ({
        id: it.id,
        title: el.querySelector('[name="title"]').value.trim(),
        description: el.querySelector('[name="description"]').value.trim(),
        target_value: el.querySelector('[name="target_value"]').value.trim(),
        version_id: el.querySelector('[name="version_id"]').value || null,
      });
      const save = async (publish) => {
        const d = read();
        if (!d.title) { toast('请填写目标名称', 'err'); return; }
        const st = await mutate(it.id ? 'update_goal' : 'create_goal', d);
        if (publish) {
          const id = it.id || lastId(st.goals, d.title);
          if (id) await mutate('publish_goal', { id, title: d.title }, { toast: '目标已发布' });
        } else toast('已保存草稿（成员不可见）', 'ok');
        closeModal();
      };
      el.querySelector('[data-act="save-goal-draft"]').addEventListener('click', () => save(false));
      el.querySelector('[data-act="save-goal-publish"]').addEventListener('click', () => save(true));
    },
  });
}

/* ---- 节点 ---- */
function milestoneModal(m) {
  if (!m) {
    openBatchContentModal({
      title: '批量新增版本节点', itemLabel: '版本节点', listKey: 'milestones',
      createAction: 'create_milestone', publishAction: 'publish_milestone', titleKey: 'name',
      renderFields: (it) => `
        ${field('节点名称', `<input class="input" name="name" value="${esc(it.name || '')}" placeholder="例如：卖点确认">`, '', true)}
        ${field('所属版本', `<select class="input" name="version_id">${versionOptions(it.version_id || '')}</select>`, '', false)}
        ${field('日期', `<input class="input" type="date" name="date" value="${esc(it.date || '')}">`, '日期前 1 天在工作台提醒', false)}
        ${field('说明', `<textarea class="input" name="description" rows="3">${esc(it.description || '')}</textarea>`, '', true)}`,
      readItem: (row) => ({
        name: row.querySelector('[name="name"]').value.trim(),
        version_id: row.querySelector('[name="version_id"]').value || null,
        date: row.querySelector('[name="date"]').value,
        description: row.querySelector('[name="description"]').value.trim(),
        status: 'pending',
      }),
      validateItem: (it) => it.name ? '' : '请填写节点名称',
    });
    return;
  }
  const it = m || {};
  openModal({
    title: m ? '编辑版本节点' : '新增版本节点',
    body: `<div class="form-grid">
      ${field('节点名称', `<input class="input" name="name" value="${esc(it.name || '')}" placeholder="例如：卖点确认">`, '', true)}
      ${field('所属版本', `<select class="input" name="version_id">${versionOptions(it.version_id || '')}</select>`, '', false)}
      ${field('日期', `<input class="input" type="date" name="date" value="${esc(it.date || '')}">`, '日期前 1 天在工作台提醒', false)}
      ${field('说明', `<textarea class="input" name="description" rows="3">${esc(it.description || '')}</textarea>`, '', true)}
    </div>
    <div class="banner info" style="margin-top:14px">有关联任务的节点，状态由关联任务自动计算；没有关联任务时，可在「版本节点」页手动更新状态。</div>`,
    footer: `<button class="btn" data-act="close-modal">取消</button>
             <button class="btn" data-act="save-ms-draft">${m && m.published ? '保存为待发布修改' : '保存草稿'}</button>
             <button class="btn primary" data-act="save-ms-publish">${m && m.published ? '发布修改' : '保存并发布'}</button>`,
    onMount(el) {
      el.querySelector('[name="name"]').focus();
      const read = () => ({
        id: it.id,
        name: el.querySelector('[name="name"]').value.trim(),
        version_id: el.querySelector('[name="version_id"]').value || null,
        date: el.querySelector('[name="date"]').value,
        description: el.querySelector('[name="description"]').value.trim(),
        status: it.status || 'pending',
      });
      const save = async (publish) => {
        const d = read();
        if (!d.name) { toast('请填写节点名称', 'err'); return; }
        const st = await mutate(it.id ? 'update_milestone' : 'create_milestone', d);
        if (publish) {
          const id = it.id || lastId(st.milestones, d.name);
          if (id) await mutate('publish_milestone', { id, name: d.name }, { toast: '节点已发布' });
        } else toast('已保存草稿（成员不可见）', 'ok');
        closeModal();
      };
      el.querySelector('[data-act="save-ms-draft"]').addEventListener('click', () => save(false));
      el.querySelector('[data-act="save-ms-publish"]').addEventListener('click', () => save(true));
    },
  });
}

/* ---- 卖点 ---- */
function sellingPointModal(p) {
  if (!p) {
    openBatchContentModal({
      title: '批量新增版本卖点', itemLabel: '版本卖点', listKey: 'sellingPoints',
      createAction: 'create_selling_point', publishAction: 'publish_selling_point', titleKey: 'title',
      renderFields: (it) => `
        ${field('卖点标题', `<input class="input" name="title" value="${esc(it.title || '')}">`, '', true)}
        ${field('一句话表达', `<input class="input" name="one_liner" value="${esc(it.one_liner || '')}">`, '', true)}
        ${field('所属版本', `<select class="input" name="version_id">${versionOptions(it.version_id || '')}</select>`, '', false)}
        ${field('素材入口', `<input class="input" name="material_link" value="${esc(it.material_link || '')}" placeholder="素材库路径或链接">`, '', false)}
        ${field('适用内容', `<textarea class="input" name="applicable_content" rows="2">${esc(it.applicable_content || '')}</textarea>`, '', true)}
        ${field('注意事项', `<textarea class="input" name="notes" rows="2">${esc(it.notes || '')}</textarea>`, '', true)}`,
      readItem: (row) => ({
        title: row.querySelector('[name="title"]').value.trim(),
        one_liner: row.querySelector('[name="one_liner"]').value.trim(),
        version_id: row.querySelector('[name="version_id"]').value || null,
        material_link: row.querySelector('[name="material_link"]').value.trim(),
        applicable_content: row.querySelector('[name="applicable_content"]').value.trim(),
        notes: row.querySelector('[name="notes"]').value.trim(),
      }),
      validateItem: (it) => it.title ? '' : '请填写卖点标题',
    });
    return;
  }
  const it = p || {};
  openModal({
    title: p ? '编辑版本卖点' : '新增版本卖点',
    wide: true,
    body: `<div class="form-grid">
      ${field('卖点标题', `<input class="input" name="title" value="${esc(it.title || '')}">`, '', true)}
      ${field('一句话表达', `<input class="input" name="one_liner" value="${esc(it.one_liner || '')}">`, '', true)}
      ${field('所属版本', `<select class="input" name="version_id">${versionOptions(it.version_id || '')}</select>`, '', false)}
      ${field('素材入口', `<input class="input" name="material_link" value="${esc(it.material_link || '')}" placeholder="素材库路径或链接">`, '', false)}
      ${field('适用内容', `<textarea class="input" name="applicable_content" rows="2">${esc(it.applicable_content || '')}</textarea>`, '', true)}
      ${field('注意事项', `<textarea class="input" name="notes" rows="2">${esc(it.notes || '')}</textarea>`, '', true)}
    </div>`,
    footer: `<button class="btn" data-act="close-modal">取消</button>
             <button class="btn" data-act="save-sp-draft">${p && p.published ? '保存为待发布修改' : '保存草稿'}</button>
             <button class="btn primary" data-act="save-sp-publish">${p && p.published ? '发布修改' : '保存并发布'}</button>`,
    onMount(el) {
      el.querySelector('[name="title"]').focus();
      const read = () => ({
        id: it.id,
        title: el.querySelector('[name="title"]').value.trim(),
        one_liner: el.querySelector('[name="one_liner"]').value.trim(),
        version_id: el.querySelector('[name="version_id"]').value || null,
        material_link: el.querySelector('[name="material_link"]').value.trim(),
        applicable_content: el.querySelector('[name="applicable_content"]').value.trim(),
        notes: el.querySelector('[name="notes"]').value.trim(),
      });
      const save = async (publish) => {
        const d = read();
        if (!d.title) { toast('请填写卖点标题', 'err'); return; }
        const st = await mutate(it.id ? 'update_selling_point' : 'create_selling_point', d);
        if (publish) {
          const id = it.id || lastId(st.sellingPoints, d.title);
          if (id) await mutate('publish_selling_point', { id, title: d.title }, { toast: '卖点已发布，成员将收到内容更新提醒' });
        } else toast('已保存草稿（成员不可见）', 'ok');
        closeModal();
      };
      el.querySelector('[data-act="save-sp-draft"]').addEventListener('click', () => save(false));
      el.querySelector('[data-act="save-sp-publish"]').addEventListener('click', () => save(true));
    },
  });
}

/* ---- 版本 ---- */
export function versionModal(v) {
  const it = v || {};
  openModal({
    title: v ? '编辑版本' : '新建版本',
    body: `<div class="form-grid">
      ${field('版本名称', `<input class="input" name="name" value="${esc(it.name || '')}" placeholder="例如：版本 D · 春节活动">`, '', true)}
      ${field('说明', `<textarea class="input" name="description" rows="2">${esc(it.description || '')}</textarea>`, '', true)}
      ${field('状态', `<select class="input" name="status">${selectOptions([
        { value: 'active', label: '进行中' }, { value: 'planning', label: '规划中' }, { value: 'archived', label: '已归档' },
      ], it.status || 'active')}</select>`, '', false)}
      ${field('标识色', `<input class="input" type="color" name="color" value="${esc(it.color || '#5b6ee1')}" style="padding:3px;height:32px">`, '用于时间线与排期中的版本标记', false)}
    </div>`,
    footer: `<button class="btn" data-act="close-modal">取消</button>
             <button class="btn primary" data-act="save-version">保存</button>`,
    onMount(el) {
      el.querySelector('[name="name"]').focus();
      el.querySelector('[data-act="save-version"]').addEventListener('click', async () => {
        const d = {
          id: it.id,
          name: el.querySelector('[name="name"]').value.trim(),
          description: el.querySelector('[name="description"]').value.trim(),
          status: el.querySelector('[name="status"]').value,
          color: el.querySelector('[name="color"]').value,
        };
        if (!d.name) { toast('请填写版本名称', 'err'); return; }
        await mutate(it.id ? 'update_version' : 'create_version', d, { toast: '已保存' });
        closeModal();
      });
    },
  });
}

/* ---- 任务分配（多人分配生成独立任务） ---- */
export function openTaskModal(t) {
  const it = t || {};
  const members = store.state.users.filter((u) => u.role !== 'admin');
  const preSelected = it.assignee_id ? [it.assignee_id] : [];
  const locked = !!it.id; // 编辑时单个负责人

  openModal({
    title: t ? '编辑任务' : '分配任务',
    wide: true,
    body: `<div class="form-grid">
      ${field('任务名称', `<input class="input" name="title" value="${esc(it.title || '')}">`, '', true)}
      ${field('描述／交付要求', `<textarea class="input" name="description" rows="2">${esc(it.description || '')}</textarea>`, '', true)}
      ${locked
        ? field('负责人', `<select class="input" name="assignee_id">${userOptions(it.assignee_id, true)}</select>`, '编辑时只能有一位负责人', false)
        : field('负责人（可多选）', `<div class="check-list" id="assignee-list">
            ${members.map((m) => `<button type="button" class="check-item ${preSelected.includes(m.id) ? 'on' : ''}" data-assignee="${m.id}">
              <span class="avatar" style="background:${esc(m.color)};width:20px;height:20px;font-size:var(--fs-xs)">${esc(m.name.slice(0, 1))}</span>
              <span style="flex:1">${esc(m.name)} · ${esc(m.title || '')}</span>
              ${preSelected.includes(m.id) ? ICON.check : ''}
            </button>`).join('')}
          </div>`, '选择多人时会为每人生成一条独立的个人任务记录', true)}
      ${field('所属版本', `<select class="input" name="version_id">${versionOptions(it.version_id || '')}</select>`, '', false)}
      ${field('关联目标', `<select class="input" name="goal_id">${goalOptions(it.goal_id)}</select>`, '关联后计入目标完成率', false)}
      ${field('关联节点', `<select class="input" name="milestone_id">${milestoneOptions(it.milestone_id)}</select>`, '关联后影响节点自动状态', false)}
      ${field('截止日期', `<input class="input" type="date" name="due_date" value="${esc(it.due_date || '')}">`, '选填；前 1 天开始提醒', false)}
      ${field('优先级', `<select class="input" name="priority">${selectOptions([
        { value: 2, label: '普通' }, { value: 1, label: '中' }, { value: 0, label: '高' },
      ], it.priority != null ? it.priority : 2)}</select>`, '', false)}
      ${!locked ? field('初始步骤（每行一个）', `<textarea class="input" name="steps" rows="2" placeholder="选填；负责人维护，主营可只读查看"></textarea>`, '', true) : ''}
    </div>`,
    footer: `<button class="btn" data-act="close-modal">取消</button>
             <button class="btn primary" data-act="save-task">${t ? '保存' : '发布任务'}</button>`,
    onMount(el) {
      el.querySelector('[name="title"]').focus();
      const picked = new Set(preSelected);
      const list = el.querySelector('#assignee-list');
      if (list) {
        list.addEventListener('click', (e) => {
          const b = e.target.closest('[data-assignee]');
          if (!b) return;
          const id = b.dataset.assignee;
          if (picked.has(id)) picked.delete(id); else picked.add(id);
          b.classList.toggle('on', picked.has(id));
          b.querySelector('svg')?.remove();
          if (picked.has(id)) b.insertAdjacentHTML('beforeend', ICON.check);
        });
      }

      el.querySelector('[data-act="save-task"]').addEventListener('click', async () => {
        const v = (n) => el.querySelector(`[name="${n}"]`)?.value ?? '';
        const title = v('title').trim();
        if (!title) { toast('请填写任务名称', 'err'); return; }
        const base = {
          title,
          description: v('description').trim(),
          version_id: v('version_id') || null,
          goal_id: v('goal_id') || null,
          milestone_id: v('milestone_id') || null,
          due_date: v('due_date'),
          priority: Number(v('priority')),
        };

        if (locked) {
          await mutate('update_task', { ...base, id: it.id, assignee_id: v('assignee_id') }, { toast: '任务已更新' });
        } else {
          if (picked.size === 0) { toast('请至少选择一位负责人', 'err'); return; }
          const steps = v('steps').split('\n').map((s) => s.trim()).filter(Boolean);
          for (const uid of picked) {
            await mutate('create_task', { ...base, assignee_id: uid, steps });
          }
          toast(picked.size > 1
            ? `已为 ${picked.size} 位负责人各生成一条独立任务`
            : '任务已发布，成员清单中将出现该任务', 'ok');
        }
        closeModal();
      });
    },
  });
}

function goalOptions(cur) {
  const goals = store.state.goals.filter((g) => g.published === 1 || (cur && g.id === cur));
  return selectOptions(goals.map((g) => ({ value: g.id, label: g.title })), cur || '', '不关联目标');
}
function milestoneOptions(cur) {
  const ms = store.state.milestones.filter((m) => m.published === 1 || (cur && m.id === cur));
  return selectOptions(ms.map((m) => ({ value: m.id, label: `${m.name}${m.date ? '（' + m.date + '）' : ''}` })), cur || '', '不关联节点');
}

function lastId(list, title) {
  const key = list === store.state.goals ? 'title' : 'name';
  const hit = list.filter((x) => (x.title || x.name) === title);
  return hit.length ? hit[hit.length - 1].id : null;
}

/* ================================================================== */
/* 动作                                                                */
/* ================================================================== */

export const actions = {
  ...teamboard.actions,
  ...accountsPage.actions,
  'admin-section'(el) {
    store.ui.adminSection = ['team', 'accounts'].includes(el.dataset.section) ? el.dataset.section : 'content';
    renderApp();
    requestAnimationFrame(() => { const content = document.getElementById('content'); if (content) content.scrollTop = 0; });
  },
  'new-goal'() { if (guardAdmin()) goalModal(null); },
  'new-ms'() { if (guardAdmin()) milestoneModal(null); },
  'new-sp'() { if (guardAdmin()) sellingPointModal(null); },
  'new-version'() { if (guardAdmin()) versionModal(null); },
  'new-task'() { if (guardAdmin()) openTaskModal(null); },
  'new-schedule'() { if (guardAdmin()) openScheduleModal(null); },

  'edit-goal'(el) { if (guardAdmin()) goalModal(editSource(store.state.goals.find((g) => g.id === el.dataset.id))); },
  'edit-ms'(el) { if (guardAdmin()) milestoneModal(editSource(store.state.milestones.find((m) => m.id === el.dataset.id))); },
  'edit-sp'(el) { if (guardAdmin()) sellingPointModal(editSource(store.state.sellingPoints.find((p) => p.id === el.dataset.id))); },
  'edit-version'(el) { if (guardAdmin()) versionModal(store.state.versions.find((v) => v.id === el.dataset.id)); },
  'edit-task'(el) { if (guardAdmin()) openTaskModal(store.state.tasks.find((t) => t.id === el.dataset.id)); },
  'edit-schedule'(el) { if (guardAdmin()) openScheduleModal(editSource(store.state.scheduleItems.find((s) => s.id === el.dataset.id))); },

  async 'publish-goal'(el) { await mutate('publish_goal', { id: el.dataset.id }, { toast: '已发布' }); },
  async 'publish-schedule'(el) {
    const st = await mutate('publish_schedule', { id: el.dataset.id });
    toast(syncReportMessage(st && st.syncReport), st && st.syncReport && st.syncReport.detached.length ? 'err' : 'ok');
  },
  async 'publish-sp'(el) { await mutate('publish_selling_point', { id: el.dataset.id }, { toast: '已发布，成员将收到更新提醒' }); },
  async 'publish-ms'(el) { await mutate('publish_milestone', { id: el.dataset.id }, { toast: '已发布' }); },

  'unpublish'(el) {
    const type = el.dataset.type;
    const id = el.dataset.id;
    const map = { 'publish-goal': 'unpublish_goal', 'publish-schedule': 'unpublish_schedule', 'publish-sp': 'unpublish_selling_point', 'publish-ms': 'unpublish_milestone' };
    if (type !== 'publish-schedule') {
      mutate(map[type], { id }, { toast: '已撤回为草稿（成员不可见）' });
      return;
    }
    // 排期撤回会影响成员的个人任务，先把具体后果说清楚再确认
    confirmScheduleImpact(id, '撤回排期', '撤回后该排期对成员不可见，', '撤回', async () => {
      const st = await mutate('unpublish_schedule', { id });
      toast(syncReportMessage(st && st.syncReport), st && st.syncReport && st.syncReport.detached.length ? 'err' : 'ok');
    });
  },

  'del-goal'(el) { del('goal', el.dataset.id, '删除目标', '该目标将从所有视图中移除，已关联的任务会保留但不再计入目标完成率。'); },
  'del-sp'(el) { del('selling_point', el.dataset.id, '删除卖点', '成员将不再看到该卖点内容。'); },
  'del-ms'(el) { del('milestone', el.dataset.id, '删除节点', '已关联该节点的任务会保留，但不再影响节点状态。'); },
  'del-schedule'(el) {
    const id = el.dataset.id;
    confirmScheduleImpact(id, '删除排期', '删除后该排期不再存在，', '删除', async () => {
      const st = await mutate('delete_schedule', { id });
      toast(syncReportMessage(st && st.syncReport), st && st.syncReport && st.syncReport.detached.length ? 'err' : 'ok');
    });
  },
  'del-task'(el) { del('task', el.dataset.id, '删除任务', '该任务的个人步骤与完成记录会一并移除。'); },
  'del-version'(el) {
    const v = versionById(el.dataset.id);
    const used = store.state.tasks.some((t) => t.version_id === v.id)
      || store.state.milestones.some((m) => m.version_id === v.id)
      || store.state.scheduleItems.some((s) => s.version_id === v.id);
    if (used) { toast('该版本仍有关联的节点、排期或任务，无法删除', 'err'); return; }
    del('version', el.dataset.id, '删除版本', '该版本将从工作台移除。');
  },

  'publish-check'() {
    if (!guardAdmin()) return;
    const drafts = collectDrafts();
    if (!drafts.length) { toast('没有待发布的草稿'); return; }
    openModal({
      title: `检查并发布（${drafts.length} 项草稿）`,
      wide: true,
      body: `<div class="banner info" style="margin-bottom:14px">${ICON.bell}
        <span>发布后成员工作台会立即显示这些内容，并收到「内容已更新」提醒。
        标记为「更新已发布内容」的项，成员在此之前一直看到的是旧版本。</span></div>
        <div class="card">${drafts.map((d) => `<div class="pub-item">
          <span class="pill outline">${d.label}</span>
          <div style="flex:1;min-width:0"><div class="p-title">${esc(d.title)}</div></div>
          ${d.kind === 'edit'
            ? '<span class="pill orange">更新已发布内容</span>'
            : '<span class="pill gray">新草稿</span>'}
        </div>`).join('')}</div>`,
      footer: `<button class="btn" data-act="close-modal">稍后再说</button>
               <button class="btn primary" data-act="publish-all">全部发布（${drafts.length} 项）</button>`,
      onMount(el) {
        el.querySelector('[data-act="publish-all"]').addEventListener('click', async () => {
          const notes = [];
          for (const d of drafts) {
            const [, action, field] = PUBLISH_ACTION_BY_TYPE[d.type];
            const st = await mutate(action, { id: d.id, [field]: d.title });
            if (d.type === 'schedule' && st && st.syncReport) {
              const r = st.syncReport;
              if (r.detached.length || r.assigneeKept.length || r.needsAssignee.length || r.dateChanged.length) {
                notes.push(`${d.title}：${syncReportMessage(r).replace(/^已发布：/, '')}`);
              }
            }
          }
          toast(`已发布 ${drafts.length} 项内容`, 'ok');
          // 排期同步有需要主营知情的后果时，单独再提示一条，避免被「已发布」盖过
          for (const n of notes) toast(n, 'err');
          closeModal();
        });
      },
    });
  },
};

const PUBLISH_ACTION_BY_TYPE = {
  goal: ['goal', 'publish_goal', 'title'],
  schedule: ['schedule', 'publish_schedule', 'title'],
  selling_point: ['selling_point', 'publish_selling_point', 'title'],
  milestone: ['milestone', 'publish_milestone', 'name'],
};

/**
 * 撤回／删除排期前的影响确认。
 * 个人步骤在服务端按角色过滤，主营看不到，因此后果必须由服务端算好再展示，
 * 不能在前端凭 task.stepsTotal 猜（主营视角那里恒为 0）。
 */
async function confirmScheduleImpact(id, title, prefix, okText, onOk) {
  let impact = null;
  try {
    const res = await authFetch(`/api/schedule-impact?id=${id}`);
    if (res.ok) impact = await res.json();
  } catch (_) { /* 取不到影响就退回通用提示 */ }

  let msg;
  if (!impact || !impact.ok || impact.total === 0) {
    msg = `${prefix}该排期当前没有生成个人任务。`;
  } else if (impact.willKeep === 0) {
    msg = `${prefix}它会移除 ${impact.willRemove} 项尚未开始且没有步骤的自动任务（没有个人投入，不会丢失记录）。`;
  } else {
    const detail = impact.keep
      .map((k) => `「${k.title}」（${k.steps} 个步骤，${k.status === 'done' ? '已完成' : k.status === 'doing' ? '进行中' : '未开始'}）`)
      .join('、');
    msg = `${prefix}其中：`
      + (impact.willRemove ? `${impact.willRemove} 项尚未开始且没有步骤的任务会被移除；` : '')
      + `${impact.willKeep} 项因已有步骤或已开始，会保留为成员的独立历史任务，步骤与完成记录不丢失。`
      + `<br><br>保留：${detail}`;
  }
  confirmModal(title, msg, onOk, okText);
}

function del(type, id, title, message) {
  if (!guardAdmin()) return;
  confirmModal(title, message, async () => {
    await mutate(`delete_${type}`, { id }, { toast: '已删除' });
  }, '删除');
}
