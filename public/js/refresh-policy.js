export const AUTO_REFRESH_MS = 10 * 60 * 1000;

export function shouldAutoRefresh({ hidden, loading, modalOpen, editing }) {
  return !hidden && !loading && !modalOpen && !editing;
}
