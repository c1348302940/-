/* 热点雷达：采集结果团队共享，平台登录状态与常用板块按账号隔离 */

import { esc, ICON, toast, emptyState, nowStamp } from '../util.js';
import { store, platformState, trendsOf, savedTopicsOf, loadState, mutate } from '../api.js';
import { authFetch } from '../auth.js';
import { render as renderApp } from '../shell.js';

// 刷新进度轮询会重绘整页，重绘时保留用户正在查看的榜单位置。
export const keepScroll = true;

/* 与后端 lib/hotspot.js 的 SECTIONS 保持一致；无「美食」板块 */
export const SECTIONS = [
  { key: 'game', label: '游戏电竞' },
  { key: 'anime', label: '动漫二次元' },
  { key: 'tv', label: '影视综艺' },
  { key: 'music', label: '音乐舞蹈' },
  { key: 'travel', label: '旅游城市' },
  { key: 'guofeng', label: '国风文化' },
  { key: 'beauty', label: '时尚美妆' },
  { key: 'lifestyle', label: '生活方式' },
  { key: 'tech', label: '科技与AI' },
  { key: 'pet', label: '萌宠' },
  { key: 'sports', label: '体育运动' },
  { key: 'other', label: '其他' },
];
const SECTION_LABEL = Object.fromEntries(SECTIONS.map((s) => [s.key, s.label]));

/* hotKind / hotLabel 与后端 lib/hotspot.js 的 PLATFORMS 保持一致：
   hotlist = 平台官方热榜；search_hot = 搜索「热点」后的结果，不是热榜排名。 */
const PLATFORMS = [
  { key: 'douyin', label: '抖音', cls: 'dy', short: '抖', hotKind: 'hotlist', hotLabel: '抖音热榜' },
  { key: 'xiaohongshu', label: '小红书', cls: 'xhs', short: '红', hotKind: 'competitor', hotLabel: '竞品玩家讨论监控' },
];

/* 与后端 lib/hotspot.js 的 COMPETITORS 保持一致：竞品分组与展示顺序 */
const COMPETITORS = [
  { key: 'nishuihan', label: '逆水寒手游' },
  { key: 'nishuihan-gold', label: '逆水寒黄金服' },
  { key: 'yimeng', label: '一梦江湖' },
  { key: 'tianya', label: '天涯明月刀手游' },
  { key: 'qiannv', label: '倩女幽魂手游' },
];
const COMPETITOR_LABEL = Object.fromEntries(COMPETITORS.map((c) => [c.key, c.label]));

const STATUS_TEXT = {
  disconnected: '未连接',
  connecting: '正在登录',
  refreshing: '刷新中',
  connected: '已连接',
  public: '公开热榜',
  expired: '会话已过期',
  error: '采集失败',
};

function displayStatus(conn, platform) {
  if (platform === 'douyin' && (conn.status === 'disconnected' || conn.status === 'expired')) return 'public';
  return conn.status || 'disconnected';
}

export function render() {
  const ui = store.ui;
  const p = ui.hsPlatform;
  const plat = PLATFORMS.find((x) => x.key === p);
  const conn = platformState(p);
  const status = displayStatus(conn, p);
  const busy = status === 'connecting' || status === 'refreshing';
  const saved = savedTopicsOf(p);
  const searching = !!ui.hsSearchResult;

  return `
    <div class="page-head page-head-row">
      <div class="page-head">
        <h1 class="page-title">热点雷达</h1>
        <p class="page-sub">从平台内容发现可迁移到游戏营销的灵感。热点内容由团队共享，不会自动变成工作任务。</p>
      </div>
      <div class="btn-row" style="padding-top:8px">
        <span class="status-chip ${status}"><i></i>${STATUS_TEXT[status] || status}${status === 'connected' && conn.connected_at ? ` · ${esc((conn.connected_at || '').slice(0, 10))}` : ''}</span>
        ${p === 'douyin'
          ? `<button class="btn sm" data-act="hs-refresh" ${busy ? 'disabled' : ''}>${ICON.refresh} 刷新热榜</button>
             <button class="btn sm" data-act="hs-reconnect" ${busy ? 'disabled' : ''}>登录账号（可选）</button>`
          : status === 'connected'
          ? `<button class="btn sm" data-act="hs-refresh" ${busy ? 'disabled' : ''}>${ICON.refresh} ${plat.hotKind === 'hotlist' ? '刷新热榜' : '刷新竞品监控'}</button>
             <button class="btn sm" data-act="hs-reconnect">重新连接</button>`
          : `<button class="btn sm primary" data-act="hs-connect" ${busy ? 'disabled' : ''}>${ICON.link} 连接${plat.label}账号</button>`}
      </div>
    </div>

    <div class="toolbar" style="padding-bottom:14px">
      <div class="platform-tabs">
        ${PLATFORMS.map((x) => `<button class="platform-tab ${p === x.key ? 'on' : ''}" data-act="hs-platform" data-id="${x.key}">
          <span class="platform-logo ${x.cls}">${x.short}</span>${x.label}
        </button>`).join('')}
      </div>
      <span class="spacer"></span>
        <span style="font-size:var(--fs-xs);color:var(--text-3)">团队共享热点 · 平台登录状态与个人收藏仅本人可见</span>
    </div>

    ${statusBanner(status, conn, plat, busy)}
    ${sourceNotice(plat)}

    <div class="grid-2">
      <div>
        <div class="toolbar">
          <span class="search-wrap" style="flex:1;max-width:420px">
            ${ICON.search}
            <input class="input" style="width:100%" placeholder="搜索其它话题或板块（不限于固定板块）" ${p === 'xiaohongshu' && busy ? 'disabled' : ''}
              value="${esc(ui.hsQuery)}" data-act="hs-query" data-hs-enter="1">
          </span>
          <button class="btn primary" data-act="hs-search" ${ui.hsBusy || (p === 'xiaohongshu' && busy) ? 'disabled' : ''}>
            ${ui.hsBusy ? '<span class="spin"></span>' : ICON.search} 搜索
          </button>
          ${ui.hsSearchResult ? `<button class="btn" data-act="hs-clear-search">返回列表</button>` : ''}
          <button class="btn" data-act="hs-save-topic" ${ui.hsQuery.trim() ? '' : 'disabled'}>${ICON.star} 设为常用板块</button>
        </div>

        ${searching ? searchResultBlock() : (p === 'xiaohongshu' ? competitorBlock(status, conn) : listBlock(p, status))}
      </div>

      <div>
        <div class="card">
          <div class="card-head">
            <h3>我的常用板块</h3>
            <span class="spacer"></span>
            <span style="font-size:var(--fs-xs);color:var(--text-3)">仅自己可见</span>
          </div>
          ${saved.length === 0
            ? emptyState('还没有保存的板块', '在搜索框输入关键词并点击「设为常用板块」，即可随时一键查看。', '', 'star')
            : `<div class="side-list">${saved.map((t) => `<div class="side-item">
                <span style="color:var(--text-3);margin-top:2px">${ICON.star}</span>
                <div class="si-body">
                  <div class="si-name">${esc(t.keyword)}</div>
                  <div class="si-note">保存于 ${esc((t.created_at || '').slice(0, 10))}</div>
                </div>
                <button class="btn sm ghost" data-act="hs-run-saved" data-kw="${esc(t.keyword)}">查看</button>
                <button class="icon-btn danger" data-act="hs-del-topic" data-id="${t.id}" title="删除">${ICON.trash}</button>
              </div>`).join('')}</div>`}
        </div>

        <div class="card">
          <div class="card-head"><h3>关于数据来源</h3></div>
          <div class="card-body" style="font-size:var(--fs-sm);color:var(--text-3);line-height:1.85">
            平台内容通过 <strong style="color:var(--text-2)">Playwright CLI</strong> 从官方网页读取。抖音公开热榜<strong style="color:var(--text-2)">无需登录</strong>；小红书<strong style="color:var(--text-2)">竞品玩家讨论</strong>需要你本人在官方页面登录。
            工作台不收集平台密码；如使用登录状态，文件保存在本机 <code>app/data/auth/</code>，按用户与平台隔离，不进入代码仓库。
            平台页面结构调整、反爬或网络受限时可能采集失败，此时页面会显示真实原因，不会用示例数据冒充实时数据；采集失败时保留上次成功结果并标注其采集时间。
            竞品话题由搜索结果中实际读到的帖子内容归纳；讨论度按同话题帖子数计算。取不到的评论数会标注「未提供」。
          </div>
        </div>
      </div>
    </div>`;
}

function statusBanner(status, conn, plat, busy) {
  if (plat.key === 'douyin' && status === 'public') {
    return `<div class="banner info">${ICON.refresh}<span>抖音公开热榜无需登录。打开本页会自动刷新，也可随时点击“刷新热榜”。</span></div>`;
  }
  if (status === 'connecting') {
    const ready = String(conn.status_detail || '').startsWith('登录窗口已打开');
    return `<div class="banner info">${ICON.lock}
      <span>${esc(conn.status_detail || `请在打开的 ${plat.label} 窗口完成登录，再点击确认；无需关闭窗口。`)}</span>
      <span class="spacer"></span>
      ${ready ? `<button class="btn sm primary" data-act="hs-confirm-login" ${store.ui.hsBusy ? 'disabled' : ''}>我已登录，开始搜索</button>`
        : '<span class="loading"><span class="spin"></span>正在打开登录窗口…</span>'}
    </div>`;
  }
  if (status === 'refreshing') {
    return `<div class="banner info">${ICON.refresh}<span>${esc(conn.status_detail || `正在读取 ${plat.label}${plat.hotKind === 'hotlist' ? '热榜' : '内容'}…`)}</span>
      <span class="spacer"></span><span class="loading"><span class="spin"></span>刷新中</span></div>`;
  }
  if (status === 'expired') {
    return `<div class="banner warn">${ICON.alert}
      <span>${esc(conn.status_detail || '登录状态已失效')}</span>
      <span class="spacer"></span><button class="btn sm primary" data-act="hs-connect">重新连接</button></div>`;
  }
  if (status === 'error') {
    return `<div class="banner danger">${ICON.alert}
      <span>采集失败：${esc(conn.status_detail || '未知原因')}</span>
      <span class="spacer"></span><button class="btn sm" data-act="hs-refresh">重试搜索</button>
      ${plat.key === 'xiaohongshu' ? '<button class="btn sm" data-act="hs-connect">重新登录</button>' : ''}</div>`;
  }
  if (status === 'disconnected') {
    return `<div class="banner">${ICON.lock}
      <span>尚未连接 ${plat.label} 账号。你仍可查看团队上次成功采集的内容；如需更新，请连接自己的账号。登录状态只保存在本机。</span>
      <span class="spacer"></span><button class="btn sm primary" data-act="hs-connect">连接${plat.label}账号</button></div>`;
  }
  return '';
}

/**
 * 来源性质说明。小红书目前取不到经核实的官方热榜，搜索结果不能当作排名。
 */
function sourceNotice(plat) {
  if (plat.hotKind === 'hotlist') return '';
  return `<div class="banner warn" style="margin-bottom:14px">${ICON.alert}
    <span><strong>${esc(plat.label)}暂无经核实的官方热榜入口。</strong>
    本页按 5 个竞品分别搜索游戏名，选择「最新」，剔除商业交易等无关内容并补足 30 篇有效游戏讨论帖，归纳讨论帖数最多的 3 个话题。
    这是本次样本内的讨论度，不是小红书官方热度榜。</span>
  </div>`;
}

/* ---------------- 竞品玩家讨论监控 ---------------- */

/** 竞品玩家笔记：兼容旧版与商业内容过滤后的结果。 */
function competitorNotes(platform) {
  return trendsOf(platform, 'hot').filter((t) => ['competitor', 'competitor_filtered_v2'].includes(t.source_kind || ''));
}

function lastCollectedAt(platform) {
  let max = '';
  for (const t of competitorNotes(platform)) if ((t.discovered_at || '') > max) max = t.discovered_at;
  return max;
}

function fmtDiscovered(iso) {
  return iso ? iso.slice(5, 16).replace('T', ' ') : '';
}

function competitorBlock(status, conn) {
  const notes = competitorNotes('xiaohongshu');
  const lastAt = lastCollectedAt('xiaohongshu');
  const selected = COMPETITORS.find((c) => c.key === store.ui.hsCompetitor) || COMPETITORS[0];
  const tabs = `<div class="chips competitor-tabs" style="margin-bottom:14px">${COMPETITORS.map((c) => {
    const count = notes.filter((t) => t.competitor_key === c.key && t.topic_post_count).length;
    return `<button class="chip ${selected.key === c.key ? 'on' : ''}" data-act="hs-competitor" data-id="${c.key}">${esc(c.label)} <span style="opacity:.7">${count ? count + ' 个话题' : ''}</span></button>`;
  }).join('')}</div>`;

  // 采集失败但仍有上一次成功结果：如实标注旧结果及采集时间，不冒充实时数据
  let staleBanner = '';
  if (status === 'error' && notes.some((t) => t.competitor_key === selected.key && t.topic_post_count)) {
    staleBanner = `<div class="banner warn" style="margin-bottom:14px">${ICON.alert}
      <span>以下为<strong>上次成功采集</strong>的结果${lastAt ? `，采集于 <strong>${esc(fmtDiscovered(lastAt))}</strong>` : ''}，不代表当前实时数据。</span></div>`;
  }
  const missing = COMPETITORS.filter((c) => !notes.some((t) => t.competitor_key === c.key && t.topic_post_count));
  const partialBanner = status === 'connected' && missing.length && notes.some((t) => t.topic_post_count)
    ? `<div class="banner warn" style="margin-bottom:14px">${ICON.alert}<span>本轮还有 ${missing.length} 个竞品未完成：${esc(missing.map((c) => c.label).join('、'))}。${esc(conn.status_detail || '')}</span></div>`
    : '';

  if (notes.length === 0) {
    const what = '竞品讨论话题';
    const msg = status === 'connected'
      ? emptyState(`暂无${what}`, '已连接小红书，点击右上角「刷新竞品监控」读取 5 个竞品的玩家笔记。', `<button class="btn sm primary" data-act="hs-refresh">刷新竞品监控</button>`, 'radar')
      : status === 'connecting' || status === 'refreshing'
        ? emptyState(status === 'connecting' ? '等待登录确认' : '正在搜索竞品', status === 'connecting' ? '请在小红书窗口完成登录，然后点击上方「我已登录，开始搜索」。' : '将依次搜索五个竞品；整轮结束后才会关闭浏览器窗口。', '', 'radar')
      : status === 'error'
        ? emptyState('采集失败', `未能读取竞品玩家笔记（${esc((conn.status_detail || '').replace(/^采集失败[：:]\s*/, '') || '未知原因')}）。可点击重试。`, `<button class="btn sm" data-act="hs-refresh">重试</button>`, 'alert')
        : emptyState('团队尚未取得竞品玩家笔记', '连接小红书账号并完成一次采集后，真实结果会共享给全部团队成员。', `<button class="btn sm primary" data-act="hs-connect">连接小红书账号</button>`, 'radar');
    return tabs + staleBanner + `<div class="card">${msg}</div>`;
  }

  const topics = notes.filter((t) => t.competitor_key === selected.key && t.topic_post_count).slice(0, 3);
  const sample = topics[0]?.sample_count || 0;
  const sampleLabel = topics[0]?.source_kind === 'competitor_filtered_v2'
    ? `基于 ${sample} 篇有效游戏讨论帖 · 已读正文 ${topics[0].body_read_count || 0} 篇`
    : `基于 ${sample} 条旧版搜索结果 · 待按新规则刷新`;
  const head = `<div class="card" style="margin-bottom:14px"><div class="card-head"><h3>${esc(selected.label)} · 话题讨论度</h3><span class="spacer"></span><span class="t-xs t-muted">${sample ? sampleLabel : '暂无本次结果'}</span></div></div>`;
  if (!topics.length) return tabs + staleBanner + partialBanner + head + `<div class="card">${emptyState('该游戏暂无话题', '本轮未能取得可归纳的帖子，或这组数据来自旧版采集。刷新竞品监控后再看。', '', 'radar')}</div>`;
  return tabs + staleBanner + partialBanner + head + topics.map((t, i) => competitorTopicCard(t, i)).join('');
}

function competitorTopicCard(t, index) {
  let evidence = [];
  try { evidence = JSON.parse(t.topic_evidence || '[]'); } catch { /* 旧数据 */ }
  return `<div class="card competitor-topic" style="margin-bottom:14px">
    <div class="card-head"><h3><span class="topic-rank">${index + 1}</span> ${esc(t.title)}</h3><span class="spacer"></span><span class="pill blue">${Number(t.topic_post_count) || 0} 条讨论帖</span></div>
    <div class="card-body"><p class="topic-summary">${esc(t.topic_summary || '暂无摘要')}</p>
      <div class="t-xs t-muted">已取得的评论数合计：${t.note_comment_count ? esc(t.note_comment_count) : '未提供'} · 搜索词：${esc(t.query || '')}</div>
      <div class="topic-evidence"><strong>代表帖子</strong>${evidence.slice(0, 3).map((n) => `<a class="link" href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.title)} ${ICON.external}</a>`).join('')}</div>
    </div>
  </div>`;
}

/* ---------------- 热榜列表 ---------------- */

function listBlock(platform, status) {
  const ui = store.ui;
  const items = trendsOf(platform, ui.hsSection);
  const all = trendsOf(platform, 'hot');

  const chips = `<div class="chips" style="margin-bottom:14px">
    <button class="chip ${ui.hsSection === 'hot' ? 'on' : ''}" data-act="hs-section" data-id="hot">${esc(sourceKindLabel(platform))} <span style="opacity:.7">${all.length}</span></button>
    ${SECTIONS.map((s) => {
      const n = trendsOf(platform, s.key).length;
      return `<button class="chip ${ui.hsSection === s.key ? 'on' : ''}" data-act="hs-section" data-id="${s.key}">${s.label}${n ? ` <span style="opacity:.7">${n}</span>` : ''}</button>`;
    }).join('')}
  </div>`;

  if (all.length === 0) {
    const cfg = PLATFORMS.find((x) => x.key === platform);
    const what = cfg.hotKind === 'hotlist' ? '热榜' : '搜索结果';
    const msg = platform === 'douyin'
      ? emptyState('暂无抖音热榜数据', '公开热榜无需登录，点击“刷新热榜”读取当前榜单。',
          '<button class="btn sm primary" data-act="hs-refresh">刷新热榜</button>', 'radar')
      : status === 'connected'
      ? emptyState(`暂无${what}数据`,
          `已连接 ${cfg.label}，点击右上角「刷新${what}」读取当前${what}。`,
          `<button class="btn sm primary" data-act="hs-refresh">刷新${what}</button>`, 'radar')
      : emptyState(`尚未取得真实${what}数据`,
          `连接${cfg.label}账号并完成一次采集后，这里会显示团队共享的真实${what}（${cfg.hotLabel}）。未连接时不显示任何示例话题。`,
          `<button class="btn sm primary" data-act="hs-connect">连接${cfg.label}账号</button>`, 'radar');
    return chips + `<div class="card">${msg}</div>`;
  }

  if (items.length === 0) {
    return chips + `<div class="card">${emptyState('该板块暂无内容', '当前榜单里没有归入该板块的话题。可切换其它板块，或用上方搜索框自由搜索补充。', '', 'radar')}</div>`;
  }

  // 平台热榜／“热点”搜索与板块关键词补充分开呈现。
  const config = PLATFORMS.find((x) => x.key === platform);
  const isRanked = config?.hotKind === 'hotlist';
  const primaryKind = config?.hotKind;
  const hotItems = items.filter((t) => (t.source_kind || 'hotlist') === primaryKind);
  const searchItems = items.filter((t) => (t.source_kind || 'hotlist') === 'search');

  // 抖音按官方名次；小红书保留当次搜索结果的页面顺序，不代表热度。
  const maxHeat = maxHeatOf(hotItems);
  let html = chips;

  if (hotItems.length) {
    html += `<div class="card">
      <div class="card-head">
        <h3>${esc(sourceKindLabel(platform))}</h3>
        <span class="spacer"></span>
        <span class="t-xs t-muted">${isRanked
          ? '按平台名次排列 · 热度条为本批数据的相对刻度'
          : '按“热点”搜索页面返回顺序排列 · 非热度排名'}</span>
      </div>
      <table class="tbl">
        <thead><tr>
          <th style="width:70px">${isRanked ? '排名' : '展示顺序'}</th>
          <th>话题名称</th>
          <th style="width:210px">平台热度</th>
          <th style="width:150px">所属板块</th>
          <th style="width:96px">发现时间</th>
          <th style="width:70px">来源</th>
        </tr></thead>
        <tbody>${hotItems.map((t, i) => trendRow(t, maxHeat, i, isRanked)).join('')}</tbody>
      </table>
    </div>`;
  }

  if (searchItems.length) {
    const queries = Array.from(new Set(searchItems.map((t) => t.query).filter(Boolean)));
    html += `<div class="card" style="margin-top:16px">
      <div class="card-head">
        <h3>关键词搜索补充</h3>
        <span class="spacer"></span>
        <span class="pill orange">非热榜排名</span>
      </div>
      <div class="card-body" style="padding-bottom:6px">
        <div class="banner info" style="margin-bottom:10px">${ICON.search}
          <span>${isRanked ? '该板块在平台热榜中没有内容，以下为按当期关键词搜索得到的结果' : '以下为按当期关键词补充的搜索结果'}，<strong>不代表平台热榜排名</strong>${queries.length ? `（关键词：${queries.map(esc).join('、')}）` : ''}。</span>
        </div>
      </div>
      <table class="tbl">
        <thead><tr>
          <th style="width:38px">#</th>
          <th>话题名称</th>
          <th style="width:150px">所属板块</th>
          <th style="width:96px">发现时间</th>
          <th style="width:90px">结果链接</th>
        </tr></thead>
        <tbody>${searchItems.map((t, i) => searchRow(t, i)).join('')}</tbody>
      </table>
    </div>`;
  }

  if (!hotItems.length && !searchItems.length) {
    html += `<div class="card">${emptyState('该板块暂无内容', '当前榜单里没有归入该板块的话题。可切换其它板块，或用上方搜索框自由搜索补充。', '', 'radar')}</div>`;
  }
  return html;
}

/** 该平台热榜的真实来源名称 */
function sourceKindLabel(platform) {
  const p = PLATFORMS.find((x) => x.key === platform);
  return p ? p.hotLabel : '热榜';
}

function searchRow(t, i) {
  const cats = (t.category || '').split(',').filter(Boolean);
  return `<tr>
    <td class="rank">${i + 1}</td>
    <td class="t-title">${esc(t.title)}
      ${t.query ? `<span class="pill gray" style="margin-left:6px">搜索：${esc(t.query)}</span>` : ''}</td>
    <td>${cats.map((c) => `<span class="pill ${c === 'other' ? 'gray' : 'blue'}" style="margin-right:3px">${esc(SECTION_LABEL[c] || c)}</span>`).join('')}</td>
    <td class="t-xs t-muted">${esc((t.discovered_at || '').slice(5, 16).replace('T', ' '))}</td>
    <td><a class="link" href="${esc(t.link || searchUrl(store.ui.hsPlatform, t.title))}" target="_blank" rel="noopener">查看 ${ICON.external}</a></td>
  </tr>`;
}

function maxHeatOf(items) {
  let max = 0;
  for (const t of items) {
    const n = heatNumber(t.heat);
    if (n > max) max = n;
  }
  return max;
}

function heatNumber(heat) {
  if (!heat) return 0;
  const m = String(heat).match(/([\d.]+)\s*([万亿wW]?)/);
  if (!m) return 0;
  let n = parseFloat(m[1]);
  if (m[2] === '万' || m[2] === 'w' || m[2] === 'W') n *= 10000;
  if (m[2] === '亿') n *= 100000000;
  return n;
}

function trendRow(t, maxHeat, index, isRanked) {
  const cats = (t.category || '').split(',').filter(Boolean);
  const h = heatNumber(t.heat);
  const pct = maxHeat > 0 && h > 0 ? Math.max(6, Math.round((h / maxHeat) * 100)) : 0;
  // 名次用平台自己的 board_rank，不用数组下标：抖音热榜最前面有一条不占名次的置顶条，
  // 用下标会让后面每条都错位 1 名，而且 i<3 的「前三」高亮也会高亮错行。
  // 小红书仅显示工作台的展示顺序，不能当作平台排名。
  const rankCell = !isRanked
    ? `<td class="rank"><span class="t-xs t-muted">${index + 1}</span></td>`
    : t.board_rank != null
    ? `<td class="rank ${t.board_rank <= 3 ? 'top' : ''}">${t.board_rank}</td>`
    : `<td class="rank"><span class="t-xs t-muted">${t.platform === 'douyin' ? '置顶' : '—'}</span></td>`;
  return `<tr>
    ${rankCell}
    <td class="t-title">${esc(t.title)}</td>
    <td class="heat">${t.heat ? esc(t.heat) : '<span style="color:var(--text-3)">未提供</span>'}
      ${pct ? `<span class="heatbar"><i style="width:${pct}%"></i></span>` : ''}
      ${t.platform === 'douyin' ? `<div class="t-xs t-muted" style="margin-top:6px;line-height:1.55">
        关联视频：点赞 ${esc(t.video_like_count || '未提供')} · 评论 ${esc(t.video_comment_count || '未提供')}<br>
        发布时间：${esc(t.video_published_at || '未提供')}
        ${t.video_link ? ` · <a class="link" href="${esc(t.video_link)}" target="_blank" rel="noopener">看视频</a>` : ''}
      </div>` : ''}</td>
    <td>${cats.length
      ? cats.map((c) => `<span class="pill ${c === 'other' ? 'gray' : 'blue'}" style="margin-right:3px">${esc(SECTION_LABEL[c] || c)}</span>`).join('')
      : '<span style="color:var(--text-3)">未分类</span>'}</td>
    <td style="color:var(--text-3);font-size:var(--fs-sm)">${esc((t.discovered_at || '').slice(5, 16).replace('T', ' '))}</td>
    <td>${t.link
      ? `<a class="link" href="${esc(t.link)}" target="_blank" rel="noopener">查看 ${ICON.external}</a>`
      : `<button class="link" data-act="hs-open-search" data-title="${esc(t.title)}" style="background:none;border:none;padding:0;cursor:pointer">搜索</button>`}</td>
  </tr>`;
}

/* ---------------- 自由搜索结果（临时查看） ---------------- */

function searchResultBlock() {
  const ui = store.ui;
  const r = ui.hsSearchResult;
  const plat = PLATFORMS.find((x) => x.key === ui.hsPlatform);
  return `<div class="card">
    <div class="card-head">
      <h3>「${esc(ui.hsSearchKeyword)}」的搜索结果</h3>
      <span class="pill orange">搜索发现 · 非热榜排名</span>
      <span class="spacer"></span>
      <span class="pill gray">临时查看 · 未保存</span>
      <button class="btn sm" data-act="hs-clear-search">返回列表</button>
    </div>
    ${!r.ok
      ? `<div class="card-body"><div class="banner danger">${ICON.alert}<span>${esc(r.reason || '搜索失败')}</span></div></div>`
      : r.items.length === 0
        ? emptyState('没有搜索结果', `平台未返回「${esc(ui.hsSearchKeyword)}」相关内容，换个关键词再试。`, '', 'search')
        : `<table class="tbl">
            <thead><tr><th style="width:38px">#</th><th>结果标题</th><th style="width:70px">来源</th></tr></thead>
            <tbody>${r.items.map((t, i) => `<tr>
              <td class="rank">${i + 1}</td>
              <td class="t-title">${esc(t.title)}</td>
              <td><a class="link" href="${esc(t.link || searchUrl(ui.hsPlatform, t.title))}" target="_blank" rel="noopener">查看 ${ICON.external}</a></td>
            </tr>`).join('')}</tbody>
          </table>`}
  </div>`;
}

function searchUrl(platform, kw) {
  return platform === 'douyin'
    ? 'https://www.douyin.com/search/' + encodeURIComponent(kw)
    : 'https://www.xiaohongshu.com/search_result?keyword=' + encodeURIComponent(kw);
}

/* ---------------- 轮询（登录 / 刷新进行中） ---------------- */

let pollTimer = null;

function startPolling() {
  stopPolling();
  pollTimer = setInterval(async () => {
    const p = store.ui.hsPlatform;
    const st = platformState(p).status;
    if (st !== 'connecting' && st !== 'refreshing') { stopPolling(); }
    await loadState();
    renderApp();
  }, 1800);
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

/** 抖音公开热榜首次打开自动刷新；小红书等待本人明确确认登录或手动刷新。 */
let autoRefreshed = new Set();

export function afterRender() {
  const ui = store.ui;
  const p = ui.hsPlatform;
  const st = platformState(p).status;
  if (st === 'connecting' || st === 'refreshing') { startPolling(); return; }
  if (p === 'douyin' && !autoRefreshed.has(p)) {
    autoRefreshed.add(p);
    triggerCollect(p, true);
  }
}

async function triggerCollect(platform, silent) {
  try {
    const res = await authFetch('/api/hotspot/collect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '无法启动采集');
    if (!silent) toast(platform === 'xiaohongshu' ? '正在搜索竞品玩家讨论…' : '正在读取平台热榜…');
    await loadState();
    renderApp();
    startPolling();
  } catch (e) {
    if (!silent) toast(e.message, 'err');
  }
}

/* ---------------- 动作 ---------------- */

export const actions = {
  async 'hs-platform'(el) {
    stopPolling();
    store.ui.hsPlatform = el.dataset.id;
    store.ui.hsSection = 'hot';
    store.ui.hsSearchResult = null;
    store.ui.hsQuery = '';
    await loadState();
    renderApp();
  },

  'hs-section'(el) {
    store.ui.hsSection = el.dataset.id;
    store.ui.hsSearchResult = null;
    renderApp();
  },

  'hs-competitor'(el) {
    store.ui.hsCompetitor = el.dataset.id;
    renderApp();
  },

  async 'hs-connect'(el) {
    const p = store.ui.hsPlatform;
    store.ui.hsBusy = true;
    try {
      const res = await authFetch('/api/hotspot/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: p }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '无法打开登录窗口');
      toast('请在平台窗口完成登录，然后点击「我已登录，开始搜索」');
      await loadState();
      renderApp();
      startPolling();
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      store.ui.hsBusy = false;
      renderApp();
    }
  },

  async 'hs-confirm-login'() {
    const p = store.ui.hsPlatform;
    if (store.ui.hsBusy) return;
    store.ui.hsBusy = true;
    renderApp();
    try {
      const res = await authFetch('/api/hotspot/confirm-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: p }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '登录确认失败');
      toast(p === 'xiaohongshu' ? '已确认登录，正在同一窗口搜索竞品' : '已确认登录，正在读取热榜');
      await loadState();
      startPolling();
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      store.ui.hsBusy = false;
      renderApp();
    }
  },

  'hs-refresh'(el) { triggerCollect(store.ui.hsPlatform, false); },

  'hs-reconnect'(el) { actions['hs-connect'](el); },

  async 'hs-search'() {
    const kw = store.ui.hsQuery.trim();
    if (!kw) { toast('请输入要搜索的话题', 'err'); return; }
    if (store.ui.hsPlatform !== 'douyin' && platformState(store.ui.hsPlatform).status !== 'connected') {
      toast('请先连接平台账号', 'err');
      return;
    }
    store.ui.hsBusy = true;
    renderApp();
    try {
      const res = await authFetch('/api/hotspot/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: store.ui.hsPlatform, keyword: kw }),
      });
      const data = await res.json();
      store.ui.hsSearchResult = data;
      store.ui.hsSearchKeyword = kw;
    } catch (e) {
      store.ui.hsSearchResult = { ok: false, reason: '搜索请求失败：' + e.message };
      store.ui.hsSearchKeyword = kw;
    } finally {
      store.ui.hsBusy = false;
      renderApp();
    }
  },

  'hs-clear-search'() {
    store.ui.hsSearchResult = null;
    renderApp();
  },

  async 'hs-save-topic'() {
    const kw = store.ui.hsQuery.trim();
    if (!kw) return;
    const exists = savedTopicsOf(store.ui.hsPlatform).some((t) => t.keyword === kw);
    if (exists) { toast('该板块已在常用列表中'); return; }
    await mutate('save_topic', { platform: store.ui.hsPlatform, keyword: kw }, { toast: `已保存常用板块「${kw}」` });
  },

  'hs-del-topic'(el) {
    mutate('delete_topic', { id: el.dataset.id }, { toast: '已删除' });
  },

  async 'hs-run-saved'(el) {
    store.ui.hsQuery = el.dataset.kw;
    renderApp();
    await actions['hs-search']();
  },

  'hs-open-search'(el) {
    const url = searchUrl(store.ui.hsPlatform, el.dataset.title);
    window.open(url, '_blank', 'noopener');
  },
};

/* 输入与回车事件统一在 main.js 中绑定 */
