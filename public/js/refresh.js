import { loadState, store } from './api.js';
import { toast } from './util.js';
import { AUTO_REFRESH_MS, shouldAutoRefresh } from './refresh-policy.js';

let refreshTimer = null;
let refreshing = false;

function isEditing() {
  const active = document.activeElement;
  return !!active?.matches?.('input, textarea, select, [contenteditable="true"]');
}

function restoreScroll(top) {
  requestAnimationFrame(() => {
    const content = document.querySelector('.content');
    if (content) content.scrollTop = top;
  });
}

export async function refreshWorkbench({ manual = false } = {}) {
  if (refreshing) return false;
  if (!manual && !shouldAutoRefresh({
    hidden: document.hidden,
    loading: store.loading,
    modalOpen: !!document.querySelector('.modal-mask'),
    editing: isEditing(),
  })) return false;

  const scrollTop = document.querySelector('.content')?.scrollTop || 0;
  refreshing = true;
  try {
    await loadState();
    restoreScroll(scrollTop);
    if (manual) toast('已更新到最新数据', 'ok');
    return true;
  } catch (error) {
    if (manual) toast(`刷新失败：${error.message || '请稍后重试'}`, 'err');
    return false;
  } finally {
    refreshing = false;
  }
}

export function startAutoRefresh() {
  if (refreshTimer) return;
  refreshTimer = setInterval(() => refreshWorkbench(), AUTO_REFRESH_MS);
}
