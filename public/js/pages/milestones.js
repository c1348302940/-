/* 版本节点：多个版本并行的时间线，节点进度按关联任务自动计算 */

import { esc, ICON, md, weekday, relative, diffDays, ymdCn, emptyState } from '../util.js';
import { store, visibleMilestones, myTasks, isAdmin, versionById, mutate, currentUserId } from '../api.js';
import { openModal, closeModal, taskRow, progressBar } from '../ui.js';
import { go } from '../shell.js';

export function render() {
  const s = store.state;
  const versions = s.versions.filter((v) => v.status !== 'archived');
  const filter = store.ui.msVersion;
  const shown = filter === 'all' ? versions : versions.filter((v) => v.id === filter);

  const recent = myTasks()
    .filter((t) => t.status !== 'done')
    .sort((a, b) => {
      if (!a.due_date) return 1;
      if (!b.due_date) return -1;
      return a.due_date < b.due_date ? -1 : 1;
    })
    .slice(0, 5);

  return `
    <div class="page-head">
      <h1 class="page-title">版本节点</h1>
      <p class="page-sub">同时掌握多个版本的关键时间。</p>
    </div>

    <div class="toolbar">
      <div class="seg">
        <button class="${filter === 'all' ? 'on' : ''}" data-act="ms-version" data-id="all">全部版本</button>
        ${versions.map((v) => `<button class="${String(filter) === String(v.id) ? 'on' : ''}" data-act="ms-version" data-id="${v.id}">
          <span class="vtag"><i style="background:${esc(v.color)}"></i>${esc(v.name)}</span>
        </button>`).join('')}
      </div>
      <span class="spacer"></span>
      ${isAdmin() ? `<button class="btn sm primary" data-act="ms-new-version">${ICON.plus} 新建版本</button>
        <button class="btn sm" data-act="nav" data-page="admin">${ICON.edit} 在主营总台维护节点</button>` : ''}
    </div>

    ${shown.length === 0
      ? `<div class="card">${emptyState('暂无版本', '主营创建版本后，这里会按版本并排显示节点时间线。', isAdmin() ? '<button class="btn sm primary" data-act="nav" data-page="admin">前往主营总台</button>' : '', 'flag')}</div>`
      : `<div class="tl-versions">${shown.map(versionCard).join('')}</div>`}

    <div class="section-title">我的近期任务</div>
    <div class="card">
      ${recent.length === 0
        ? emptyState('没有未完成的任务', '你当前没有待推进的工作。', '', 'check')
        : `<div class="rows" style="padding:0 16px">${recent.map((t) => taskRow(t, { today: s.today })).join('')}</div>`}
    </div>`;
}

function versionCard(v) {
  const s = store.state;
  const ms = visibleMilestones()
    .filter((m) => m.version_id === v.id)
    .sort((a, b) => ((a.date || '9999-99-99') < (b.date || '9999-99-99') ? -1 : 1));

  const firstOpen = ms.find((m) => m.computedStatus !== 'done');
  const launch = ms.length ? ms[ms.length - 1] : null;

  const nodes = ms.map((m) => {
    const isDone = m.computedStatus === 'done';
    const isCurrent = firstOpen && firstOpen.id === m.id;
    const cls = isDone ? 'done' : isCurrent ? 'current' : '';
    const state = isDone ? '已完成' : isCurrent ? '进行中' : '未开始';
    const d = m.date ? diffDays(m.date, s.today) : null;
    return `<button class="tl-node ${cls}" data-act="ms-detail" data-id="${m.id}" title="查看节点详情">
      <span class="tl-dot">${isDone ? ICON.check : ''}</span>
      <div class="tl-name">${esc(m.name)}</div>
      <div class="tl-date">${m.date ? md(m.date) : '待定'}${d !== null && !isDone ? ` · ${relative(m.date, s.today)}` : ''}</div>
      <div class="tl-state ${isDone ? 'done' : isCurrent ? 'current' : 'todo'}">${state}</div>
    </button>`;
  }).join('');

  return `<div class="tl-card">
    <div class="tl-card-head">
      <span class="vtag"><i style="background:${esc(v.color)};width:9px;height:9px"></i></span>
      <span class="nm">${esc(v.name)}</span>
      <span class="pill ${v.status === 'active' ? 'blue' : 'gray'}">${v.status === 'active' ? '进行中' : '规划中'}</span>
      <span class="up">上线时间 ${launch?.date ? ymdCn(launch.date) : '待定'}</span>
    </div>
    ${ms.length === 0
      ? emptyState('该版本暂无节点', isAdmin() ? '在主营总台为该版本新增节点。' : '主营尚未发布该版本的节点。', '', 'flag')
      : `<div class="tl-track"><div class="tl-line">${nodes}</div></div>
         <div class="tl-current">
           <div style="flex:1;min-width:0">
             <div class="lbl">当前阶段</div>
             <div class="val">${esc(firstOpen ? firstOpen.name : '全部节点已完成')}</div>
           </div>
           ${firstOpen ? `<button class="btn sm" data-act="ms-detail" data-id="${firstOpen.id}">查看详情 ${ICON.chevR}</button>` : ''}
         </div>`}
  </div>`;
}

export const actions = {
  async 'ms-new-version'() {
    if (!isAdmin()) return;
    const { versionModal } = await import('./admin.js');
    versionModal(null);
  },
  'ms-version'(el) {
    store.ui.msVersion = el.dataset.id === 'all' ? 'all' : el.dataset.id;
    go('milestones', { scrollTop: false });
  },

  'ms-detail'(el) {
    const m = store.state.milestones.find((x) => x.id === el.dataset.id);
    if (!m) return;
    const v = versionById(m.version_id);
    // 关联任务：成员视角只拿得到自己名下的任务，因此列表只用 aggregated 计数
    const linked = store.state.tasks.filter((t) => t.milestone_id === m.id);
    const linkedTotal = m.linkedTotal || 0;
    const linkedDone = m.linkedDone || 0;
    const auto = !!m.auto;

    openModal({
      title: '节点详情',
      body: `
        <div style="margin-bottom:14px">
          <div style="font-size:var(--fs-section);font-weight:650;margin-bottom:4px">${esc(m.name)}</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
            ${v ? `<span class="pill outline">${esc(v.name)}</span>` : '<span class="pill gray">未关联版本</span>'}
            <span class="pill ${m.computedStatus === 'done' ? 'green' : 'gray'}">${m.computedStatus === 'done' ? '已完成' : '未完成'}</span>
            <span class="pill gray">${m.date ? ymdCn(m.date) : '日期待定'}${m.date ? ' ' + weekday(m.date) : ''}</span>
          </div>
        </div>
        <div class="field">
          <div class="field-label">说明</div>
          <div class="field-box">${esc(m.description || '—')}</div>
        </div>
        <div class="field">
          <div class="field-label">关联任务完成情况</div>
          ${auto
            ? `<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
                 <span style="font-size:var(--fs-sm);color:var(--text-2)">
                   节点整体：${linkedDone} / ${linkedTotal} 项关联任务已完成
                 </span>
                 ${progressBar(linkedDone, linkedTotal, linkedDone === linkedTotal ? 'done' : 'doing')}
               </div>
               <div style="font-size:var(--fs-xs);color:var(--text-3);margin-bottom:10px">该节点状态由关联任务自动计算：全部关联任务完成后节点自动成为「已完成」。</div>
               ${isAdmin()
                 ? `<div style="font-size:var(--fs-xs);color:var(--text-3);margin-bottom:6px">全部关联任务（仅名称与状态，不含成员个人步骤）：</div>
                    <div class="rows">${linked.map((t) => `<div class="row" style="padding:9px 2px">
                       <div class="row-main"><div class="row-title"><span class="t">${esc(t.title)}</span></div>
                       <div class="row-sub">${esc((store.state.users.find((u) => u.id === t.assignee_id) || {}).name || '')} · ${t.status === 'done' ? '已完成' : t.status === 'doing' ? '进行中' : '未开始'}</div></div>
                     </div>`).join('')}</div>`
                 : `<div style="font-size:var(--fs-xs);color:var(--text-3);margin-bottom:6px">你名下与该节点关联的任务：</div>
                    ${linked.length
                      ? `<div class="rows">${linked.map((t) => `<div class="row" style="padding:9px 2px">
                           <div class="row-main"><div class="row-title"><span class="t">${esc(t.title)}</span></div>
                           <div class="row-sub">${t.status === 'done' ? '已完成' : t.status === 'doing' ? '进行中' : '未开始'}</div></div>
                         </div>`).join('')}</div>`
                      : '<div class="banner" style="margin-bottom:0">你名下没有与该节点直接关联的任务；节点整体进度已计入其他成员的关联任务。</div>'}`}`
            : `<div class="banner">该节点没有关联任务，状态由主营手动更新。</div>
               ${isAdmin() ? `<div class="btn-row" style="margin-top:10px">
                  <button class="btn sm ${m.status === 'pending' ? 'primary' : ''}" data-act="ms-set-status" data-id="${m.id}" data-status="pending">未完成</button>
                  <button class="btn sm ${m.status === 'done' ? 'primary' : ''}" data-act="ms-set-status" data-id="${m.id}" data-status="done">已完成</button>
               </div>` : ''}`}
        </div>`,
      footer: `<button class="btn" data-act="close-modal">关闭</button>`,
    });
  },

  async 'ms-set-status'(el) {
    await mutate('set_milestone_status', { id: el.dataset.id, status: el.dataset.status }, { toast: '节点状态已更新' });
    closeModal();
  },
};
