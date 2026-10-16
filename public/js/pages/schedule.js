/* 本月排期：左侧月历，右侧所选日期的安排清单 */

import { esc, ICON, md, weekday, ymCn, todayStr, emptyState } from '../util.js';
import { store, visibleScheduleItems, versionById, userById, isAdmin, mutate } from '../api.js';
import { openModal, closeModal, field, versionOptions, userOptions, selectOptions, STATUS_TEXT, statusPill } from '../ui.js';
import { go, render as renderApp } from '../shell.js';
import { openBatchContentModal } from '../batch-content.js';

const WD = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

export function render() {
  const s = store.state;
  const ui = store.ui;
  const y = ui.calYear, m = ui.calMonth;

  const items = visibleScheduleItems().filter((it) =>
    ui.calVersion === 'all' || it.version_id === ui.calVersion);

  // 展开为 {date, item, stage}
  const entries = [];
  for (const it of items) {
    if (it.make_date) entries.push({ date: it.make_date, item: it, stage: 'make' });
    if (it.publish_date) entries.push({ date: it.publish_date, item: it, stage: 'publish' });
  }
  const byDate = new Map();
  for (const e of entries) {
    if (!byDate.has(e.date)) byDate.set(e.date, []);
    byDate.get(e.date).push(e);
  }

  const sel = ui.calSelected || s.today;
  const selEntries = (byDate.get(sel) || []).sort(stageOrder);
  const upcoming = entries
    .filter((e) => e.date > s.today)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : stageOrder(a, b)))
    .slice(0, 8);

  return `
    <div class="page-head">
      <h1 class="page-title">本月排期</h1>
      <p class="page-sub">主营发布的时间安排，制作与发布一目了然。</p>
    </div>

    <div class="toolbar">
      <div class="cal-head" style="margin:0">
        <button class="icon-btn" data-act="cal-prev" title="上个月">${ICON.chevL}</button>
        <span class="cal-month">${ymCn(y, m)}</span>
        <button class="icon-btn" data-act="cal-next" title="下个月">${ICON.chevR}</button>
        <button class="btn sm ghost" data-act="cal-today" style="margin-left:4px">回到今天</button>
      </div>
      <span class="spacer"></span>
      <select class="input" data-act="cal-version">
        ${versionOptions(ui.calVersion, true)}
      </select>
      ${isAdmin() ? `<button class="btn sm primary" data-act="new-schedule">${ICON.plus} 批量新增排期</button>` : ''}
    </div>

    <div class="grid-2">
      <div>${calendar(y, m, byDate, sel, s.today)}</div>
      <div>
        <div class="card">
          <div class="card-head">
            <h3>${sel === s.today ? '今天' : md(sel)} · ${weekday(sel)}</h3>
            <span class="spacer"></span>
            <span style="font-size:var(--fs-xs);color:var(--text-3)">${selEntries.length} 项</span>
          </div>
          ${selEntries.length === 0
            ? emptyState('这一天没有安排', isAdmin() ? '点击「新增排期」为该日期安排制作或发布事项。' : '主营尚未在该日期发布排期。', '', 'cal')
            : `<div class="side-list">${selEntries.map((e) => entryRow(e, true)).join('')}</div>`}
        </div>

        <div class="card">
          <div class="card-head"><h3>近期安排</h3></div>
          ${upcoming.length === 0
            ? emptyState('暂无后续安排', '本月之后暂无已发布的排期事项。', '', 'cal')
            : `<div class="side-list">${upcoming.map((e) => entryRow(e, false)).join('')}</div>`}
        </div>
      </div>
    </div>`;
}

function stageOrder(a, b) {
  const w = (x) => (x.stage === 'make' ? 0 : 1);
  return w(a) - w(b);
}

function entryRow(e, withDesc) {
  const v = versionById(e.item.version_id);
  const stage = e.stage === 'make' ? e.item.makeStage : e.item.publishStage;
  const assignee = userById(e.stage === 'make' ? e.item.make_assignee_id : e.item.publish_assignee_id);
  const draft = e.item.published !== 1;
  return `<div class="side-item">
    <span style="width:7px;height:7px;border-radius:50%;background:${esc(v?.color || '#c8cbd2')};margin-top:6px;flex:none"></span>
    <div class="si-body">
      <div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap">
        <span class="si-name">${esc(e.item.title)}</span>
        <span class="pill ${e.stage === 'make' ? 'blue' : 'green'}">${e.stage === 'make' ? '内部制作交付' : '对外发布'}</span>
        ${draft ? '<span class="pill orange">草稿</span>' : ''}
      </div>
      ${withDesc && e.item.description ? `<div style="font-size:var(--fs-sm);color:var(--text-3);line-height:1.65;margin-top:3px">${esc(e.item.description)}</div>` : ''}
      <div style="display:flex;align-items:center;gap:8px;margin-top:5px;flex-wrap:wrap">
        ${!withDesc ? `<span style="font-size:var(--fs-xs);color:var(--text-3)">${md(e.date)} ${weekday(e.date)}</span>` : ''}
        <span style="font-size:var(--fs-xs);color:var(--text-3)">${esc(assignee?.name || '未指定负责人')}</span>
        ${v ? `<span class="vtag" style="font-size:var(--fs-xs)"><i style="background:${esc(v.color)}"></i>${esc(v.name)}</span>` : ''}
        ${stage ? statusPill(stage.status) : '<span class="pill gray">未生成任务</span>'}
      </div>
    </div>
  </div>`;
}

/* ---------------- 月历 ---------------- */

function calendar(y, m, byDate, sel, today) {
  const first = new Date(y, m - 1, 1);
  const startIdx = (first.getDay() + 6) % 7; // 周一为第一列
  const daysInMonth = new Date(y, m, 0).getDate();
  const prevDays = new Date(y, m - 1, 0).getDate();

  const cells = [];
  for (let i = startIdx - 1; i >= 0; i--) {
    const d = prevDays - i;
    const dt = shiftMonth(y, m, -1, d);
    cells.push({ day: d, date: dt, out: true });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, date: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, out: false });
  }
  let nd = 1;
  while (cells.length % 7 !== 0) {
    cells.push({ day: nd, date: shiftMonth(y, m, 1, nd), out: true });
    nd++;
  }

  return `<div class="cal-grid">
    ${WD.map((w) => `<div class="cal-dow">${w}</div>`).join('')}
    ${cells.map((c) => {
      const evs = byDate.get(c.date) || [];
      const shown = evs.slice(0, 3);
      return `<button class="cal-cell ${c.out ? 'out' : ''} ${c.date === today ? 'today' : ''} ${c.date === sel ? 'sel' : ''}"
        data-act="cal-select" data-date="${c.date}">
        <span class="cal-day">${c.day}</span>
        ${shown.map((e) => {
          const v = versionById(e.item.version_id);
          return `<span class="cal-ev" title="${esc(e.item.title)}">
            <i style="background:${esc(v?.color || '#c8cbd2')}"></i>
            <span style="overflow:hidden;text-overflow:ellipsis">${esc(e.item.title)}</span>
          </span>`;
        }).join('')}
        ${evs.length > 3 ? `<span class="cal-more">还有 ${evs.length - 3} 项</span>` : ''}
      </button>`;
    }).join('')}
  </div>`;
}

function shiftMonth(y, m, delta, day) {
  const d = new Date(y, m - 1 + delta, day);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* ---------------- 新增／编辑排期 ---------------- */

export function openScheduleModal(existing) {
  if (!existing) {
    openBatchContentModal({
      title: '批量新增排期', itemLabel: '排期', listKey: 'scheduleItems',
      createAction: 'create_schedule', publishAction: 'publish_schedule', titleKey: 'title',
      renderFields: (it) => `
        ${field('排期事项', `<input class="input" name="title" value="${esc(it.title || '')}" placeholder="例如：小红书内容制作">`, '', true)}
        ${field('说明', `<textarea class="input" name="description" rows="2" placeholder="选填">${esc(it.description || '')}</textarea>`, '', true)}
        ${field('所属版本', `<select class="input" name="version_id">${versionOptions(it.version_id || '')}</select>`, '可不关联版本', false)}
        ${field('—', `<div class="batch-stage-hint">填写哪个阶段，发布后就生成对应阶段的独立任务；两个阶段都填写则生成两项独立任务，可指定不同负责人。</div>`, '', false)}
        ${field('内部制作交付日期', `<input class="input" type="date" name="make_date" value="${esc(it.make_date || '')}">`, '', false)}
        ${field('制作负责人', `<select class="input" name="make_assignee_id">${userOptions(it.make_assignee_id || '', true)}</select>`, '', false)}
        ${field('对外发布日期', `<input class="input" type="date" name="publish_date" value="${esc(it.publish_date || '')}">`, '', false)}
        ${field('发布负责人', `<select class="input" name="publish_assignee_id">${userOptions(it.publish_assignee_id || '', true)}</select>`, '', false)}`,
      readItem: (row) => ({
        title: row.querySelector('[name="title"]').value.trim(),
        description: row.querySelector('[name="description"]').value.trim(),
        version_id: row.querySelector('[name="version_id"]').value || null,
        make_date: row.querySelector('[name="make_date"]').value,
        make_assignee_id: row.querySelector('[name="make_assignee_id"]').value || null,
        publish_date: row.querySelector('[name="publish_date"]').value,
        publish_assignee_id: row.querySelector('[name="publish_assignee_id"]').value || null,
      }),
      validateItem: (it) => it.title ? '' : '请填写排期事项',
    });
    return;
  }
  const it = existing || {};
  const editing = !!existing;
  openModal({
    title: editing ? '编辑排期' : '新增排期',
    wide: true,
    body: `<div class="form-grid">
      ${field('排期事项', `<input class="input" name="title" value="${esc(it.title || '')}" placeholder="例如：小红书内容制作">`, '', true)}
      ${field('说明', `<textarea class="input" name="description" rows="2" placeholder="选填">${esc(it.description || '')}</textarea>`, '', true)}
      ${field('所属版本', `<select class="input" name="version_id">${versionOptions(it.version_id || '')}</select>`, '可不关联版本', false)}
      ${field('—', `<div style="font-size:var(--fs-xs);color:var(--text-3);line-height:1.6">填写哪个阶段，发布后就生成对应阶段的独立任务；两个阶段都填写则生成两项独立任务，可指定不同负责人。</div>`, '', false)}
      ${field('内部制作交付日期', `<input class="input" type="date" name="make_date" value="${esc(it.make_date || '')}">`, '', false)}
      ${field('制作负责人', `<select class="input" name="make_assignee_id">${userOptions(it.make_assignee_id || '', true)}</select>`, '', false)}
      ${field('对外发布日期', `<input class="input" type="date" name="publish_date" value="${esc(it.publish_date || '')}">`, '', false)}
      ${field('发布负责人', `<select class="input" name="publish_assignee_id">${userOptions(it.publish_assignee_id || '', true)}</select>`, '', false)}
    </div>
    ${editing && it.published
      ? `<div class="banner info" style="margin-top:14px">该排期已发布：点「保存为待发布修改」时成员看到的仍是原安排；
         点「发布修改」才生效，届时会同步更新相关任务的标题、日期与负责人，并保留成员已填写的个人步骤与完成记录。</div>`
      : editing
        ? `<div class="banner info" style="margin-top:14px">该排期尚未发布，不会向成员派发任务；发布后才会生成对应阶段的任务。</div>`
        : ''}`,
    footer: `<button class="btn" data-act="close-modal">取消</button>
             <button class="btn" data-act="save-schedule-draft">${editing && it.published ? '保存为待发布修改' : '保存草稿'}</button>
             <button class="btn primary" data-act="save-schedule-publish">${editing && it.published ? '发布修改' : '保存并发布'}</button>`,
    onMount(el) {
      el.querySelector('[name="title"]').focus();
      const read = () => {
        const v = (n) => el.querySelector(`[name="${n}"]`).value;
        return {
          id: it.id,
          title: v('title').trim(),
          description: v('description').trim(),
          version_id: v('version_id') || null,
          make_date: v('make_date'),
          make_assignee_id: v('make_assignee_id') || null,
          publish_date: v('publish_date'),
          publish_assignee_id: v('publish_assignee_id') || null,
        };
      };
      const save = async (publish) => {
        const data = read();
        if (!data.title) return;
        const sched = await mutate(editing ? 'update_schedule' : 'create_schedule', data);
        if (publish) {
          const created = editing ? data.id : latestScheduleId(sched, data.title);
          if (created) await mutate('publish_schedule', { id: created, title: data.title }, { toast: '已发布，成员工作台将出现对应任务' });
        } else {
          const { toast } = await import('../util.js');
          toast('已保存草稿（成员不可见）', 'ok');
        }
        closeModal();
      };
      el.querySelector('[data-act="save-schedule-draft"]').addEventListener('click', () => save(false));
      el.querySelector('[data-act="save-schedule-publish"]').addEventListener('click', () => save(true));
    },
  });
}

function latestScheduleId(state, title) {
  const list = (state.scheduleItems || []).filter((s) => s.title === title);
  return list.length ? list[list.length - 1].id : null;
}

/* ---------------- 动作 ---------------- */

export const actions = {
  'cal-prev'() {
    const ui = store.ui;
    let m = ui.calMonth - 1, y = ui.calYear;
    if (m < 1) { m = 12; y--; }
    ui.calMonth = m; ui.calYear = y;
    renderApp();
  },
  'cal-next'() {
    const ui = store.ui;
    let m = ui.calMonth + 1, y = ui.calYear;
    if (m > 12) { m = 1; y++; }
    ui.calMonth = m; ui.calYear = y;
    renderApp();
  },
  'cal-today'() {
    const d = new Date();
    store.ui.calYear = d.getFullYear();
    store.ui.calMonth = d.getMonth() + 1;
    store.ui.calSelected = todayStr();
    renderApp();
  },
  'cal-select'(el) {
    store.ui.calSelected = el.dataset.date;
    renderApp();
  },
  'new-schedule'() { openScheduleModal(null); },
};
