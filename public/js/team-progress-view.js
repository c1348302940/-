import { esc, ICON } from './util.js';

function selected(cell, memberId, versionId) {
  return String(memberId) === String(cell.memberId) && String(versionId) === String(cell.versionId);
}

function cellLabel(cell) {
  const step = cell.stepTotal ? `；步骤 ${cell.stepDone}/${cell.stepTotal}` : '；暂无步骤';
  return `${cell.memberName}，${cell.versionName}：完成 ${cell.done}/${cell.total}，进行中 ${cell.doing}，未开始 ${cell.todo}，逾期 ${cell.overdue}${step}`;
}

function cellsOf(matrix) {
  return matrix.rows.flatMap((row) => row.cells);
}

function activeCell(matrix, options) {
  const cells = cellsOf(matrix);
  return cells.find((cell) => selected(cell, options.memberId, options.versionId))
    || cells.find((cell) => cell.total > 0)
    || cells[0]
    || null;
}

function normalizedOptions(matrix, options) {
  const active = activeCell(matrix, options);
  return {
    ...options,
    activeMemberId: active?.memberId || '',
    activeVersionId: active?.versionId || '',
  };
}

function summary(matrix) {
  const result = cellsOf(matrix).reduce((all, cell) => ({
    total: all.total + cell.total,
    done: all.done + cell.done,
    doing: all.doing + cell.doing,
    overdue: all.overdue + cell.overdue,
  }), { total: 0, done: 0, doing: 0, overdue: 0 });
  result.rate = result.total ? Math.round(result.done / result.total * 100) : 0;
  return result;
}

function twoDimensional(matrix, options) {
  const cols = Math.max(1, matrix.columns.length);
  return `<div class="team-matrix-scroll">
    <div class="team-matrix" style="--team-cols:${cols}">
      <div class="team-matrix-corner">成员</div>
      ${matrix.columns.map((column) => `<div class="team-matrix-version" title="${esc(column.name)}">${esc(column.name)}</div>`).join('')}
      ${matrix.rows.map((row) => `
        <button class="team-matrix-member ${String(options.memberId) === String(row.member.id) ? 'selected' : ''}"
          data-act="team-member" data-id="${esc(row.member.id)}" title="查看 ${esc(row.member.name)} 的全部任务">${esc(row.member.name)}</button>
        ${row.cells.map((cell) => `<button class="team-matrix-cell ${cell.dimmed ? 'dimmed' : ''} ${selected(cell, options.activeMemberId, options.activeVersionId) ? 'selected' : ''}"
          data-level="${cell.level}" data-act="team-matrix-cell" data-member="${esc(cell.memberId)}" data-version="${esc(cell.versionId)}"
          aria-label="${esc(cellLabel(cell))}" title="${esc(cellLabel(cell))}"></button>`).join('')}`).join('')}
    </div>
  </div>`;
}

export function renderTeamProgress(matrix, rawOptions) {
  const options = normalizedOptions(matrix, rawOptions);
  if (!matrix.rows.length) return '<div class="team-viz-empty">加入成员后，这里会按成员和版本显示任务进度。</div>';
  if (!matrix.columns.length) return '<div class="team-viz-empty">当前版本筛选下没有可展示的版本。</div>';
  if (options.view === '3d') {
    return '<div class="team-city-wrap"><svg class="team-city" data-team-city role="img" aria-label="团队进度"></svg></div>';
  }
  return twoDimensional(matrix, options);
}

function versionSelector(options) {
  const items = options.versionOptions || [{ value: options.versionId || 'all', label: options.versionLabel || '全部版本' }];
  return `<select class="team-focus-scope" data-act="team-version" aria-label="筛选版本">
    ${items.map((item) => `<option value="${esc(item.value)}" ${String(item.value) === String(options.versionId || 'all') ? 'selected' : ''}>${esc(item.label)}</option>`).join('')}
  </select>`;
}

function legend(view) {
  return `<div class="team-focus-legend">
    <span>${view === '3d' ? '一栋代表一个成员版本进度' : '一格代表一个成员版本进度'}</span>
    <span class="team-focus-scale"><b>0</b><i data-level="0"></i><i data-level="1"></i><i data-level="2"></i><i data-level="3"></i><i data-level="4"></i><b>100%</b></span>
  </div>`;
}

export function renderTeamProgressPanel(matrix, rawOptions = {}) {
  const options = normalizedOptions(matrix, { view: '2d', memberId: 'all', versionId: 'all', ...rawOptions });
  const stats = summary(matrix);
  const active = activeCell(matrix, options);
  const allCells = cellsOf(matrix);
  const activeIndex = Math.max(0, allCells.findIndex((cell) => active && selected(cell, active.memberId, active.versionId)));
  const detail = active ? `${active.done}/${active.total} 已完成 · ${active.doing} 项进行中${active.stepTotal ? ` · 步骤 ${active.stepDone}/${active.stepTotal}` : ''}${active.overdue ? ` · ${active.overdue} 项逾期` : ''}` : '暂无可展示的进度';
  const filtered = options.memberId !== 'all' || options.versionId !== 'all';

  return `<section class="card team-progress-viz team-focus-card">
    <div class="team-focus-head">
      <div class="team-focus-identity"><span class="team-focus-icon">${ICON.target}</span>
        <div><h3>团队进度</h3><p>成员与版本，一眼看清推进状态。</p></div>
      </div>
      <div class="team-focus-controls">
        ${filtered ? '<button class="btn sm ghost" data-act="team-matrix-reset">查看全部</button>' : ''}
        ${versionSelector(options)}
        <div class="team-viz-switch" role="group" aria-label="进度图显示方式">
          <button data-act="team-viz-view" data-view="3d" aria-pressed="${options.view === '3d'}">3D</button>
          <button data-act="team-viz-view" data-view="2d" aria-pressed="${options.view === '2d'}">${ICON.grid}<span>2D</span></button>
        </div>
      </div>
    </div>
    <div class="team-focus-stats">
      <div class="team-focus-stat"><span>团队完成率</span><strong>${stats.rate}%</strong><small>${stats.done}/${stats.total} 项任务已完成</small></div>
      <div class="team-focus-stat"><span>进行中任务</span><strong>${stats.doing}</strong><small>${matrix.rows.length} 名成员 · ${matrix.columns.length} 个版本</small></div>
      <div class="team-focus-stat"><span>逾期任务</span><strong>${stats.overdue}</strong><small>${stats.overdue ? '需要优先关注' : '当前没有逾期'}</small></div>
    </div>
    <div class="team-focus-plot-head"><span>${esc(options.versionLabel || '成员 × 版本')}</span><span>${options.view === '3d' ? '拖动旋转' : '选择一个进度格'}</span></div>
    <div class="team-viz-body">${renderTeamProgress(matrix, options)}</div>
    ${legend(options.view)}
    <div class="team-focus-detail">
      <span class="team-focus-avatar" style="background:${esc(active?.memberColor || '#8792a2')}">${esc((active?.memberName || '?').slice(0, 1))}</span>
      <div class="team-focus-detail-copy"><strong>${esc(active ? `${active.memberName} · ${active.versionName}` : '暂无进度')}</strong><span>${esc(detail)}</span></div>
      <span class="spacer"></span><span class="team-focus-position">${allCells.length ? `${activeIndex + 1} / ${allCells.length}` : '0 / 0'}</span>
      <button class="team-focus-arrow" data-act="team-matrix-shift" data-step="-1" aria-label="上一个进度">‹</button>
      <button class="team-focus-arrow" data-act="team-matrix-shift" data-step="1" aria-label="下一个进度">›</button>
    </div>
    <div class="team-focus-breakdown"><span>对应任务</span><strong>${active?.total || 0} 项</strong><span class="spacer"></span><span>下方工作清单会同步筛选</span><span class="team-focus-chevron">⌄</span></div>
  </section>`;
}

function points(list) {
  return list.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
}

function cityMarkup(matrix, yaw, rawOptions) {
  const options = normalizedOptions(matrix, rawOptions);
  const cellSize = .78;
  const project = (x, y, z = 0) => [x * Math.cos(yaw) - y * Math.sin(yaw), (x * Math.sin(yaw) + y * Math.cos(yaw)) * .48 - z];
  const raw = [];
  matrix.rows.forEach((row, rowIndex) => row.cells.forEach((cell, columnIndex) => {
    const blockHeight = cell.total ? .15 + (cell.rate / 100) * .52 : .035;
    const base = [project(columnIndex, rowIndex), project(columnIndex + cellSize, rowIndex), project(columnIndex + cellSize, rowIndex + cellSize), project(columnIndex, rowIndex + cellSize)];
    const roof = [project(columnIndex, rowIndex, blockHeight), project(columnIndex + cellSize, rowIndex, blockHeight), project(columnIndex + cellSize, rowIndex + cellSize, blockHeight), project(columnIndex, rowIndex + cellSize, blockHeight)];
    raw.push({ cell, base, roof, depth: columnIndex * Math.sin(yaw) + rowIndex * Math.cos(yaw) });
  }));
  const ground = [project(-.35, -.35), project(matrix.columns.length -.05, -.35), project(matrix.columns.length -.05, matrix.rows.length -.05), project(-.35, matrix.rows.length -.05)];
  const vertices = [...ground, ...raw.flatMap((block) => [...block.base, ...block.roof])];
  const minX = Math.min(...vertices.map((point) => point[0])); const maxX = Math.max(...vertices.map((point) => point[0]));
  const minY = Math.min(...vertices.map((point) => point[1])); const maxY = Math.max(...vertices.map((point) => point[1]));
  const scale = Math.min(540 / Math.max(.1, maxX - minX), 205 / Math.max(.1, maxY - minY));
  const fit = ([x, y]) => [110 + (x - minX) * scale + (540 - (maxX - minX) * scale) / 2, 42 + (y - minY) * scale + (205 - (maxY - minY) * scale) / 2];
  const blocks = raw.sort((a, b) => a.depth - b.depth).map((block) => {
    const roof = block.roof.map(fit); const base = block.base.map(fit); const cell = block.cell;
    return `<g class="team-city-block ${cell.dimmed ? 'dimmed' : ''} ${selected(cell, options.activeMemberId, options.activeVersionId) ? 'selected' : ''}"
      data-level="${cell.level}" data-act="team-matrix-cell" data-member="${esc(cell.memberId)}" data-version="${esc(cell.versionId)}" role="button" tabindex="0" aria-label="${esc(cellLabel(cell))}">
      <title>${esc(cellLabel(cell))}</title>
      <polygon class="team-city-left" points="${points([roof[3], roof[2], base[2], base[3]])}" />
      <polygon class="team-city-right" points="${points([roof[1], roof[2], base[2], base[1]])}" />
      <polygon class="team-city-roof" points="${points(roof)}" />
    </g>`;
  }).join('');
  return `<polygon class="team-city-ground" points="${points(ground.map(fit))}" />${blocks}`;
}

export function mountTeamCity(root, matrix, options) {
  const svg = root.querySelector('[data-team-city]');
  if (!svg) return;
  svg.setAttribute('viewBox', '0 0 760 290');
  let yaw = Number.isFinite(options.yaw) ? options.yaw : Math.PI / 6;
  let drag = null;
  let suppressClick = false;
  const draw = () => { svg.innerHTML = cityMarkup(matrix, yaw, options); };
  draw();
  svg.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    drag = { x: event.clientX, yaw, moved: false, pointerId: event.pointerId };
  });
  svg.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const delta = event.clientX - drag.x;
    if (Math.abs(delta) > 5) {
      drag.moved = true; svg.classList.add('dragging'); svg.setPointerCapture?.(event.pointerId);
      yaw = Math.max(.28, Math.min(.82, drag.yaw + delta / 520)); options.onYaw?.(yaw); draw();
    }
  });
  const finish = () => { suppressClick = !!drag?.moved; drag = null; svg.classList.remove('dragging'); };
  svg.addEventListener('pointerup', finish);
  svg.addEventListener('pointercancel', finish);
  svg.addEventListener('click', (event) => {
    if (!suppressClick) return;
    event.preventDefault(); event.stopImmediatePropagation(); suppressClick = false;
  }, true);
  svg.addEventListener('keydown', (event) => {
    if (!['Enter', ' '].includes(event.key)) return;
    const block = event.target.closest('[data-act="team-matrix-cell"]');
    if (!block) return;
    event.preventDefault(); block.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}
