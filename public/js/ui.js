/* 共享界面片段：状态徽标、进度条、任务行、弹窗、菜单 */

import { esc, ICON, md, relative, dueClass, $ } from './util.js';
import { store, userById, versionById, stepsOf } from './api.js';

export const STATUS_TEXT = { todo: '未开始', doing: '进行中', done: '已完成' };
export const STATUS_CLASS = { todo: 'gray', doing: 'blue', done: 'green' };

export const SOURCE_TEXT = { assigned: '主营分配', schedule: '排期生成', self: '自建' };
export const SOURCE_CLASS = { assigned: 'blue', schedule: '', self: 'gray' };

export const PRIORITY_TEXT = { 0: '高', 1: '中', 2: '普通' };
export const PRIORITY_CLASS = { 0: 'red', 1: 'orange', 2: 'gray' };

export function statusPill(status) {
  return `<span class="pill ${STATUS_CLASS[status] || 'gray'}">${STATUS_TEXT[status] || '未开始'}</span>`;
}

export function sourcePill(source) {
  if (!source) return '';
  return `<span class="pill ${SOURCE_CLASS[source] ?? ''}">${SOURCE_TEXT[source] || esc(source)}</span>`;
}

export function versionTag(versionId) {
  const v = versionById(versionId);
  if (!v) return `<span class="vtag" style="color:var(--text-3)">未关联版本</span>`;
  return `<span class="vtag" title="${esc(v.name)}"><i style="background:${esc(v.color)}"></i><span class="vt-name">${esc(v.name)}</span></span>`;
}

export function versionPill(versionId) {
  const v = versionById(versionId);
  if (!v) return '';
  return `<span class="pill outline">${esc(v.name)}</span>`;
}

export function progressBar(done, total, status) {
  // 没有步骤时不画进度条，把宽度让给任务名称
  if (total === 0) return '<span class="progress"><span class="progress-text">无步骤</span></span>';
  const pct = Math.round((done / total) * 100);
  const cls = status === 'done' ? 'done' : '';
  return `<span class="progress">
    <span class="progress-track"><span class="progress-fill ${cls}" style="width:${pct}%"></span></span>
    <span class="progress-text">${done}/${total}</span>
  </span>`;
}

/** 任务行（我的工作 / 工作台共用，行分割组织，不做独立卡片） */
export function taskRow(t, opts = {}) {
  const { today, draggable = false, selected = false, showAssignee = false } = opts;
  const done = t.status === 'done';
  const dc = dueClass(t.due_date, done, today);
  const assignee = showAssignee ? userById(t.assignee_id) : null;
  return `<div class="row ${selected ? 'selected' : ''}" data-task-row="${t.id}" ${draggable ? 'draggable="true"' : ''}>
    ${draggable ? `<span class="drag-handle" title="拖动调整个人顺序">${ICON.drag}</span>` : ''}
    <button class="cbx ${done ? 'on' : ''}" data-act="toggle-task" data-id="${t.id}"
      title="${done ? '标记为未开始' : '标记为已完成'}" aria-label="切换完成状态">${done ? ICON.check : ''}</button>
    <div class="row-main">
      <div class="row-title">
        <span class="t">${esc(t.title)}</span>
        ${t.priority === 0 && !done ? `<span class="pill red">高</span>` : ''}
        ${t.priority === 1 && !done ? `<span class="pill orange">中</span>` : ''}
        ${t.schedule_detached === 1 ? `<span class="pill gray" title="该任务原由内容排期自动生成；因你已有步骤或已开始处理，任务为你保留为独立历史记录">${esc(t.schedule_detach_reason || '原排期已移除')}</span>` : ''}
      </div>
      <div class="row-sub">${esc(t.description || '—')}</div>
    </div>
    <div class="row-col">
      ${assignee ? `<span class="vtag"><i style="background:${esc(assignee.color)}"></i>${esc(assignee.name)}</span>` : ''}
      ${versionTag(t.version_id)}
      ${progressBar(t.stepsDone, t.stepsTotal, t.status)}
      <span class="row-due ${dc}">${t.due_date ? md(t.due_date) : '无截止'}</span>
      ${statusPill(t.status)}
      <button class="row-menu" data-act="task-menu" data-id="${t.id}" title="更多操作">${ICON.dots}</button>
    </div>
  </div>`;
}

/* ------------------------------------------------------------------ */
/* 弹窗                                                                */
/* ------------------------------------------------------------------ */

let modalCleanup = null;

export function closeModal() {
  const root = document.getElementById('modal-root');
  root.innerHTML = '';
  if (modalCleanup) { modalCleanup(); modalCleanup = null; }
}

/**
 * 打开弹窗。
 * @param {{title:string, body:string, footer:string, wide?:boolean, onMount?:(el:HTMLElement)=>void}} cfg
 */
export function openModal(cfg) {
  const root = document.getElementById('modal-root');
  root.innerHTML = `<div class="modal-mask" data-mask>
    <div class="modal ${cfg.wide ? 'wide' : ''}" role="dialog" aria-modal="true">
      <div class="modal-head">
        <h3>${esc(cfg.title)}</h3>
        <span class="spacer"></span>
        <button class="icon-btn" data-act="close-modal" aria-label="关闭">${ICON.x}</button>
      </div>
      <div class="modal-body">${cfg.body}</div>
      ${cfg.footer ? `<div class="modal-foot">${cfg.footer}</div>` : ''}
    </div>
  </div>`;
  const mask = root.querySelector('[data-mask]');
  const onMask = (e) => { if (e.target === mask) closeModal(); };
  const onKey = (e) => { if (e.key === 'Escape') closeModal(); };
  mask.addEventListener('mousedown', onMask);
  document.addEventListener('keydown', onKey);
  modalCleanup = () => document.removeEventListener('keydown', onKey);
  if (cfg.onMount) cfg.onMount(root.querySelector('.modal'));
}

export function confirmModal(title, message, onOk, okText = '确认') {
  openModal({
    title,
    body: `<p style="margin:0;font-size:var(--fs-body);line-height:1.8;color:var(--text-2)">${message}</p>`,
    footer: `<button class="btn" data-act="close-modal">取消</button>
             <button class="btn danger" data-act="confirm-ok">${esc(okText)}</button>`,
    onMount(el) {
      el.querySelector('[data-act="confirm-ok"]').addEventListener('click', async () => {
        closeModal();
        await onOk();
      });
    },
  });
}

/* ------------------------------------------------------------------ */
/* 浮动菜单                                                            */
/* ------------------------------------------------------------------ */

let menuEl = null;

export function closeMenu() {
  if (menuEl) { menuEl.remove(); menuEl = null; }
}

/**
 * @param {MouseEvent} ev
 * @param {Array<{label:string, act:string, id?:number, danger?:boolean}|{sep:true}>} items
 */
export function openMenu(ev, items) {
  closeMenu();
  const el = document.createElement('div');
  el.className = 'menu';
  el.innerHTML = items.map((it) => it.sep
    ? '<div class="menu-sep"></div>'
    : `<button class="${it.danger ? 'danger' : ''}" data-menu-act="${it.act}" data-menu-id="${it.id ?? ''}">${it.icon || ''}${esc(it.label)}</button>`
  ).join('');
  document.body.appendChild(el);
  const r = ev.currentTarget.getBoundingClientRect();
  const w = el.offsetWidth, h = el.offsetHeight;
  let left = Math.min(r.right - w, window.innerWidth - w - 10);
  let top = r.bottom + 6;
  if (top + h > window.innerHeight - 10) top = Math.max(10, r.top - h - 6);
  el.style.left = Math.max(10, left) + 'px';
  el.style.top = top + 'px';
  menuEl = el;
  return el;
}

export function menuClickHandler(handlers) {
  return (e) => {
    const btn = e.target.closest('[data-menu-act]');
    if (!btn) return;
    const act = btn.dataset.menuAct;
    const id = btn.dataset.menuId || null;
    closeMenu();
    const fn = handlers[act];
    if (fn) fn(id, e);
  };
}

/* ------------------------------------------------------------------ */
/* 表单小片段                                                          */
/* ------------------------------------------------------------------ */

export function selectOptions(items, value, placeholder) {
  const ph = placeholder ? `<option value="">${esc(placeholder)}</option>` : '';
  return ph + items.map((it) =>
    `<option value="${it.value}" ${String(it.value) === String(value) ? 'selected' : ''}>${esc(it.label)}</option>`
  ).join('');
}

export function versionOptions(value, includeAll) {
  const items = store.state.versions.map((v) => ({ value: v.id, label: v.name }));
  return selectOptions(items, value, includeAll ? '全部版本' : '不关联版本');
}

export function userOptions(value, excludeAdmin) {
  const items = store.state.users
    .filter((u) => !excludeAdmin || u.role !== 'admin')
    .map((u) => ({ value: u.id, label: `${u.name}（${u.title || '成员'}）` }));
  return selectOptions(items, value);
}

/**
 * 读取弹窗表单值。
 * @param {HTMLElement} el
 * @param {string[]} names
 */
export function formValues(el, names) {
  const out = {};
  for (const n of names) {
    const f = el.querySelector(`[name="${n}"]`);
    if (!f) continue;
    out[n] = f.type === 'checkbox' ? f.checked : f.value.trim();
  }
  return out;
}

export function field(label, control, hint, full) {
  return `<div class="form-row ${full ? 'full' : ''}">
    <label>${esc(label)}</label>
    ${control}
    ${hint ? `<span class="hint">${esc(hint)}</span>` : ''}
  </div>`;
}
