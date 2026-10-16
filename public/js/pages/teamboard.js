/* 主营销团队看台：汇总成员「我的工作」，任务与步骤在此均为只读。 */

import { esc, ICON, md, diffDays, emptyState, toast } from '../util.js';
import { store, isAdmin, loadState, stepsOf, userById, versionById } from '../api.js';
import { openModal, statusPill, sourcePill, versionTag, progressBar, PRIORITY_TEXT } from '../ui.js';
import { render as renderApp } from '../shell.js';
import { buildTeamProgressMatrix } from '../team-progress-model.js';
import { renderTeamProgressPanel, mountTeamCity } from '../team-progress-view.js';

export const keepScroll = true;

const members = () => (store.state?.users || []).filter((u) => u.role !== 'admin');
const memberTasks = () => (store.state?.tasks || []).filter((t) => members().some((u) => u.id === t.assignee_id));
const overdue = (t) => t.status !== 'done' && !!t.due_date && t.due_date < store.state.today;

function scopedTasks() {
  const version = store.ui.teamVersion || 'all';
  return memberTasks().filter((t) => version === 'all' || (version === 'none' ? !t.version_id : t.version_id === version));
}

function summary(list) {
  return {
    total: list.length,
    todo: list.filter((t) => t.status === 'todo').length,
    doing: list.filter((t) => t.status === 'doing').length,
    done: list.filter((t) => t.status === 'done').length,
    overdue: list.filter(overdue).length,
  };
}

function sortedTasks(list) {
  return list.slice().sort((a, b) => {
    const rank = (t) => {
      if (overdue(t)) return 0;
      if (t.status === 'done') return 4;
      const days = diffDays(t.due_date, store.state.today);
      if (days !== null && days <= 1) return 1;
      return t.status === 'doing' ? 2 : 3;
    };
    return rank(a) - rank(b)
      || (a.priority ?? 2) - (b.priority ?? 2)
      || (a.due_date || '9999').localeCompare(b.due_date || '9999')
      || (b.updated_at || '').localeCompare(a.updated_at || '')
      || a.id - b.id;
  });
}

function shownTasks() {
  const member = store.ui.teamMember || 'all';
  const status = store.ui.teamStatus || 'all';
  const query = (store.ui.teamQuery || '').trim().toLowerCase();
  return sortedTasks(scopedTasks().filter((t) =>
    (member === 'all' || t.assignee_id === member)
    && (status === 'all' || (status === 'open' ? t.status !== 'done' : status === 'overdue' ? overdue(t) : t.status === status))
    && (!query || t.title.toLowerCase().includes(query) || (t.description || '').toLowerCase().includes(query))
  ));
}

function progressMatrix() {
  return buildTeamProgressMatrix({
    members: members(),
    versions: store.state?.versions || [],
    tasks: memberTasks(),
    steps: store.state?.steps || [],
    today: store.state?.today || '',
    versionFilter: store.ui.teamVersion || 'all',
    statusFilter: store.ui.teamStatus || 'all',
    query: store.ui.teamQuery || '',
  });
}

function formatTime(value, mode = 'short') {
  const date = new Date(value || '');
  if (Number.isNaN(date.getTime())) return '—';
  const parts = { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false };
  if (mode !== 'time') { parts.month = '2-digit'; parts.day = '2-digit'; }
  if (mode === 'full') parts.year = 'numeric';
  return new Intl.DateTimeFormat('zh-CN', parts).format(date);
}

function updatedText(t) {
  return esc(formatTime(t.updated_at || t.created_at));
}

function taskRow(t) {
  const u = userById(t.assignee_id);
  const risk = overdue(t);
  const soon = !risk && t.status !== 'done' && t.due_date && diffDays(t.due_date, store.state.today) <= 1;
  return `<tr class="team-task-row">
    <td><button class="team-task-title" data-act="team-task" data-id="${t.id}">${esc(t.title)}</button>
      <div class="team-task-sub">${sourcePill(t.source)}${t.priority < 2 ? `<span class="pill ${t.priority === 0 ? 'red' : 'orange'}">${PRIORITY_TEXT[t.priority]}优先级</span>` : ''}</div>
    </td>
    <td><span class="team-assignee"><span class="team-dot" style="background:${esc(u?.color || '#8494ad')}"></span>${esc(u?.name || '未分配')}</span></td>
    <td>${statusPill(t.status)}</td>
    <td>${progressBar(t.stepsDone, t.stepsTotal, t.status)}</td>
    <td>${versionTag(t.version_id)}</td>
    <td><span class="team-due ${risk ? 'risk' : soon ? 'soon' : ''}">${t.due_date ? md(t.due_date) : '未设置'}</span></td>
    <td class="team-updated">${updatedText(t)}</td>
  </tr>`;
}

function taskDetail(t) {
  const u = userById(t.assignee_id);
  const v = versionById(t.version_id);
  const steps = stepsOf(t.id);
  const done = steps.filter((s) => s.done === 1).length;
  const date = t.due_date ? md(t.due_date) : '未设置';
  return `<div class="team-detail-meta">
    <span>负责人</span><strong>${esc(u?.name || '未分配')}</strong>
    <span>任务状态</span><strong>${statusPill(t.status)}</strong>
    <span>来源</span><strong>${sourcePill(t.source)}</strong>
    <span>所属版本</span><strong>${esc(v?.name || '未关联版本')}</strong>
    <span>优先级</span><strong>${PRIORITY_TEXT[t.priority] || '普通'}</strong>
    <span>截止日期</span><strong class="${overdue(t) ? 'risk' : ''}">${date}</strong>
    <span>最近更新</span><strong>${esc(formatTime(t.updated_at || t.created_at, 'full'))}</strong>
  </div>
  <div class="team-detail-block"><h4>交付要求</h4><p>${esc(t.description || '暂无说明')}</p></div>
  <div class="team-detail-block"><div class="team-detail-step-head"><h4>执行步骤</h4><span>${steps.length ? `${done}/${steps.length} 已完成` : '暂无步骤'}</span></div>
    ${steps.length ? `<div class="team-detail-progress">${progressBar(done, steps.length, t.status)}</div>
      <div class="team-step-list">${steps.map((s) => `<div class="team-step ${s.done ? 'done' : ''}"><span class="team-step-mark">${s.done ? ICON.check : ''}</span><span>${esc(s.title)}</span></div>`).join('')}</div>`
      : '<p class="team-no-steps">执行人尚未拆分步骤；任务状态仍以“未开始／进行中／已完成”为准。</p>'}
  </div>`;
}

export function render({ embedded = false } = {}) {
  if (!isAdmin() || store.state.viewerRole !== 'admin') {
    return `<div class="page-head"><h1 class="page-title">团队看台</h1></div>
      <div class="banner warn">${ICON.alert}<span>团队看台仅在主营视角开放。</span></div>`;
  }

  const ui = store.ui;
  const allMembers = members();
  const rows = shownTasks();
  const memberName = allMembers.find((u) => String(u.id) === String(ui.teamMember))?.name;
  const serverTime = formatTime(store.state.serverTime, 'time');
  const matrix = progressMatrix();
  const vizView = ui.teamVizView === '3d' ? '3d' : '2d';
  const versionLabel = ui.teamVersion === 'all' ? '全部版本'
    : ui.teamVersion === 'none' ? '未关联版本'
      : store.state.versions.find((version) => String(version.id) === String(ui.teamVersion))?.name || '当前版本';
  const versionOptions = [
    { value: 'all', label: '全部版本' },
    { value: 'none', label: '未关联版本' },
    ...store.state.versions.map((version) => ({ value: String(version.id), label: version.name })),
  ];

  return `<div class="page-head page-head-row team-board-head">
    <div class="page-head">${embedded ? '<h2 class="team-board-title">团队看台</h2>' : '<h1 class="page-title">团队看台</h1>'}
      <p class="page-sub">查看每位成员在「我的工作」中更新的任务、状态与执行步骤。</p></div>
    <div class="btn-row"><span class="team-sync">更新于 ${esc(serverTime || '—')}</span>
      <button class="btn sm" data-act="team-refresh">${ICON.refresh} 刷新进度</button></div>
  </div>

  <div class="toolbar team-toolbar">
    <select class="input" data-act="team-status" aria-label="筛选任务状态">
      ${[['all', '全部状态'], ['open', '未完成'], ['todo', '未开始'], ['doing', '进行中'], ['done', '已完成'], ['overdue', '已逾期']]
        .map(([value, label]) => `<option value="${value}" ${ui.teamStatus === value ? 'selected' : ''}>${label}</option>`).join('')}
    </select>
    <span class="spacer"></span>
    <span class="search-wrap">${ICON.search}<input class="input" data-team-query placeholder="搜索任务名称" value="${esc(ui.teamQuery || '')}"></span>
    <button class="btn" data-act="team-search">搜索</button>
    ${ui.teamQuery ? `<button class="btn ghost" data-act="team-clear-search">清除</button>` : ''}
  </div>

  <div class="team-layout">
    ${renderTeamProgressPanel(matrix, {
      view: vizView,
      memberId: ui.teamMember || 'all',
      versionId: ui.teamVersion || 'all',
      versionLabel,
      versionOptions,
    })}
    <section class="card team-tasks">
      <div class="card-head"><h3>${memberName ? `${esc(memberName)}的工作` : '团队工作清单'}</h3><span class="spacer"></span><span class="team-small">${rows.length} 项 · 逾期优先显示</span></div>
      ${rows.length ? `<div class="team-table-scroll"><table class="tbl"><thead><tr><th>任务</th><th>负责人</th><th>状态</th><th>步骤进度</th><th>版本</th><th>截止</th><th>最近更新</th></tr></thead>
        <tbody>${rows.map(taskRow).join('')}</tbody></table></div>`
        : emptyState('没有匹配的任务', '可以切换成员、版本或状态筛选，查看其它工作。', '', 'list')}
    </section>
  </div>
  <div class="team-footnote">完成率按“已完成任务 / 全部任务”计算；步骤进度另行显示。没有步骤的任务不会记为 0% 进度。任务和步骤均由执行人更新，主营在此只读查看。</div>`;
}

let pollTimer = null;
export function afterRender() {
  const root = document.getElementById('page-root');
  if (store.ui.teamVizView === '3d' && root) {
    mountTeamCity(root, progressMatrix(), {
      memberId: store.ui.teamMember || 'all',
      versionId: store.ui.teamVersion || 'all',
      yaw: store.ui.teamVizYaw,
      onYaw(value) { store.ui.teamVizYaw = value; },
    });
  }
  if (pollTimer || !isAdmin()) return;
  pollTimer = setInterval(async () => {
    if (store.ui.page !== 'admin' || store.ui.adminSection !== 'team' || !isAdmin()) {
      clearInterval(pollTimer);
      pollTimer = null;
      return;
    }
    try { await loadState(); } catch (_) { /* 保留现有数据，可手动刷新重试 */ }
  }, 30000);
}

export const actions = {
  'team-member'(el) {
    store.ui.teamMember = el.dataset.id;
    renderApp();
  },
  'team-search'() {
    store.ui.teamQuery = document.querySelector('[data-team-query]')?.value || '';
    renderApp();
  },
  'team-clear-search'() {
    store.ui.teamQuery = '';
    renderApp();
  },
  'team-viz-view'(el) {
    store.ui.teamVizView = el.dataset.view === '3d' ? '3d' : '2d';
    renderApp();
  },
  'team-matrix-cell'(el) {
    store.ui.teamMember = el.dataset.member;
    store.ui.teamVersion = el.dataset.version;
    renderApp();
  },
  'team-matrix-shift'(el) {
    const cells = progressMatrix().rows.flatMap((row) => row.cells);
    if (!cells.length) return;
    const current = cells.findIndex((cell) => String(cell.memberId) === String(store.ui.teamMember)
      && String(cell.versionId) === String(store.ui.teamVersion));
    const start = current >= 0 ? current : cells.findIndex((cell) => cell.total > 0);
    const next = (Math.max(0, start) + Number(el.dataset.step || 1) + cells.length) % cells.length;
    store.ui.teamMember = cells[next].memberId;
    store.ui.teamVersion = cells[next].versionId;
    renderApp();
  },
  'team-matrix-reset'() {
    store.ui.teamMember = 'all';
    store.ui.teamVersion = 'all';
    renderApp();
  },
  'team-camera-reset'() {
    store.ui.teamVizYaw = Math.PI / 6;
    renderApp();
  },
  async 'team-refresh'() {
    try { await loadState(); toast('团队进度已更新', 'ok'); }
    catch (e) { toast('刷新失败：' + e.message, 'err'); }
  },
  'team-task'(el) {
    const t = store.state.tasks.find((x) => x.id === el.dataset.id);
    if (!t || !isAdmin()) return;
    openModal({ title: t.title, wide: true, body: taskDetail(t) });
  },
};
