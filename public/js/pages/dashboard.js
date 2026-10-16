/* 我的工作台：个人清单为主，右侧并行版本节点，下方本月排期摘要 */

import { esc, ICON, md, weekday, relative, diffDays, emptyState } from '../util.js';
import {
  store, myTasks, filterByStatus, reminders, currentUser, isAdmin,
  visibleMilestones, visibleScheduleItems, versionById, mutate,
} from '../api.js';
import { taskRow, versionTag, STATUS_TEXT } from '../ui.js';
import { go } from '../shell.js';

export const keepScroll = true;

export function render() {
  const s = store.state;
  const me = currentUser();
  const r = reminders();
  const all = myTasks().slice().sort((a, b) => (a.personal_order ?? 1e9) - (b.personal_order ?? 1e9));
  const open = filterByStatus(all, 'open');
  const doing = filterByStatus(all, 'doing');
  const done = filterByStatus(all, 'done');

  // 首屏精选 4 条；完整清单始终可从「我的工作」进入
  const list = all.slice(0, 4);

  return `
    <div class="page-head">
      <h1 class="page-title">我的工作台</h1>
      <p class="page-sub">${esc(me?.name || '')}，聚焦当下任务，推进版本内容，做好每一次上线。</p>
    </div>

    ${reminderBanners(r)}

    <div class="dashboard-main grid-2">
      <div>
        <div class="card">
          <div class="card-head">
            <div class="seg">
              <button class="on">未完成 <span class="cnt">${open.length}</span></button>
              <button data-act="dash-filter" data-filter="doing" title="进行中">进行中 <span class="cnt">${doing.length}</span></button>
              <button data-act="dash-filter" data-filter="done" title="已完成">已完成 <span class="cnt">${done.length}</span></button>
            </div>
            <span class="spacer"></span>
            <button class="btn sm" data-act="nav" data-page="mywork">查看全部 ${ICON.chevR}</button>
          </div>
          ${list.length === 0
            ? emptyState('当前没有任务', '主营分配的任务、排期生成的任务与你的个人待办都会出现在这里。', '<button class="btn sm primary" data-act="add-self-task">添加个人待办</button>')
            : `<div class="rows" style="padding:0 16px">${list.map((t) => taskRow(t, { today: s.today })).join('')}</div>`}
        </div>

      </div>

      <div>
        <div class="card">
          <div class="card-head">
            <h3>并行版本节点</h3>
            <span class="spacer"></span>
            <button class="btn sm ghost" data-act="nav" data-page="milestones">全部 ${ICON.chevR}</button>
          </div>
          ${versionNodes()}
        </div>

      </div>
    </div>

    ${goalSummary()}

    <div class="dashboard-schedule">
      <div class="section-title">本月排期 <button class="btn sm ghost" data-act="nav" data-page="schedule">查看全部 ${ICON.chevR}</button></div>
      ${scheduleSummary()}
    </div>

    <div class="dashboard-completion card">
      <div class="card-head"><h3>我的完成情况</h3></div>
      <div class="card-body">
        ${miniStat('未开始', filterByStatus(all, 'todo').length, 'var(--text-3)')}
        ${miniStat('进行中', doing.length, 'var(--blue)')}
        ${miniStat('已完成', done.length, 'var(--green)')}
        <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--line);font-size:var(--fs-sm);color:var(--text-3);line-height:1.7">
          已完成任务不需要主营验收，标记后立即生效。个人顺序仅你自己可见；步骤可由主营在团队看台只读查看。
        </div>
      </div>
    </div>`;
}

function miniStat(label, n, color) {
  return `<div style="display:flex;align-items:center;gap:10px;padding:6px 0">
    <span style="width:7px;height:7px;border-radius:50%;background:${color};flex:none"></span>
    <span style="flex:1;font-size:var(--fs-sm);color:var(--text-2)">${label}</span>
    <span style="font-size:var(--fs-card);font-weight:650;font-variant-numeric:tabular-nums">${n}</span>
  </div>`;
}

/* ---------------- 主营已发布的工作核心目标 ---------------- */

function goalSummary() {
  const goals = store.state.goals.filter((g) => g.published === 1);
  if (!goals.length) return '';
  return `<div class="dashboard-goals card">
    <div class="card-head">
      <h3>工作核心目标</h3>
      <span class="spacer"></span>
      <span class="pill blue">主营已发布</span>
    </div>
    <div class="goal-list">
      ${goals.map((g) => {
        const v = versionById(g.version_id);
        const pct = g.progress === null ? null : Math.round(g.progress * 100);
        return `<article class="goal-item">
          <div class="goal-item-top">
            <strong>${esc(g.title)}</strong>
            <span class="pill outline">${v ? esc(v.name) : '全项目'}</span>
          </div>
          ${g.description ? `<p>${esc(g.description)}</p>` : ''}
          ${g.target_value ? `<div class="goal-target"><span>业务目标</span><b>${esc(g.target_value)}</b></div>` : ''}
          <div class="goal-progress">
            <span>关联任务完成</span>
            <strong>${pct === null ? '暂无关联任务' : `${g.done}/${g.total} · ${pct}%`}</strong>
          </div>
          ${pct !== null ? `<div class="goal-progress-track"><span style="width:${pct}%"></span></div>` : ''}
        </article>`;
      }).join('')}
    </div>
  </div>`;
}

/* ---------------- 提醒（顶部只保留一条临期／逾期提醒） ---------------- */

function reminderBanners(r) {
  const out = [];
  const urgent = r.items.filter((i) => i.kind === 'overdue');
  const soon = r.items.filter((i) => i.kind === 'due');

  if (urgent.length) {
    const first = urgent[0];
    out.push(`<div class="banner danger clickable" data-act="open-reminder" data-type="${first.refType}" data-id="${first.refId}">
      ${ICON.alert}
      <span><b>${urgent.length} 项已逾期</b>　${esc(first.title)}（${md(first.date)}，已逾期 ${-first.diff} 天）</span>
      <span class="spacer"></span>${ICON.chevR}
    </div>`);
  } else if (soon.length) {
    const first = soon[0];
    out.push(`<div class="banner warn clickable" data-act="open-reminder" data-type="${first.refType}" data-id="${first.refId}">
      ${ICON.bell}
      <span><b>${soon.length} 项即将到期</b>　${esc(first.title)}（${first.diff === 0 ? '今天' : '明天'} ${md(first.date)}）</span>
      <span class="spacer"></span>${ICON.chevR}
    </div>`);
  }

  const cu = r.contentUpdates;
  if (cu.length) {
    out.push(`<div class="banner info">
      ${ICON.spark || ICON.bell}
      <span>主营发布了 <b>${cu.length} 项内容更新</b>：${cu.slice(0, 2).map((u) => esc(u.title)).join('、')}${cu.length > 2 ? ' 等' : ''}</span>
      <span class="spacer"></span>
      <button class="btn sm" data-act="mark-updates-read">知道了</button>
    </div>`);
  }

  return out.length ? `<div class="banner-stack">${out.join('')}</div>` : '';
}

/* ---------------- 并行版本节点 ---------------- */

function versionNodes() {
  const s = store.state;
  const today = s.today;
  const versions = s.versions.filter((v) => v.status !== 'archived');
  const rows = [];

  for (const v of versions) {
    const ms = visibleMilestones()
      .filter((m) => m.version_id === v.id)
      .sort((a, b) => (a.date || '9999') < (b.date || '9999') ? -1 : 1);
    const next = ms.find((m) => m.computedStatus !== 'done' && (!m.date || diffDays(m.date, today) >= 0))
      || ms.find((m) => m.computedStatus !== 'done');
    if (!next) continue;
    const d = diffDays(next.date, today);
    rows.push(`<button class="version-preview" data-act="open-version" data-id="${v.id}">
      <span class="version-preview-top">
        <span class="version-preview-mark" style="background:${esc(v.color || '#2f80ed')}1f;color:${esc(v.color || '#2f80ed')}">${esc(v.name.slice(0, 1))}</span>
        <span class="version-preview-title">${esc(v.name)}</span>
      </span>
      <span class="version-preview-label">下一个重要节点 <strong>${next.date ? md(next.date) : '待定'}</strong></span>
      <span class="version-preview-bottom"><strong>${esc(next.name)}</strong><span style="color:${d !== null && d <= 1 ? 'var(--orange)' : 'var(--text-3)'}">${next.date ? relative(next.date, today) : ''}</span></span>
    </button>`);
  }

  if (!rows.length) return emptyState('暂无进行中的版本节点', '主营在「主营总台 · 版本节点」中发布节点后，这里会显示各版本的下一个关键时间。', '', 'flag');
  return `<div class="side-list">${rows.join('')}</div>`;
}

/* ---------------- 本月排期摘要 ---------------- */

function scheduleSummary() {
  const s = store.state;
  const items = visibleScheduleItems();
  const entries = [];
  for (const it of items) {
    if (it.make_date) entries.push({ date: it.make_date, item: it, stage: 'make' });
    if (it.publish_date) entries.push({ date: it.publish_date, item: it, stage: 'publish' });
  }
  entries.sort((a, b) => (a.date < b.date ? -1 : 1));
  const upcoming = entries.filter((e) => diffDays(e.date, s.today) >= 0).slice(0, 5);
  const show = upcoming.length ? upcoming : entries.slice(-5);

  if (!show.length) {
    return `<div class="card">${emptyState('本月暂无已发布排期', isAdmin() ? '在「主营总台 · 本月排期」新增并发布后，成员即可看到。' : '主营发布排期后，这里会显示按日期排列的安排。', '', 'cal')}</div>`;
  }

  return `<div class="card"><div class="rows" style="padding:0 16px">
    ${show.map((e) => {
      const v = versionById(e.item.version_id);
      return `<div class="row">
        <div class="row-col" style="min-width:104px;gap:8px">
          <span style="font-size:var(--fs-sm);font-weight:600">${md(e.date)}</span>
          <span style="font-size:var(--fs-xs);color:var(--text-3)">${weekday(e.date)}</span>
        </div>
        <span style="width:7px;height:7px;border-radius:50%;background:${esc(v?.color || '#c8cbd2')};flex:none"></span>
        <div class="row-main"><div class="row-title"><span class="t">${esc(e.item.title)}</span></div></div>
        <div class="row-col">
          <span class="pill ${e.stage === 'make' ? 'blue' : 'green'}">${e.stage === 'make' ? '内部制作交付' : '对外发布'}</span>
          ${v ? `<span class="pill outline">${esc(v.name)}</span>` : ''}
        </div>
      </div>`;
    }).join('')}
  </div></div>`;
}

/* ---------------- 页面动作 ---------------- */

export const actions = {
  'dash-filter'(el) {
    store.ui.workFilter = el.dataset.filter;
    go('mywork');
  },

  'open-reminder'(el) {
    const type = el.dataset.type;
    const id = el.dataset.id;
    if (type === 'task') {
      store.ui.selectedTaskId = id;
      store.ui.workFilter = 'open';
    } else {
      store.ui.msVersion = 'all';
    }
    go(type === 'task' ? 'mywork' : 'milestones');
  },

  async 'mark-updates-read'() {
    await mutate('mark_all_updates_read', {});
  },

  'add-self-task'() {
    import('../pages/mywork.js').then((m) => m.openSelfTaskModal());
  },

  'open-version'(el) {
    store.ui.msVersion = el.dataset.id;
    go('milestones');
  },
};
