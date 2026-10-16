/* 入口：载入状态 → 绑定事件 → 渲染 */

import { loadState, store, setStateListener } from './api.js';
import { setAuthProfile } from './api.js';
import { bindGlobalEvents, render } from './shell.js';
import { toast } from './util.js';
import { bootstrapStatus, currentProfile } from './auth.js';
import { renderLogin, renderSetup } from './pages/login.js';
import { startAutoRefresh } from './refresh.js';

/* 任何数据变更后自动重绘（重绘在同一帧内合并） */
setStateListener(render);

/* ---------------- 表单输入（不重绘，避免抢焦点） ---------------- */

let queryTimer = null;

document.addEventListener('input', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  if (act === 'hs-query') {
    store.ui.hsQuery = el.value;
  } else if (act === 'work-query') {
    store.ui.workQuery = el.value;
    clearTimeout(queryTimer);
    queryTimer = setTimeout(() => render(), 220);
  }
});

/* ---------------- 下拉筛选与回车 ---------------- */

document.addEventListener('change', (e) => {
  const el = e.target.closest('select[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  switch (act) {
    case 'work-version': store.ui.workVersion = el.value; render(); break;
    case 'work-sort': store.ui.workSort = el.value; render(); break;
    case 'cal-version': store.ui.calVersion = el.value; render(); break;
    case 'team-version': store.ui.teamVersion = el.value; render(); break;
    case 'team-status': store.ui.teamStatus = el.value; render(); break;
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const el = e.target.closest('[data-hs-enter]');
  if (el) {
    e.preventDefault();
    store.ui.hsQuery = el.value;
    import('./pages/hotspot.js').then((m) => m.actions['hs-search']());
    return;
  }
  // 步骤输入框回车提交
  if (e.target.matches('[data-step-input]')) {
    e.preventDefault();
    const btn = e.target.closest('.card')?.querySelector('[data-act="add-step"]');
    if (btn) btn.click();
  }
});

/* ---------------- 启动 ---------------- */

async function boot() {
  bindGlobalEvents();
  try {
    const status = await bootstrapStatus();
    const activate = async (profile) => {
      setAuthProfile(profile);
      document.getElementById('app').className = 'app';
      await loadState();
      render();
      startAutoRefresh();
    };
    if (status.needsBootstrap) {
      renderSetup(async () => renderLogin(activate));
      return;
    }
    const profile = await currentProfile();
    if (!profile) {
      renderLogin(activate);
      return;
    }
    await activate(profile);
  } catch (err) {
    document.getElementById('app').innerHTML =
      `<div class="boot">无法连接工作台：${err.message}<br>请确认本地服务与网络连接正常。</div>`;
    toast('载入工作台失败', 'err');
  }
}

boot();
