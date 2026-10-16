/* 通用工具：转义、日期、图标、DOM 小助手 */

export function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ---------------- 日期 ---------------- */

export function todayStr() {
  const d = new Date();
  return ymd(d);
}

export function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function parseDate(s) {
  if (!s) return null;
  const d = new Date(s + 'T00:00:00');
  return isNaN(d.getTime()) ? null : d;
}

export function diffDays(dateStr, base) {
  const d = parseDate(dateStr);
  if (!d) return null;
  const t = parseDate(base || todayStr());
  return Math.round((d - t) / 86400000);
}

const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function weekday(dateStr) {
  const d = parseDate(dateStr);
  return d ? WEEK[d.getDay()] : '';
}

/** 2026-10-12 → 10月12日 */
export function md(dateStr) {
  const d = parseDate(dateStr);
  return d ? `${d.getMonth() + 1}月${d.getDate()}日` : '未设置';
}

/** 2026-10-12 → 2026年10月12日 */
export function ymdCn(dateStr) {
  const d = parseDate(dateStr);
  return d ? `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日` : '未设置';
}

export function ymCn(year, month) {
  return `${year}年${month}月`;
}

/** 相对描述：还有 3 天 / 今天 / 已逾期 2 天 */
export function relative(dateStr, base) {
  const n = diffDays(dateStr, base);
  if (n === null) return '';
  if (n === 0) return '今天';
  if (n === 1) return '明天';
  if (n > 1) return `还有 ${n} 天`;
  return `已逾期 ${-n} 天`;
}

export function dueClass(dateStr, done, base) {
  if (!dateStr || done) return '';
  const n = diffDays(dateStr, base);
  if (n === null) return '';
  if (n < 0) return 'over';
  if (n <= 1) return 'soon';
  return '';
}

export function nowStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/* ---------------- 图标（轻量线性图标） ---------------- */

const S = (d, extra = '') =>
  `<svg class="ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;

export const ICON = {
  home: S('<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>'),
  list: S('<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>'),
  flag: S('<path d="M5 21V4"/><path d="M5 5h11l-1.5 4L16 13H5"/>'),
  cal: S('<rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
  star: S('<path d="m12 3.6 2.6 5.3 5.9.9-4.2 4.1 1 5.8-5.3-2.8-5.3 2.8 1-5.8L3.5 9.8l5.9-.9z"/>'),
  radar: S('<path d="M19.1 4.9A10 10 0 1 0 12 22"/><path d="M15.5 8.5A5 5 0 1 0 12 17"/><path d="M12 12 20.5 3.5"/>'),
  grid: S('<rect x="3" y="3" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="2"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2"/>'),
  check: S('<path d="m4.5 12.5 5 5 10-11"/>'),
  plus: S('<path d="M12 5v14M5 12h14"/>'),
  x: S('<path d="M6 6l12 12M18 6 6 18"/>'),
  chevR: S('<path d="m9 5 7 7-7 7"/>'),
  chevL: S('<path d="m15 5-7 7 7 7"/>'),
  chevD: S('<path d="m5 9 7 7 7-7"/>'),
  search: S('<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>'),
  refresh: S('<path d="M20 11a8 8 0 1 0-.7 4.3"/><path d="M20 5v6h-6"/>'),
  edit: S('<path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z"/>'),
  trash: S('<path d="M4 7h16M9.5 7V4.8h5V7M6.5 7l1 13h9l1-13"/>'),
  drag: S('<path d="M8 7h.01M8 12h.01M8 17h.01M16 7h.01M16 12h.01M16 17h.01"/>'),
  dots: S('<path d="M6 12h.01M12 12h.01M18 12h.01"/>'),
  alert: S('<path d="M12 3.8 21 19.5H3z"/><path d="M12 10v4M12 17h.01"/>'),
  bell: S('<path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6"/><path d="M10.5 20h3"/>'),
  link: S('<path d="M10.5 13.5a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1 1"/><path d="M13.5 10.5a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1-1"/>'),
  file: S('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>'),
  folder: S('<path d="M3 7.5A2 2 0 0 1 5 5.5h4l2 2.5h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  target: S('<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/>'),
  user: S('<circle cx="12" cy="8" r="3.8"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>'),
  inbox: S('<path d="M3 13h5l1.5 3h5L16 13h5"/><path d="M5.5 5h13l2.5 8v4a2 2 0 0 1-2 2h-14a2 2 0 0 1-2-2v-4z"/>'),
  send: S('<path d="M21 3 10.5 13.5"/><path d="M21 3l-6.5 18-4-8-8-4z"/>'),
  external: S('<path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M18 14.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4.5"/>'),
  eye: S('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>'),
  lock: S('<rect x="4.5" y="10.5" width="15" height="10" rx="2"/><path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7"/>'),
};

/* ---------------- DOM 小助手 ---------------- */

export function $(sel, root = document) { return root.querySelector(sel); }
export function $$(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

export function toast(msg, kind = '') {
  const root = document.getElementById('toast-root');
  const el = document.createElement('div');
  el.className = 'toast' + (kind ? ' ' + kind : '');
  el.textContent = msg;
  root.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .25s'; }, 2600);
  setTimeout(() => el.remove(), 2950);
}

export function initials(name) {
  return (name || '?').slice(0, 1);
}

export function emptyState(title, desc, actionHtml = '', emo = 'inbox') {
  return `<div class="empty">
    <div class="emo">${ICON[emo] || ICON.inbox}</div>
    <h4>${esc(title)}</h4>
    <p>${desc}</p>
    ${actionHtml}
  </div>`;
}
