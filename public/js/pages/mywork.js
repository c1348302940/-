/* 我的工作：全量任务、状态筛选、个人排序、任务步骤详情 */

import { esc, ICON, md, relative, diffDays, emptyState, toast } from '../util.js';
import {
  store, myTasks, filterByStatus, currentUser, currentUserId, isAdmin,
  stepsOf, versionById, goalById, milestoneById, scheduleById, mutate,
} from '../api.js';
import {
  taskRow, statusPill, sourcePill, versionTag, progressBar, openModal, closeModal,
  confirmModal, openMenu, menuClickHandler, field, versionOptions, selectOptions,
  PRIORITY_TEXT, STATUS_TEXT,
} from '../ui.js';
import { go, render as renderApp } from '../shell.js';

export const keepScroll = false;

export function render() {
  const ui = store.ui;
  const s = store.state;
  const all = myTasks();
  const counts = {
    open: filterByStatus(all, 'open').length,
    todo: filterByStatus(all, 'todo').length,
    doing: filterByStatus(all, 'doing').length,
    done: filterByStatus(all, 'done').length,
    all: all.length,
  };
  const shown = filterByStatus(all, ui.workFilter === 'all' ? 'all' : ui.workFilter, );
  const selected = ui.selectedTaskId ? all.find((t) => t.id === ui.selectedTaskId) : null;
  const canDrag = ui.workSort === 'personal';

  return `
    <div class="page-head">
      <h1 class="page-title">我的工作</h1>
      <p class="page-sub">看清所有未开始、进行中与已完成的工作。</p>
    </div>

    <div class="toolbar">
      <div class="seg">
        ${segBtn('open', '未完成', counts.open, ui.workFilter)}
        ${segBtn('todo', '未开始', counts.todo, ui.workFilter)}
        ${segBtn('doing', '进行中', counts.doing, ui.workFilter)}
        ${segBtn('done', '已完成', counts.done, ui.workFilter)}
        ${segBtn('all', '全部工作', counts.all, ui.workFilter)}
      </div>
      <span class="spacer"></span>
      <select class="input" data-act="work-version">
        ${versionOptions(ui.workVersion, true)}
      </select>
      <select class="input" data-act="work-sort">
        ${selectOptions([
          { value: 'personal', label: '按我的排序' },
          { value: 'due', label: '按截止日期' },
        ], ui.workSort)}
      </select>
      <span class="search-wrap">${ICON.search}
        <input class="input" placeholder="搜索任务名称" value="${esc(ui.workQuery)}" data-act="work-query">
      </span>
      <button class="btn primary" data-act="add-self-task">${ICON.plus} 添加个人待办</button>
    </div>

    <div class="grid-2">
      <div class="card">
        ${shown.length === 0
          ? emptyState(
              ui.workQuery ? '没有匹配的任务' : filterEmptyTitle(ui.workFilter),
              ui.workQuery ? '试试其它关键词，或清空搜索框查看全部任务。' : filterEmptyDesc(ui.workFilter),
              '<button class="btn sm primary" data-act="add-self-task">添加个人待办</button>')
          : `<div class="rows" id="task-rows" style="padding:0 16px">
              ${canDrag ? '' : `<div style="padding:9px 2px;font-size:var(--fs-xs);color:var(--text-3)">当前按截止日期排序，切换到「按我的排序」后可拖动调整个人顺序。</div>`}
              ${shown.map((t) => taskRow(t, { today: s.today, draggable: canDrag, selected: ui.selectedTaskId === t.id })).join('')}
            </div>`}
      </div>

      <div id="detail-panel">${selected ? detailHtml(selected) : emptyDetail()}</div>
    </div>`;
}

function segBtn(key, label, n, cur) {
  return `<button class="${cur === key ? 'on' : ''}" data-act="work-filter" data-filter="${key}">${label} <span class="cnt">${n}</span></button>`;
}

function filterEmptyTitle(f) {
  return { todo: '没有未开始的任务', doing: '没有进行中的任务', done: '还没有已完成的工作', all: '当前没有任务' }[f] || '没有未完成的任务';
}
function filterEmptyDesc(f) {
  return {
    todo: '所有任务都已开始或完成。',
    doing: '把某个未开始的任务标记为「进行中」后会出现在这里。',
    done: '完成任务后勾选左侧复选框，记录会保留并可随时回看。',
    all: '主营分配、排期生成与你的个人待办都会汇总到这里。',
  }[f] || '当前没有未完成的任务，可以添加个人待办继续推进。';
}

function emptyDetail() {
  return `<div class="card">${emptyState('选择一项任务', '在左侧点击任意任务，这里会显示你为它拆分的步骤、完成进度与截止日期。步骤由你维护，主营可在团队看台只读查看。', '', 'list')}</div>`;
}

/* ---------------- 右侧详情 ---------------- */

function detailHtml(t) {
  const steps = stepsOf(t.id);
  const doneSteps = steps.filter((s) => s.done === 1).length;
  const v = versionById(t.version_id);
  const g = goalById(t.goal_id);
  const m = milestoneById(t.milestone_id);
  const sch = scheduleById(t.schedule_item_id);
  const assignee = currentUser();
  const dc = diffDays(t.due_date, store.state.today);
  const canManage = isAdmin() || t.assignee_id === currentUserId();

  return `<div class="card">
    <div class="card-head">
      <h3 style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.title)}</h3>
      <button class="icon-btn" data-act="close-detail" title="关闭">${ICON.x}</button>
    </div>
    <div class="card-body" style="padding-bottom:4px">
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
        ${sourcePill(t.source)}
        ${statusPill(t.status)}
        ${t.priority < 2 ? `<span class="pill ${t.priority === 0 ? 'red' : 'orange'}">优先级${PRIORITY_TEXT[t.priority]}</span>` : ''}
      </div>

      <div style="display:grid;grid-template-columns:auto 1fr;gap:7px 14px;font-size:var(--fs-sm);margin-bottom:16px">
        <span style="color:var(--text-3)">负责人</span><span>${esc(assignee?.name || '')}</span>
        <span style="color:var(--text-3)">所属版本</span><span>${v ? versionTag(v.id) : '未关联版本'}</span>
        <span style="color:var(--text-3)">关联目标</span><span>${g ? esc(g.title) : '—'}</span>
        <span style="color:var(--text-3)">关联节点</span><span>${m ? esc(m.name) : '—'}</span>
        <span style="color:var(--text-3)">关联排期</span><span>${
          sch ? `${esc(sch.title)}（${t.schedule_stage === 'make' ? '内部制作交付' : '对外发布'}）`
            : t.schedule_detached === 1
              ? `<span class="pill gray">${esc(t.schedule_detach_reason || '原排期已移除')}</span> 主营调整排期时该阶段不再存在；因你已填写步骤或已开始处理，任务为你保留为独立历史记录，不再计入排期阶段状态`
              : '—'}</span>
        <span style="color:var(--text-3)">截止日期</span>
        <span class="${dc !== null && dc < 0 && t.status !== 'done' ? 'row-due over' : ''}" style="font-weight:500">
          ${t.due_date ? md(t.due_date) : '未设置（不触发临期提醒）'}
          ${t.due_date && t.status !== 'done' ? `<span style="color:var(--text-3);font-weight:400"> · ${relative(t.due_date, store.state.today)}</span>` : ''}
        </span>
        <span style="color:var(--text-3)">交付要求</span><span style="color:var(--text-2);line-height:1.7">${esc(t.description || '—')}</span>
      </div>

      <div style="border-top:1px solid var(--line);padding-top:14px">
        <div style="display:flex;align-items:center;margin-bottom:9px">
          <span style="font-size:var(--fs-sm);font-weight:650;flex:1">任务进度</span>
          <span style="font-size:var(--fs-xs);color:var(--text-3)">${steps.length ? `${doneSteps}/${steps.length} 步骤` : '暂无步骤'}</span>
        </div>
        <div class="progress" style="margin-bottom:14px">
          <span class="progress-track" style="width:100%;height:6px">
            <span class="progress-fill ${doneSteps === steps.length && steps.length ? 'done' : ''}" style="width:${steps.length ? Math.round(doneSteps / steps.length * 100) : 0}%"></span>
          </span>
        </div>

        <div style="font-size:var(--fs-sm);font-weight:650;margin-bottom:4px">步骤清单</div>
        <div style="font-size:var(--fs-xs);color:var(--text-3);margin-bottom:8px">步骤由你维护，主营可在团队看台只读查看；步骤不影响目标完成率与节点判定。</div>
        ${steps.length ? `<div class="steps">${steps.map(stepRow).join('')}</div>` : ''}
        <div style="display:flex;gap:8px;margin-top:10px">
          <input class="input" style="flex:1" placeholder="添加一个步骤，回车确认" data-step-input>
          <button class="btn" data-act="add-step" data-id="${t.id}">${ICON.plus} 添加</button>
        </div>
      </div>
    </div>
    <div class="card-foot" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <span class="seg">
        ${['todo', 'doing', 'done'].map((st) => `<button class="${t.status === st ? 'on' : ''}" data-act="set-status" data-id="${t.id}" data-status="${st}">${STATUS_TEXT[st]}</button>`).join('')}
      </span>
      <span class="spacer" style="flex:1"></span>
      ${canManage ? `<button class="btn sm danger" data-act="delete-task" data-id="${t.id}">${ICON.trash} 删除</button>` : ''}
    </div>
  </div>`;
}

function stepRow(s) {
  return `<div class="step ${s.done ? 'done' : ''}">
    <button class="cbx ${s.done ? 'on' : ''}" data-act="toggle-step" data-id="${s.id}" aria-label="切换步骤完成">${s.done ? ICON.check : ''}</button>
    <span class="s-title">${esc(s.title)}</span>
    <button class="icon-btn danger" data-act="delete-step" data-id="${s.id}" title="删除步骤">${ICON.trash}</button>
  </div>`;
}

/* ---------------- 拖动排序 ---------------- */

export function afterRender(root) {
  const rows = root.querySelector('#task-rows');
  if (!rows) return;
  let dragId = null;

  rows.querySelectorAll('[data-task-row]').forEach((row) => {
    row.addEventListener('dragstart', (e) => {
      dragId = row.dataset.taskRow;
      row.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', String(dragId)); } catch (_) {}
    });
    row.addEventListener('dragend', () => {
      row.classList.remove('dragging');
      rows.querySelectorAll('.drop-target').forEach((x) => x.classList.remove('drop-target'));
      dragId = null;
    });
    row.addEventListener('dragover', (e) => {
      if (dragId === null || row.dataset.taskRow === dragId) return;
      e.preventDefault();
      rows.querySelectorAll('.drop-target').forEach((x) => x.classList.remove('drop-target'));
      row.classList.add('drop-target');
    });
    row.addEventListener('drop', async (e) => {
      e.preventDefault();
      const targetId = row.dataset.taskRow;
      row.classList.remove('drop-target');
      if (dragId === null || targetId === dragId) return;
      await reorder(dragId, targetId);
    });
  });
}

async function reorder(draggedId, targetId) {
  const all = myTasks().slice().sort((a, b) => (a.personal_order ?? 1e9) - (b.personal_order ?? 1e9));
  const order = all.map((t) => t.id);
  const from = order.indexOf(draggedId);
  const to = order.indexOf(targetId);
  if (from < 0 || to < 0) return;
  order.splice(from, 1);
  order.splice(order.indexOf(targetId) + (from < to ? 1 : 0), 0, draggedId);
  await mutate('reorder_tasks', { orderedIds: order, userId: currentUserId() }, { toast: '已更新个人顺序' });
}

/* ---------------- 自建待办 ---------------- */

export function openSelfTaskModal() {
  const goals = store.state.goals.filter((g) => g.published === 1);
  openModal({
    title: '添加个人待办',
    body: `<div class="form-grid">
      ${field('任务名称', `<input class="input" name="title" placeholder="例如：整理本周灵感库" autofocus>`, '', true)}
      ${field('描述／交付要求', `<textarea class="input" name="description" rows="2" placeholder="选填"></textarea>`, '', true)}
      ${field('关联主营目标', `<select class="input" name="goal_id">
        ${selectOptions(goals.map((g) => ({ value: g.id, label: g.title })), '', '不关联目标（临时任务）')}
      </select>`, '关联后会计入该目标的完成率', false)}
      ${field('所属版本', `<select class="input" name="version_id">${versionOptions('')}</select>`, '', false)}
      ${field('截止日期', `<input class="input" type="date" name="due_date">`, '选填；未设置不触发临期提醒', false)}
      ${field('优先级', `<select class="input" name="priority">
        ${selectOptions([{ value: 2, label: '普通' }, { value: 1, label: '中' }, { value: 0, label: '高' }], 2)}
      </select>`, '', false)}
    </div>`,
    footer: `<button class="btn" data-act="close-modal">取消</button>
             <button class="btn primary" data-act="submit-self-task">添加</button>`,
    onMount(el) {
      el.querySelector('[name="title"]').focus();
      el.querySelector('[data-act="submit-self-task"]').addEventListener('click', async () => {
        const title = el.querySelector('[name="title"]').value.trim();
        if (!title) { toast('请填写任务名称', 'err'); return; }
        await mutate('create_self_task', {
          title,
          description: el.querySelector('[name="description"]').value.trim(),
          goal_id: el.querySelector('[name="goal_id"]').value || null,
          version_id: el.querySelector('[name="version_id"]').value || null,
          due_date: el.querySelector('[name="due_date"]').value,
          priority: Number(el.querySelector('[name="priority"]').value),
        }, { toast: '已添加个人待办' });
        closeModal();
      });
    },
  });
}

/* ---------------- 动作 ---------------- */

export const actions = {
  'work-filter'(el) { store.ui.workFilter = el.dataset.filter; renderApp(); },

  'close-detail'() { store.ui.selectedTaskId = null; renderApp(); },

  'add-self-task'() { openSelfTaskModal(); },

  'toggle-task'(el, ev) {
    ev.stopPropagation();
    const id = el.dataset.id;
    const t = store.state.tasks.find((x) => x.id === id);
    if (!t) return;
    mutate('set_task_status', { id, status: t.status === 'done' ? 'todo' : 'done' });
  },

  'set-status'(el) {
    mutate('set_task_status', { id: el.dataset.id, status: el.dataset.status });
  },

  'toggle-step'(el) { mutate('toggle_step', { id: el.dataset.id }); },

  'delete-step'(el) { mutate('delete_step', { id: el.dataset.id }); },

  'add-step'(el, ev) {
    const card = el.closest('.card');
    const input = card.querySelector('[data-step-input]');
    const title = input.value.trim();
    if (!title) { toast('请输入步骤内容', 'err'); input.focus(); return; }
    mutate('add_step', { taskId: el.dataset.id, title }).then(() => {
      const again = document.querySelector('[data-step-input]');
      if (again) again.focus();
    });
  },

  'delete-task'(el) {
    const id = el.dataset.id;
    const t = store.state.tasks.find((x) => x.id === id);
    confirmModal('删除任务', `确认删除「${esc(t?.title || '')}」？该任务的个人步骤与完成记录会一并移除。`, async () => {
      store.ui.selectedTaskId = null;
      await mutate('delete_task', { id });
    }, '删除');
  },

  'task-menu'(el, ev) {
    ev.stopPropagation();
    const id = el.dataset.id;
    const all = myTasks().slice().sort((a, b) => (a.personal_order ?? 1e9) - (b.personal_order ?? 1e9));
    const i = all.findIndex((t) => t.id === id);
    const t = all[i];
    const items = [
      { label: t.status === 'done' ? '标记为未开始' : '标记为已完成', act: 'menu-set-status', id },
      { sep: true },
      { label: '打开详情', act: 'menu-open', id },
    ];
    if (i > 0) items.push({ label: '上移一位', act: 'menu-up', id });
    if (i >= 0 && i < all.length - 1) items.push({ label: '下移一位', act: 'menu-down', id });
    openMenu(ev, items);
  },
};

document.addEventListener('click', menuClickHandler({
  'menu-open': (id) => { store.ui.selectedTaskId = id; renderApp(); },
  'menu-set-status': (id) => {
    const t = store.state.tasks.find((x) => x.id === id);
    mutate('set_task_status', { id, status: t.status === 'done' ? 'todo' : 'done' });
  },
  'menu-up': (id) => move(id, -1),
  'menu-down': (id) => move(id, 1),
}));

async function move(id, delta) {
  const all = myTasks().slice().sort((a, b) => (a.personal_order ?? 1e9) - (b.personal_order ?? 1e9));
  const order = all.map((t) => t.id);
  const i = order.indexOf(id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= order.length) return;
  [order[i], order[j]] = [order[j], order[i]];
  await mutate('reorder_tasks', { orderedIds: order, userId: currentUserId() });
}

/* 列表内容变化时保持详情面板同步 */
document.addEventListener('click', (e) => {
  const row = e.target.closest('[data-task-row]');
  if (!row) return;
  if (e.target.closest('[data-act]')) return; // 由具体动作处理
  store.ui.selectedTaskId = row.dataset.taskRow;
  renderApp();
});
