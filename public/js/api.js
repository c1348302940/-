/* 数据层：与本地服务通信 + 全局状态 + 视角（成员／主营）管理 */

import { toast } from './util.js';
import { authFetch } from './auth.js';

/**
 * 状态变化后的重绘回调。由外壳注册，避免 api ↔ shell 的循环依赖。
 * @type {null | (() => void)}
 */
let stateListener = null;
export function setStateListener(fn) { stateListener = fn; }
function notify() { if (stateListener) stateListener(); }

export const store = {
  /** 服务端状态快照 */
  state: null,
  /** 界面状态（不持久化） */
  ui: {
    role: 'member',        // 由已登录账号决定
    memberId: null,
    page: 'dashboard',
    tabs: ['dashboard'],   // 顶部标签
    adminSection: 'content', // content | team
    // 我的工作
    workFilter: 'open',    // open | todo | doing | done | all
    workVersion: 'all',
    workQuery: '',
    workSort: 'personal',  // personal | due
    selectedTaskId: null,
    // 主营团队看台
    teamMember: 'all',
    teamVersion: 'all',
    teamStatus: 'all',
    teamQuery: '',
    teamVizView: '2d',
    teamVizYaw: Math.PI / 6,
    // 版本节点
    msVersion: 'all',
    // 本月排期
    calYear: null,
    calMonth: null,
    calVersion: 'all',
    calSelected: null,
    // 版本卖点
    spVersion: 'all',
    spId: null,
    // 热点雷达
    hsPlatform: 'douyin',
    hsSection: 'hot',      // hot | <sectionKey>
    hsCompetitor: 'nishuihan',
    hsQuery: '',
    hsSearchResult: null,
    hsSearchKeyword: '',
    hsBusy: false,
  },
  loading: false,
  accountOpen: false,
  authProfile: null,
};

export function setAuthProfile(profile) {
  store.authProfile = profile;
  store.ui.role = profile?.role === 'admin' ? 'admin' : 'member';
  store.ui.memberId = profile?.id || null;
}

/** 当前生效的工作台用户 id（主营视角固定为主营） */
export function currentUserId() {
  return store.authProfile?.id || store.ui.memberId;
}

export function currentUser() {
  if (!store.state) return null;
  const id = currentUserId();
  return store.state.users.find((u) => u.id === id) || store.state.users[0] || null;
}

export function isAdmin() { return store.authProfile?.role === 'admin'; }

/* ------------------------------------------------------------------ */
/* 网络                                                                */
/* ------------------------------------------------------------------ */

export async function loadState() {
  const res = await authFetch('/api/state');
  if (!res.ok) throw new Error('读取工作台数据失败');
  store.state = await res.json();
  normalizeUi();
  notify();
  return store.state;
}

export async function mutate(action, payload = {}, opts = {}) {
  store.loading = true;
  try {
    const res = await authFetch('/api/mutate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, payload }),
    });
    const data = await res.json();
    if (!res.ok || data.ok === false) throw new Error(data.error || '操作失败');
    store.state = data;
    normalizeUi();
    notify();
    if (opts.toast) toast(opts.toast, 'ok');
    return data;
  } catch (e) {
    toast(e.message || '操作失败', 'err');
    throw e;
  } finally {
    store.loading = false;
  }
}

/** 保持界面筛选值落在有效范围内（例如删除后 id 失效） */
function normalizeUi() {
  const s = store.state;
  const ui = store.ui;
  if (!s) return;

  ui.memberId = store.authProfile?.id || s.viewerId;
  // 选中任务
  if (ui.selectedTaskId && !s.tasks.some((t) => t.id === ui.selectedTaskId)) ui.selectedTaskId = null;
  // 选中卖点
  if (ui.spId && !s.sellingPoints.some((p) => p.id === ui.spId)) ui.spId = null;
  // 排期默认选中今天
  if (!ui.calSelected) ui.calSelected = s.today;
  // 月历默认当前月
  if (ui.calYear == null) {
    const d = new Date();
    ui.calYear = d.getFullYear();
    ui.calMonth = d.getMonth() + 1;
  }
}

/* ------------------------------------------------------------------ */
/* 派生选择器                                                          */
/* ------------------------------------------------------------------ */

export function userById(id) {
  return store.state?.users.find((u) => u.id === id) || null;
}
export function versionById(id) {
  return store.state?.versions.find((v) => v.id === id) || null;
}
export function goalById(id) {
  return store.state?.goals.find((g) => g.id === id) || null;
}
export function milestoneById(id) {
  return store.state?.milestones.find((m) => m.id === id) || null;
}
export function scheduleById(id) {
  return store.state?.scheduleItems.find((s) => s.id === id) || null;
}
export function stepsOf(taskId) {
  return (store.state?.steps || []).filter((s) => s.task_id === taskId).sort((a, b) => a.sort - b.sort || a.id - b.id);
}

/** 当前视角用户可见的任务：成员只看自己的；主营看全部（用于总台统计） */
export function myTasks() {
  const id = currentUserId();
  let list = (store.state?.tasks || []).filter((t) => t.assignee_id === id);
  if (store.ui.workVersion !== 'all') {
    const v = store.ui.workVersion;
    list = list.filter((t) => t.version_id === v);
  }
  const q = store.ui.workQuery.trim().toLowerCase();
  if (q) {
    list = list.filter((t) =>
      t.title.toLowerCase().includes(q) || (t.description || '').toLowerCase().includes(q));
  }
  if (store.ui.workSort === 'due') {
    list = list.slice().sort((a, b) => {
      if (!a.due_date && !b.due_date) return a.personal_order - b.personal_order;
      if (!a.due_date) return 1;
      if (!b.due_date) return -1;
      return a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : 0;
    });
  } else {
    list = list.slice().sort((a, b) => (a.personal_order ?? 1e9) - (b.personal_order ?? 1e9) || a.id - b.id);
  }
  return list;
}

export function filterByStatus(list, filter) {
  switch (filter) {
    case 'todo': return list.filter((t) => t.status === 'todo');
    case 'doing': return list.filter((t) => t.status === 'doing');
    case 'done': return list.filter((t) => t.status === 'done');
    case 'open': return list.filter((t) => t.status !== 'done');
    default: return list;
  }
}

/** 成员可见的已发布内容；主营视角可见全部（含草稿） */
export function visibleSellingPoints() {
  const all = store.state?.sellingPoints || [];
  return isAdmin() ? all : all.filter((p) => p.published === 1);
}
export function visibleScheduleItems() {
  const all = store.state?.scheduleItems || [];
  return isAdmin() ? all : all.filter((s) => s.published === 1);
}
export function visibleMilestones() {
  const all = store.state?.milestones || [];
  return isAdmin() ? all : all.filter((m) => m.published === 1);
}

/* ---------------- 热点 ---------------- */

export function platformState(platform) {
  const c = (store.state?.connections || []).find((x) => x.platform === platform);
  return c || { platform, status: 'disconnected', status_detail: '', connected_at: null };
}

export function trendsOf(platform, section) {
  let list = (store.state?.trendItems || []).filter((t) => t.platform === platform);
  if (section && section !== 'hot') {
    list = list.filter((t) => (t.category || '').split(',').includes(section));
  }
  return list;
}

export function savedTopicsOf(platform) {
  return (store.state?.savedTopics || []).filter((t) => t.platform === platform);
}

/* ---------------- 提醒 ---------------- */

export function reminders() {
  return store.state?.reminders || { items: [], contentUpdates: [], overdueCount: 0, dueCount: 0 };
}

/** 主导航上的红点：仅在个人工作台提示逾期任务数，避免同一数字在多处重复 */
export function navBadge(page) {
  if (page !== 'dashboard') return 0;
  return reminders().overdueCount || 0;
}
