/* 版本卖点：按版本查看已发布的传播口径、素材入口与注意事项 */

import { esc, ICON, emptyState, nowStamp } from '../util.js';
import { store, visibleSellingPoints, isAdmin, versionById } from '../api.js';
import { go, render as renderApp } from '../shell.js';

export function render() {
  const ui = store.ui;
  const versions = store.state.versions;
  const all = visibleSellingPoints();
  const list = ui.spVersion === 'all' ? all : all.filter((p) => p.version_id === ui.spVersion);

  if (!ui.spId || !list.some((p) => p.id === ui.spId)) {
    ui.spId = list.length ? list[0].id : null;
  }
  const cur = list.find((p) => p.id === ui.spId) || null;

  return `
    <div class="page-head page-head-row">
      <div class="page-head">
        <h1 class="page-title">版本卖点</h1>
        <p class="page-sub">查看主营已发布的统一传播口径。${isAdmin() ? '' : '对外传播时请保持口径一致。'}</p>
      </div>
      <div class="btn-row" style="padding-top:6px">
        ${isAdmin() ? `<button class="btn sm" data-act="nav" data-page="admin">${ICON.edit} 在主营总台维护卖点</button>` : ''}
      </div>
    </div>

    <div class="toolbar">
      <div class="seg">
        <button class="${ui.spVersion === 'all' ? 'on' : ''}" data-act="sp-version" data-id="all">全部版本</button>
        ${versions.map((v) => {
          const n = all.filter((p) => p.version_id === v.id).length;
          return `<button class="${String(ui.spVersion) === String(v.id) ? 'on' : ''}" data-act="sp-version" data-id="${v.id}">
            <span class="vtag"><i style="background:${esc(v.color)}"></i>${esc(v.name)}</span>
            <span class="cnt">${n}</span>
          </button>`;
        }).join('')}
      </div>
      <span class="spacer"></span>
      ${cur && cur.published === 1
        ? `<span class="status-chip connected"><i></i>已发布 · 更新于 ${esc((cur.published_at || cur.updated_at || '').slice(0, 10))}</span>`
        : cur ? '<span class="pill orange">草稿（成员不可见）</span>' : ''}
    </div>

    ${list.length === 0
      ? `<div class="card">${emptyState(
          '暂无已发布的版本卖点',
          isAdmin() ? '在「主营总台 · 版本卖点」新增并发布后，成员即可看到统一口径。' : '主营尚未发布该版本的卖点，可先查看其它版本。',
          isAdmin() ? '<button class="btn sm primary" data-act="nav" data-page="admin">前往主营总台</button>' : '',
          'star')}</div>`
      : `<div class="card" style="display:grid;grid-template-columns:290px minmax(0,1fr)">
          <div class="sp-list">
            ${list.map((p, i) => `<button class="sp-item ${p.id === ui.spId ? 'on' : ''}" data-act="sp-select" data-id="${p.id}">
              <div class="sp-idx">卖点${['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'][i] || i + 1}</div>
              <div class="sp-name">${esc(p.title)}</div>
              <div class="sp-line">${esc(p.one_liner || '—')}</div>
              ${p.published !== 1 ? '<span class="pill orange" style="margin-top:5px">草稿</span>' : ''}
            </button>`).join('')}
          </div>
          <div class="card-body">${cur ? detail(cur) : ''}</div>
        </div>`}`;
}

function detail(p) {
  const v = versionById(p.version_id);
  return `
    <div style="margin-bottom:20px">
      <div style="font-size:var(--fs-xs);color:var(--text-3);margin-bottom:2px">卖点</div>
      <div class="sp-detail-title">${esc(p.title)}</div>
      <div style="font-size:var(--fs-sm);color:var(--text-3)">${esc(p.one_liner || '')}</div>
      <div style="display:flex;gap:8px;margin-top:9px;flex-wrap:wrap">
        ${v ? `<span class="pill outline">${esc(v.name)}</span>` : '<span class="pill gray">未关联版本</span>'}
        <span class="pill gray">最近更新 ${esc((p.updated_at || '').slice(0, 10))}</span>
      </div>
    </div>

    <div class="field">
      <div class="field-label">一句话表达</div>
      <div class="field-box">${esc(p.one_liner || '—')}</div>
    </div>

    <div class="field">
      <div class="field-label">适用内容</div>
      <div class="field-box">${esc(p.applicable_content || '—')}</div>
    </div>

    <div class="field">
      <div class="field-label">素材入口</div>
      ${p.material_link
        ? materialBox(p.material_link)
        : '<div class="field-box" style="color:var(--text-3)">暂无素材入口，如需素材请联系主营。</div>'}
    </div>

    <div class="field">
      <div class="field-label">注意事项</div>
      ${p.notes ? `<div class="note-box">${esc(p.notes)}</div>` : '<div class="field-box" style="color:var(--text-3)">暂无特别注意事项。</div>'}
    </div>`;
}

function materialBox(link) {
  // 素材入口可能是路径或 URL；路径用纯文本展示，URL 提供打开链接
  const isUrl = /^https?:\/\//i.test(link);
  const name = link.split(/[\\/]/).filter(Boolean).pop() || link;
  return `<div class="material">
    <span class="m-ico">${ICON.folder}</span>
    <span class="m-body">
      <span class="m-name">${esc(name)}</span>
      <span class="m-note">${esc(link)}</span>
    </span>
    ${isUrl
      ? `<a class="btn sm" href="${esc(link)}" target="_blank" rel="noopener">查看文件 ${ICON.external}</a>`
      : `<span class="pill gray">本地路径</span>`}
  </div>`;
}

export const actions = {
  'sp-version'(el) {
    store.ui.spVersion = el.dataset.id === 'all' ? 'all' : el.dataset.id;
    store.ui.spId = null;
    go('sellingpoints', { scrollTop: false });
  },
  'sp-select'(el) {
    store.ui.spId = el.dataset.id;
    renderApp();
  },
};
