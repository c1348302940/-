/* 应用外壳：左侧导航 + 顶部标签栏 + 内容区 + 账号/视角切换 */

import { esc, ICON, initials, toast } from './util.js';
import { store, currentUser, isAdmin, currentUserId, mutate, loadState, reminders, navBadge } from './api.js';
import { closeMenu, closeModal } from './ui.js';
import { signOut } from './auth.js';

import * as dashboard from './pages/dashboard.js';
import * as mywork from './pages/mywork.js';
import * as milestones from './pages/milestones.js';
import * as schedule from './pages/schedule.js';
import * as sellingpoints from './pages/sellingpoints.js';
import * as hotspot from './pages/hotspot.js';
import * as admin from './pages/admin.js';

export const PAGES = {
  dashboard: { label: '我的工作台', icon: 'home', mod: dashboard },
  mywork: { label: '我的工作', icon: 'list', mod: mywork },
  milestones: { label: '版本节点', icon: 'flag', mod: milestones },
  schedule: { label: '本月排期', icon: 'cal', mod: schedule },
  sellingpoints: { label: '版本卖点', icon: 'star', mod: sellingpoints },
  hotspot: { label: '热点雷达', icon: 'radar', mod: hotspot },
  admin: { label: '主营总台', icon: 'grid', mod: admin },
};

export function go(page, opts = {}) {
  if (!PAGES[page]) return;
  if (page === 'admin' && !isAdmin()) { toast('请先切换到主营视角'); return; }
  const ui = store.ui;
  if (!ui.tabs.includes(page)) ui.tabs.push(page);
  ui.page = page;
  ui.accountOpen = false;
  closeMenu();
  render();
  if (opts.scrollTop !== false) {
    const c = document.querySelector('.content');
    if (c) c.scrollTop = 0;
  }
}

export function closeTab(page, ev) {
  if (ev) ev.stopPropagation();
  const ui = store.ui;
  if (ui.tabs.length <= 1) { toast('至少保留一个标签页'); return; }
  const i = ui.tabs.indexOf(page);
  ui.tabs.splice(i, 1);
  if (ui.page === page) ui.page = ui.tabs[Math.max(0, i - 1)];
  render();
}

/* ------------------------------------------------------------------ */
/* 渲染                                                                */
/* ------------------------------------------------------------------ */

let renderQueued = false;

export function render() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    paint();
  });
}

function paint() {
  const app = document.getElementById('app');
  const ui = store.ui;
  const s = store.state;
  if (!s) return;
  app.setAttribute('aria-busy', 'false');
  const page = PAGES[ui.page] || PAGES.dashboard;
  const mod = page.mod;

  const scrollTop = document.querySelector('.content')?.scrollTop || 0;

  // 首个标签处于选中态时，内容卡片左上角与标签底部内凹圆角衔接，故不再单独倒角
  const roundTl = ui.tabs.indexOf(ui.page) > 0;

  app.innerHTML = `
    ${sidebarHtml()}
    <div class="main">
      ${tabbarHtml()}
      <div class="main-body">
        <div class="content ${roundTl ? 'round-tl' : ''}" id="content">
          <div class="page page-${ui.page}" id="page-root">${mod.render()}</div>
        </div>
      </div>
    </div>`;

  const c = document.getElementById('content');
  if (c && mod.keepScroll) c.scrollTop = scrollTop;

  if (mod.afterRender) mod.afterRender(document.getElementById('page-root'));
}

/* ---------------- 侧栏 ---------------- */

function sidebarHtml() {
  const ui = store.ui;
  const me = currentUser();
  const r = reminders();
  return `<aside class="sidebar">
    <div class="sidebar-head">
      <div class="brand">
        <span class="brand-logo">T</span>
        <span class="brand-name">天谕手游团队</span>
      </div>
      <button class="brand-collapse" title="收起侧栏（示意）" data-act="noop">${ICON.chevL}</button>
    </div>
    <nav class="nav">
      ${Object.entries(PAGES).filter(([key]) => key !== 'admin' || isAdmin()).map(([key, p]) => {
        const badge = navBadge(key);
        return `<button class="nav-item ${ui.page === key ? 'active' : ''}" data-act="nav" data-page="${key}">
          ${ICON[p.icon]}<span>${p.label}</span>
          ${badge ? `<span class="nav-badge">${badge}</span>` : ''}
        </button>`;
      }).join('')}
    </nav>
    <div class="sidebar-foot">
      ${ui.accountOpen ? accountPopover() : ''}
      <button class="account" data-act="toggle-account">
        <span class="avatar" style="background:${esc(me?.color || '#6a7ae0')}">${esc(initials(me?.name))}</span>
        <span class="account-meta">
          <span class="account-name">${esc(me?.name || '—')}${isAdmin() ? ' · 主营' : ''}</span>
          <span class="account-title">${esc(me?.title || '')}</span>
        </span>
        ${r.overdueCount ? `<span class="nav-badge" title="逾期任务">${r.overdueCount}</span>` : ''}
      </button>
    </div>
  </aside>`;
}

function accountPopover() {
  return `<div class="popover">
    <div class="popover-label">当前账号</div>
    <div class="popover-note">${esc(currentUser()?.name || '')} · ${isAdmin() ? '主营销' : '成员'}</div>
    <button class="popover-item" data-act="sign-out">${ICON.refresh}<span>退出登录</span></button>
  </div>`;
}

/* ---------------- 顶部标签 ---------------- */

function tabbarHtml() {
  const ui = store.ui;
  const canClose = ui.tabs.length > 1;
  return `<div class="tabbar">
    <div class="tabs" role="tablist">
      ${ui.tabs.map((k) => {
        const p = PAGES[k];
        if (!p) return '';
        return `<div class="tab ${ui.page === k ? 'active' : ''}" role="tab"
            aria-selected="${ui.page === k}" data-act="tab" data-page="${k}">
          ${ICON[p.icon]}<span class="tab-label">${p.label}</span>
          ${canClose ? `<span class="tab-close" data-act="close-tab" data-page="${k}" title="关闭标签">${ICON.x}</span>` : ''}
        </div>`;
      }).join('')}
      <button class="tab-add" title="打开页面" data-act="tab-add">${ICON.plus}</button>
    </div>
    <div class="tabbar-right">
      ${store.loading ? `<span class="loading"><span class="spin"></span>保存中…</span>` : ''}
    </div>
  </div>`;
}

/* ------------------------------------------------------------------ */
/* 全局交互                                                            */
/* ------------------------------------------------------------------ */

const GLOBAL_ACTIONS = {
  noop() {},

  nav(el) { go(el.dataset.page); },

  tab(el) { go(el.dataset.page); },

  'close-tab'(el, ev) {
    closeTab(el.dataset.page, ev);
  },

  'tab-add'(el, ev) {
    const items = Object.entries(PAGES).filter(([k]) => k !== 'admin' || isAdmin())
      .map(([k, p]) => ({ label: p.label, act: 'nav', id: k }));
    const menu = document.createElement('div');
    menu.className = 'menu';
    menu.innerHTML = items.map((i) => `<button data-menu-act="nav" data-menu-id="${i.id}">${ICON[PAGES[i.id].icon]}${esc(i.label)}</button>`).join('');
    document.body.appendChild(menu);
    const r = el.currentTarget.getBoundingClientRect();
    menu.style.left = Math.min(r.left, window.innerWidth - 190) + 'px';
    menu.style.top = (r.bottom + 6) + 'px';
    const onDoc = (e) => {
      const btn = e.target.closest('[data-menu-act="nav"]');
      menu.remove();
      document.removeEventListener('mousedown', onDoc);
      if (btn) go(btn.dataset.menuId);
      else if (!e.target.closest('.menu')) { /* 点击空白关闭 */ }
    };
    setTimeout(() => document.addEventListener('mousedown', onDoc), 0);
  },

  'toggle-account'(el, ev) {
    ev.stopPropagation();
    store.ui.accountOpen = !store.ui.accountOpen;
    render();
  },

  'sign-out'() {
    signOut();
    location.reload();
  },

  'close-modal'() { closeModal(); },
};

export function bindGlobalEvents() {
  document.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-act]');
    if (el) {
      const act = el.dataset.act;
      const handler = GLOBAL_ACTIONS[act];
      if (handler) {
        e.preventDefault();
        // 点击账号区域内部不关闭弹层
        if (!el.closest('.popover')) {
          if (store.ui.accountOpen && !el.closest('.account')) {
            store.ui.accountOpen = false;
            render();
          }
        }
        await handler(el, e);
        return;
      }
      // 页面级动作
      const mod = PAGES[store.ui.page]?.mod;
      if (mod && mod.actions && mod.actions[act]) {
        e.preventDefault();
        await mod.actions[act](el, e);
        return;
      }
      // 其他已打开标签页的动作（例如菜单跨页）
      for (const p of store.ui.tabs) {
        const m = PAGES[p]?.mod;
        if (m && m.actions && m.actions[act]) { e.preventDefault(); await m.actions[act](el, e); return; }
      }
    }
    // 点击空白关闭弹层/菜单
    if (!e.target.closest('.menu') && !e.target.closest('[data-act="task-menu"]')) closeMenu();
    if (store.ui.accountOpen && !e.target.closest('.popover') && !e.target.closest('.account')) {
      store.ui.accountOpen = false;
      render();
    }
  });
}
