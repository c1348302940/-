'use strict';

/**
 * 热点雷达 · Playwright CLI 集成（真实采集）。
 *
 * 设计要点（对应产品说明书 §4.7 / §8 / §10）：
 *  - 按需求方指定，使用 **Playwright CLI**（`playwright cli`）而不是直接调用库：
 *      登录：cli -s=<session> open <平台登录页> → 本人确认已登录 → state-save <状态文件>
 *      采集：复用登录窗口逐项 goto / eval；以后单独刷新时才 open 并 state-load
 *    会话名 `ty-<userId>-<platform>` 使各人各平台浏览器互相隔离。
 *  - 状态文件按「用户+平台」隔离，存放 app/data/auth/<userId>-<platform>.json，
 *    不进入仓库、不写入日志、不收集平台密码。
 *  - 抖音打开热点页时刷新；小红书由本人确认登录后开始竞品搜索，或手动刷新。
 *  - 采集失败（未连接／需登录／反爬／网络受限）如实返回原因，不伪造实时数据。
 *  - 每条热点都带 source_kind，区分「平台热榜」与「热点关键词搜索／板块搜索补充」，
 *    绝不用搜索结果冒充热榜排名。
 *
 * 用法（CLI，供 server 或手工调用）：
 *   node lib/hotspot.js login   <platform> <userId>
 *   node lib/hotspot.js collect <platform> <userId>
 *   node lib/hotspot.js search  <platform> <userId> <keyword>
 */

const fs = require('node:fs');
const path = require('node:path');
const { normalizeUserId } = require('./hotspot-context');
const { execFile } = require('node:child_process');

const dbMod = require('./db');
const store = require('./store');
const { summarizeTopics, selectGameDiscussions, isObviousCommercial } = require('./competitor-topics');

const APP_DIR = path.join(__dirname, '..');
const PW_CLI = path.join(APP_DIR, 'node_modules', 'playwright', 'cli.js');
const AUTH_DIR = path.join(dbMod.DATA_DIR, 'auth');

const CLI_TIMEOUT_MS = 90 * 1000;
const MAX_SUPPLEMENT_SECTIONS = 4;      // 一次刷新最多补充几个板块，避免无限拉长
// 逐条打开视频详情页很慢（每条一次导航＋渲染等待，实测数秒），
// 只读取榜单靠前的若干条；排名靠后的条目保持「未提供」，不编造数字。
const MAX_VIDEO_ENRICH = 20;

/* ------------------------------------------------------------------ */
/* 平台配置                                                            */
/*                                                                     */
/* hotKind 表示该平台「热榜页」实际能取到的内容性质，必须如实标注：      */
/*   hotlist —— 平台官方热榜排序                                        */
/*   search_hot —— 搜索「热点」所得内容，不是热榜排名                   */
/*   unavailable —— 暂无经核实的稳定热榜入口                            */
/* ------------------------------------------------------------------ */
const PLATFORMS = {
  douyin: {
    label: '抖音',
    loginUrl: 'https://www.douyin.com/',
    hotUrl: 'https://www.douyin.com/hot',
    hotKind: 'hotlist',
    hotKindLabel: '平台热榜',
    // odin_tt 在未登录的访客会话中也会出现，不能用于确认登录。
    loginCookies: ['sessionid', 'sessionid_ss', 'sid_guard'],
    note: '读取抖音官方热榜页的榜单条目。',
  },
  xiaohongshu: {
    label: '小红书',
    loginUrl: 'https://www.xiaohongshu.com/explore',
    hotUrl: 'https://www.xiaohongshu.com/search_result?keyword=%E7%83%AD%E7%82%B9',
    // 默认内容改为「竞品玩家讨论监控」：按竞品逐个搜索，取真实玩家笔记。
    // 只读取搜索结果页的笔记卡片，不采集登录后的首页推荐流。
    hotKind: 'competitor',
    hotKindLabel: '竞品玩家讨论监控',
    // customerClientId 等访客标识不能证明本人已经登录。
    loginCookies: ['web_session'],
    note: '小红书暂无经核实的官方热榜入口，本页读取的是指定竞品的搜索结果（非官方榜单）。',
  },
};

/* ------------------------------------------------------------------ */
/* 竞品玩家讨论监控（小红书默认内容）                                  */
/*                                                                     */
/* 每个竞品一个分组，采集其搜索结果里的真实玩家笔记，最多展示 3 条。    */
/* 每个竞品只用游戏名称搜索一次；exclude 为排除词（区分同名端游/      */
/* 黄金服等易混淆内容）。字段一律只在真实采集成功后写入；搜索页取不到    */
/* 的字段（发布时间、点赞数等）留空，界面如实标注「未提供」，不推测。    */
/* ------------------------------------------------------------------ */
const COMPETITORS = [
  {
    key: 'nishuihan',
    label: '逆水寒手游',
    query: '逆水寒手游',
    exclude: ['黄金服', '端游'],
  },
  {
    key: 'nishuihan-gold',
    label: '逆水寒黄金服',
    query: '逆水寒黄金服',
    exclude: [],
  },
  {
    key: 'yimeng',
    label: '一梦江湖',
    query: '一梦江湖',
    exclude: [],
  },
  {
    key: 'tianya',
    label: '天涯明月刀手游',
    query: '天涯明月刀手游',
    exclude: ['端游', '天涯明月刀端游', '天刀端游'],
  },
  {
    key: 'qiannv',
    label: '倩女幽魂手游',
    query: '倩女幽魂手游',
    exclude: ['端游', '倩女幽魂端游'],
  },
];

/* ------------------------------------------------------------------ */
/* 固定板块（无「美食」）。一条热点可属于多个板块。                    */
/* ------------------------------------------------------------------ */
const SECTIONS = [
  { key: 'game', label: '游戏电竞', terms: ['游戏', '新赛季', '手游'], keywords: ['游戏', '电竞', '手游', '端游', '王者', '原神', '英雄联盟', 'LOL', '吃鸡', '和平精英', '赛博', '新赛季', '开服', '更新', '皮肤', '角色', '副本', '赛季', '联盟', '王者荣耀', '金铲铲', '蛋仔'] },
  { key: 'anime', label: '动漫二次元', terms: ['动漫', '新番', '二次元'], keywords: ['动漫', '二次元', '番剧', '动画', '漫画', 'cos', 'COS', '谷子', '手办', '新番', '番', 'CV', '声优', '漫展', '国漫', '日漫', 'jojo', 'JOJO', '咒术', '海贼', '火影'] },
  { key: 'tv', label: '影视综艺', terms: ['电视剧', '综艺', '电影'], keywords: ['剧', '电影', '综艺', '电视剧', '网剧', '热播', '演员', '明星', '导演', '开播', '大结局', '剧集', '票房', '卫视', '真人秀', '选秀'] },
  { key: 'music', label: '音乐舞蹈', terms: ['新歌', '音乐', '舞蹈'], keywords: ['音乐', '歌', '舞蹈', '舞', '演唱会', '新歌', 'MV', '专辑', '歌手', '乐队', '合唱', '编舞', '街舞', '音乐节', '说唱', 'rap', '钢琴', '吉他'] },
  { key: 'travel', label: '旅游城市', terms: ['旅游', '城市', '景点'], keywords: ['旅游', '旅行', '城市', '景区', '景点', '出游', '打卡', '攻略', '民宿', '酒店', '航班', '高铁', '自驾', '出国', '签证', '北京', '上海', '成都', '西安', '三亚', '云南', '新疆', '敦煌'] },
  { key: 'guofeng', label: '国风文化', terms: ['国风', '汉服', '非遗'], keywords: ['国风', '汉服', '国潮', '非遗', '传统文化', '故宫', '博物馆', '诗词', '书法', '戏曲', '古风', '中式', '节气', '文物', '考古', '国画', '茶', '香道'] },
  { key: 'beauty', label: '时尚美妆', terms: ['美妆', '穿搭', '护肤'], keywords: ['美妆', '护肤', '妆容', '口红', '彩妆', '香水', '穿搭', '时尚', '发型', '美甲', '眼影', '底妆', '素颜', '变美', '显瘦', '搭配', '潮流', '大牌'] },
  { key: 'lifestyle', label: '生活方式', terms: ['生活方式', '家居', '收纳'], keywords: ['生活', '美食', '吃', '做饭', '食谱', '家常菜', '探店', '零食', '饮品', '咖啡', '奶茶', '早餐', '晚餐', '收纳', '家居', '装修', '租房', '健身', '减肥', '养生', '育儿', '学习', '职场', '副业', '存钱', '省钱', 'vlog'] },
  { key: 'tech', label: '科技与AI', terms: ['AI', '科技', '数码'], keywords: ['AI', '人工智能', '科技', '芯片', '手机', '汽车', '新能源', '特斯拉', '苹果', '华为', '小米', '发布会', '机器人', '大模型', 'ChatGPT', '开源', '航天', '火箭', '卫星', '数码', '电脑', '程序员'] },
  { key: 'pet', label: '萌宠', terms: ['萌宠', '猫咪', '狗狗'], keywords: ['宠物', '猫', '狗', '萌宠', '猫咪', '狗狗', '猫猫', '仓鼠', '鹦鹉', '领养', '铲屎官', '吸猫', '撸猫'] },
  { key: 'sports', label: '体育运动', terms: ['体育', '比赛', '运动'], keywords: ['体育', '篮球', '足球', '世界杯', 'NBA', 'CBA', '排球', '乒乓', '游泳', '马拉松', '奥运', '亚运', '比赛', '夺冠', '运动员', '球赛', '健身', '羽毛球', '网球', '电竞比赛'] },
  { key: 'other', label: '其他', terms: ['热门', '话题'], keywords: [] },
];

function classify(title) {
  const hits = [];
  for (const s of SECTIONS) {
    if (s.key === 'other') continue;
    if (s.keywords.some((k) => title.includes(k))) hits.push(s.key);
  }
  if (hits.length === 0) hits.push('other');
  return hits;
}

/**
 * 板块补充搜索词：不用一组永久不变的死词。
 * 以板块核心词 × 当期时令词轮换组合，按周次推进，随时间和板块变化。
 */
const SEASON_WORDS = ['本周', '近期', '热门', '最新', '爆款', '出圈', '刷屏', '上榜'];

function weekIndex(date = new Date()) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  return Math.floor((date.getTime() - start) / (7 * 86400000));
}

function supplementQuery(sectionKey, date = new Date()) {
  const sec = SECTIONS.find((s) => s.key === sectionKey);
  if (!sec || !sec.terms.length) return null;
  const w = weekIndex(date);
  const term = sec.terms[w % sec.terms.length];
  const season = SEASON_WORDS[(w + sec.key.length) % SEASON_WORDS.length];
  return `${term} ${season}`;
}

/* ------------------------------------------------------------------ */
/* Playwright CLI 封装                                                 */
/* ------------------------------------------------------------------ */

function sessionName(userId, platform) {
  // 登录确认与本轮搜索共用会话；搜索完成后才关闭窗口。
  return `ty-${userId}-${platform}`;
}

async function cliSessionOpen(session) {
  const r = await runCli(session, ['tab-list'], 30000);
  return r.ok;
}

function cliAvailable() {
  return fs.existsSync(PW_CLI);
}

function runCli(session, args, timeout = CLI_TIMEOUT_MS) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [PW_CLI, 'cli', `-s=${session}`, ...args],
      { cwd: APP_DIR, timeout, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => resolve({
        ok: !error,
        out: String(stdout || ''),
        err: String(stderr || ''),
        error,
      })
    );
  });
}

/** 解析 `### Result` 之后的 JSON 结果行（eval 的返回值） */
function parseEvalResult(out) {
  const lines = out.split(/\r?\n/);
  const i = lines.findIndex((l) => l.trim() === '### Result');
  if (i < 0) return null;
  const line = lines.slice(i + 1).find((l) => l.trim() !== '');
  if (!line) return null;
  let v;
  try { v = JSON.parse(line); } catch (_) { return null; }
  // eval 返回字符串时会被再包一层引号
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { /* 原样返回字符串 */ } }
  return v;
}

async function cliEval(session, fnSource, timeout) {
  const r = await runCli(session, ['eval', fnSource], timeout);
  if (!r.ok && !r.out) return null;
  return parseEvalResult(r.out);
}

/** 读取会话当前 cookie 名集合（用于判断是否已登录） */
async function cliCookieNames(session) {
  const r = await runCli(session, ['cookie-list'], 30000);
  if (/No cookies found/i.test(r.out)) return new Set();
  const names = new Set();
  for (const line of r.out.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_.\-]+)\s*=/);
    if (m) names.add(m[1]);
    else {
      const m2 = line.match(/name["'\s:=]+([A-Za-z0-9_.\-]+)/i);
      if (m2) names.add(m2[1]);
    }
  }
  return names;
}

/* ------------------------------------------------------------------ */
/* 登录状态文件                                                        */
/* ------------------------------------------------------------------ */

function stateFile(userId, platform) {
  return path.join(AUTH_DIR, `${userId}-${platform}.json`);
}

function ensureAuthDir() {
  if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });
}

function readState(userId, platform) {
  const f = stateFile(userId, platform);
  if (!fs.existsSync(f)) return null;
  try {
    const st = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (!st || !Array.isArray(st.cookies) || st.cookies.length === 0) return null;
    return st;
  } catch (_) {
    return null;
  }
}

function hasLoginCookie(storageState, platform) {
  if (!storageState || !Array.isArray(storageState.cookies)) return false;
  const expectedDomain = platform === 'xiaohongshu' ? 'xiaohongshu.com' : 'douyin.com';
  const nowSeconds = Date.now() / 1000;
  return storageState.cookies.some((cookie) => {
    const domain = String(cookie.domain || '').replace(/^\./, '').toLowerCase();
    const validDomain = domain === expectedDomain || domain.endsWith('.' + expectedDomain);
    const expires = Number(cookie.expires);
    const notExpired = !Number.isFinite(expires) || expires <= 0 || expires > nowSeconds;
    return PLATFORMS[platform].loginCookies.includes(cookie.name) && validDomain && notExpired;
  });
}

function setConn(userId, platform, status, statusDetail) {
  store.apply('set_connection_status',
    { userId, platform, status, statusDetail, statePath: stateFile(userId, platform) }, userId);
}

function clearTrends(userId, platform) {
  store.run('DELETE FROM trend_items WHERE user_id = ? AND platform = ?', userId, platform);
}

function insertTrends(userId, platform, items) {
  clearTrends(userId, platform);
  const t = dbMod.now();
  for (const it of items) {
    store.run(
      `INSERT INTO trend_items (user_id, platform, title, category, heat, link, discovered_at, is_real, source_kind, query,
         video_like_count, video_comment_count, video_published_at, video_link, board_rank)
       VALUES (?,?,?,?,?,?,?,1,?,?,?,?,?,?,?)`,
      userId, platform, it.title, (it.category || []).join(','), it.heat || '',
      it.link || '', t, it.sourceKind || 'hotlist', it.query || '',
      it.videoLikeCount || null, it.videoCommentCount || null,
      it.videoPublishedAt || null, it.videoLink || null,
      typeof it.rank === 'number' ? it.rank : null
    );
  }
}

/* ------------------------------------------------------------------ */
/* 页面取数脚本（在平台页面里执行）                                     */
/* ------------------------------------------------------------------ */

/** 抖音热榜：优先定位榜单容器，并剔除导航／分类等杂项文本 */
const DOUYIN_EXTRACT = `() => {
  const NAV = /^(首页|推荐|关注|朋友|我的|直播|放映厅|热榜|搜索|搜索发现|登录|下载|客户端|反馈|关于我们|更多|展开|收起|全部分类|榜单|抖音热榜|品牌榜|电商榜|城市榜|娱乐|社会|科技|财经|汽车|房产|职场|教育|母婴|时尚|美妆|情感|摄影|舞蹈|三农|军事|历史|文化|搞笑|游戏|二次元|音乐|影视|综艺|美食|旅行|动物|知识|体育|生活|热点|要闻|榜单规则|查看更多|上滑发现更多)$/;
  const out = []; const seen = new Set();
  const push = (title, heat, href, rank) => {
    const s = String(title || '').replace(/\\s+/g, ' ').trim();
    if (!s || s.length < 2 || s.length > 42) return;
    if (NAV.test(s)) return;
    if (/^[0-9.]+$/.test(s)) return;
    if (/^[0-9]+\\s*(万|亿|w|W)?$/.test(s)) return;
    if (seen.has(s)) return;
    seen.add(s);
    out.push({ title: s, heat: heat || '', href: href || '', rank: typeof rank === 'number' ? rank : null });
  };
  // 名次必须读平台自己的名次槽，不能用数组下标。抖音热榜是「1 条置顶 + 50 个名次」：
  // 前 3 名用 hot_topN.svg 图标，第 4 名起才是纯数字文本，置顶条只有 up.svg 之类图标、
  // 不占名次。用下标会把每条都多算 1 位，还会把置顶条当成第 1 名。
  const rankOf = (n) => {
    const li = (n.closest && n.closest('li')) || n;
    const img = li.querySelector('img[src*="hot_top"]');
    if (img) {
      const m = String(img.getAttribute('src') || '').match(/hot_top(\\d+)\\.svg/i);
      if (m) return Number(m[1]);
    }
    const slot = li.querySelector(':scope > div') || li.firstElementChild;
    const t = slot ? String(slot.textContent || '').replace(/\\s+/g, '') : '';
    const m = t.match(/^(\\d{1,2})$/);
    return m ? Number(m[1]) : null;
  };
  const SEL = ['[data-e2e="hot-list"] li', '[class*="hotList"] li', '[class*="hot-list"] li', '[class*="rankList"] li', '[class*="rank-list"] li'];
  let nodes = [];
  for (const s of SEL) { const n = document.querySelectorAll(s); if (n.length >= 5) { nodes = Array.from(n); break; } }
  if (!nodes.length) {
    const anchorNodes = Array.from(document.querySelectorAll('a[href*="/search"], a[href*="/hot/"]'))
      .map((a) => a.closest('li') || a.parentElement || a);
    const uniq = []; const mark = new Set();
    for (const n of anchorNodes) { if (!mark.has(n)) { mark.add(n); uniq.push(n); } }
    if (uniq.length >= 5) nodes = uniq;
  }
  for (const n of nodes.slice(0, 80)) {
    const a = n.querySelector('a[href*="/search"], a[href*="/hot/"]');
    const lines = String(n.innerText || n.textContent || '').split('\\n').map((x) => x.trim()).filter(Boolean);
    const title = a ? (a.textContent || '').trim() : (lines[0] || '');
    let heat = '';
    // 榜单里热度行的实际文本是「1153.6万热度」，末尾带「热度」两字，
    // 早期只匹配纯数字＋单位，导致整榜热度被丢空。这里允许可选后缀。
    for (const l of lines) { const m = l.match(/^([0-9.]+\\s*(?:万|亿|w|W))(?:\\s*热度)?$/); if (m) { heat = m[1].replace(/\\s+/g, ''); break; } }
    let href = '';
    if (a && a.getAttribute) { const h = a.getAttribute('href') || ''; if (h) href = h.startsWith('http') ? h : 'https://www.douyin.com' + h; }
    push(title, heat, href, rankOf(n));
  }
  return JSON.stringify(out.slice(0, 60));
}`;

/** 热榜话题链接打开后，抖音会跳转到一条关联视频。以下仅取该视频的数据。 */
const DOUYIN_VIDEO_EXTRACT = `() => {
  if (!/^\\/video\\/\\d+/.test(location.pathname)) return JSON.stringify({});
  const info = document.querySelector('[data-e2e="detail-video-info"]');
  const published = info?.querySelector('[data-e2e="detail-video-publish-time"]');
  if (!info || !published) return JSON.stringify({});
  const group = info.children[2]?.children[0];
  const values = group ? Array.from(group.children).slice(0, 2).map((el) =>
    String(el.innerText || '').trim()) : [];
  const valid = (s) => /^(?:\\d+(?:\\.\\d+)?)(?:万|亿)?$/.test(s || '');
  const time = String(published.innerText || '').replace(/^发布时间[：:]\\s*/, '').trim();
  return JSON.stringify({
    likeCount: valid(values[0]) ? values[0] : '',
    commentCount: valid(values[1]) ? values[1] : '',
    publishedAt: /^\\d{4}-\\d{2}-\\d{2}/.test(time) ? time : '',
    videoLink: location.origin + location.pathname,
  });
}`;

/** 平台搜索结果：取结果卡片标题与真实链接 */
const SEARCH_EXTRACT = `() => {
  const out = []; const seen = new Set();
  const isXhs = location.hostname.endsWith('xiaohongshu.com');
  const anchors = document.querySelectorAll(isXhs
    ? 'a[href*="/search_result/"], a[href*="/explore/"]'
    : 'a[href*="/search"], a[href*="/video/"]');
  for (const a of anchors) {
    const txt = String(a.textContent || '').replace(/\\s+/g, ' ').trim();
    const t = (txt.length >= 4 && txt.length <= 80) ? txt
      : String((a.getAttribute('title') || a.getAttribute('aria-label') || '')).trim();
    if (!t || t.length < 4 || t.length > 80) continue;
    if (seen.has(t)) continue;
    const h = a.getAttribute('href') || '';
    let href = '';
    try {
      const u = new URL(h, location.href);
      if (!h || !['https:', 'http:'].includes(u.protocol) || u.hostname !== location.hostname) continue;
      href = u.href;
    } catch (_) { continue; }
    seen.add(t);
    out.push({ title: t, heat: '', href });
    if (out.length >= 40) break;
  }
  return JSON.stringify(out);
}`;

/** 竞品搜索：保持「最新」结果的页面顺序，尽力取真实互动数据 */
const COMPETITOR_EXTRACT = `() => {
  const out = []; const seen = new Set();
  const host = location.hostname;
  const clean = (s) => String(s || '').replace(/\\s+/g, ' ').trim();
  const abs = (h) => {
    if (!h) return '';
    try {
      const u = new URL(h, location.href);
      if (!['https:', 'http:'].includes(u.protocol) || u.hostname !== host) return '';
      // 搜索卡片的 /search_result/<id> 不能直接导航；站内点击会跳到
      // /explore/<id>。保留 xsec_token 等查询参数，生成可打开的详情链接。
      if (u.pathname.startsWith('/search_result/'))
        u.pathname = u.pathname.replace('/search_result/', '/explore/');
      return u.href;
    } catch (_) { return ''; }
  };
  const anchors = Array.from(document.querySelectorAll(
    'a[href*="/explore/"], a[href*="/search_result/"], a[href*="/discovery/item/"]'));
  const cards = Array.from(new Set(anchors.map((a) => a.closest('section.note-item') || a.closest('section') || a.closest('li') || a.parentElement || a)));
  for (const card of cards) {
    // 小红书卡片第一个链接是无文字封面；必须优先读取 a.title。
    const links = Array.from(card.querySelectorAll('a[href*="/explore/"], a[href*="/search_result/"], a[href*="/discovery/item/"]'));
    const a = links.find((x) => x.classList.contains('title'))
      || links.find((x) => clean(x.textContent).length >= 4)
      || (card.tagName === 'A' ? card : null);
    if (!a) continue;
    const href = abs(a.getAttribute('href') || '');
    if (!href || seen.has(href)) continue;
    const title = clean(a.getAttribute('title') || a.getAttribute('aria-label') || a.textContent || '');
    if (title.length < 4 || title.length > 80) continue;
    const find = (sel) => { const el = card.querySelector(sel); return el ? clean(el.textContent) : ''; };
    let likeCount = find('[class*="like"] [class*="count"], .like-wrapper .count, [class*="like-count"]');
    if (!/^\\d+(?:\\.\\d+)?(?:万|w|W|亿)?$/.test(likeCount.replace(/\\s+/g, ''))) likeCount = '';
    let commentCount = find('[class*="comment"] [class*="count"], [class*="comment-count"]');
    if (!/^\\d+(?:\\.\\d+)?(?:万|w|W|亿)?$/.test(commentCount.replace(/\\s+/g, ''))) commentCount = '';
    const author = find('[class*="author"] [class*="name"], [class*="author-name"], [class*="author"] .name');
    const publishedAt = find('[class*="date"], [class*="time"], [class*="publish"]');
    seen.add(href);
    out.push({ title, href, likeCount, commentCount, author, publishedAt,
      content: clean(card.innerText || '').slice(0, 900) });
    if (out.length >= 30) break;
  }
  return JSON.stringify(out);
}`;

/** 搜索结果卡片的文本可能很短；在同一浏览器窗口逐条读取正文。 */
const COMPETITOR_DETAIL_EXTRACT = `() => {
  const clean = (s) => String(s || '').replace(/\\s+/g, ' ').trim();
  const sels = ['#detail-desc', '.note-content', '[class*="note-content"]', '[class*="noteContent"]', '.desc'];
  let content = '';
  let source = 'body';
  for (const sel of sels) {
    const el = document.querySelector(sel);
    if (el && clean(el.innerText).length > content.length) content = clean(el.innerText);
  }
  const meta = document.querySelector('meta[name="description"]')?.content || '';
  if (clean(meta).length > content.length) { content = clean(meta); source = 'meta'; }
  const count = document.querySelector('[class*="comment"] [class*="count"], [class*="comment-count"]');
  return JSON.stringify({ url: location.href, content: content.slice(0, 2200), source, commentCount: clean(count?.textContent || '') });
}`;

async function enrichCompetitorNotes(session, notes, game, userId) {
  const out = [];
  for (let i = 0; i < notes.length; i++) {
    const note = { ...notes[i] };
    const nav = await runCli(session, ['goto', note.link], 60000);
    if (nav.ok || nav.out) {
      await new Promise((r) => setTimeout(r, 900));
      const detail = await cliEval(session, COMPETITOR_DETAIL_EXTRACT, 30000);
      if (detail?.url?.includes('/website-login/error') || /访问频繁|请稍后再试/.test(detail?.content || ''))
        throw new Error('小红书提示“访问频繁，请稍后再试”，已停止本轮采集。请等平台限制解除后刷新，未读取正文的帖子不会计入 30 篇。');
      if (detail?.url && /^https:\/\/www\.xiaohongshu\.com\/(explore|discovery\/item|search_result)\//.test(detail.url)) {
        if (detail.content && detail.content.length >= (detail.source === 'meta' ? 80 : 20)) {
          note.content = detail.content;
          note.bodyRead = true;
        }
        if (detail.commentCount && /^\d+(?:\.\d+)?(?:万|w|W|亿)?$/.test(detail.commentCount))
          note.noteCommentCount = detail.commentCount;
      }
    }
    out.push(note);
    if ((i + 1) % 5 === 0) setConn(userId, 'xiaohongshu', 'refreshing', `${game}：已读取 ${i + 1}/${notes.length} 条帖子内容…`);
  }
  return out;
}

function searchUrl(platform, keyword) {
  return platform === 'douyin'
    ? 'https://www.douyin.com/search/' + encodeURIComponent(keyword) + '?type=general'
    : 'https://www.xiaohongshu.com/search_result?keyword=' + encodeURIComponent(keyword);
}

/** 结果没有给出链接时，退回到平台搜索页链接（仍是可打开的原始来源） */
function fallbackLink(platform, title) {
  return searchUrl(platform, title);
}

/**
 * 把提取器返回的原始条目转成待入库的热点条目。
 *
 * 单独抽成一层并导出，是因为这里踩过坑：原先分成两层 map，第一层只保留
 * title/heat/link，把 rank 丢掉了，第二层再去读 x.rank 永远是 undefined，
 * 于是整批名次以空值入库、界面上每条都被显示成「置顶」。
 * 合成一层可以避免这类「中间层漏字段」，也便于自检脚本直接断言名次不丢。
 */
function toTrendItems(raw, platform, cfg) {
  return raw
    .map((x) => ({
      title: String(x.title || '').replace(/\s+/g, ' ').trim(),
      heat: x.heat || '',
      link: x.href || '',
      // 平台自己的名次；为空表示不占名次（抖音置顶条或小红书搜索结果）
      rank: typeof x.rank === 'number' ? x.rank : null,
    }))
    .filter((x) => x.title && x.title.length >= 2 && x.title.length <= 60)
    .map((x) => ({
      title: x.title,
      category: classify(x.title),
      heat: x.heat,
      link: x.link || fallbackLink(platform, x.title),
      rank: x.rank,
      sourceKind: cfg.hotKind,
      query: cfg.hotKind === 'search_hot' ? '热点' : '',
    }));
}

async function enrichDouyinVideos(session, userId, items) {
  let enriched = 0;
  // items 已按榜单名次排列，截取前 MAX_VIDEO_ENRICH 条（名次靠前的更值得看）
  const targets = items
    .filter((it) => /^https:\/\/www\.douyin\.com\/hot\/\d+/.test(it.link))
    .slice(0, MAX_VIDEO_ENRICH);
  for (let i = 0; i < targets.length; i++) {
    const it = targets[i];
    if (i % 5 === 0) setConn(userId, 'douyin', 'refreshing', `正在读取关联视频数据 ${i + 1}/${targets.length}…`);
    const nav = await runCli(session, ['goto', it.link], 60000);
    if (!nav.ok && !nav.out) continue;
    // 详情页实测要约 4 秒才渲染出 [data-e2e="detail-video-info"]，
    // 这里给到 4×2s＝8 秒，避免偶发取空被当成「未提供」。
    for (let attempt = 0; attempt < 4; attempt++) {
      await new Promise((r) => setTimeout(r, 2000));
      const data = await cliEval(session, DOUYIN_VIDEO_EXTRACT, 30000);
      if (!data || !data.videoLink) continue;
      it.videoLikeCount = data.likeCount || null;
      it.videoCommentCount = data.commentCount || null;
      it.videoPublishedAt = data.publishedAt || null;
      it.videoLink = data.videoLink;
      enriched++;
      break;
    }
  }
  return { enriched, tried: targets.length, matched: items.length };
}

/* ------------------------------------------------------------------ */
/* 顶层动作                                                            */
/* ------------------------------------------------------------------ */

async function doLogin(platform, userId) {
  const cfg = PLATFORMS[platform];
  if (!cfg) throw new Error('未知平台: ' + platform);
  if (!cliAvailable()) {
    const msg = 'Playwright CLI 不可用：请在 app/ 目录运行 npm install 与 npx playwright install chromium。';
    setConn(userId, platform, 'error', msg);
    return { ok: false, status: 'error', reason: msg };
  }

  const session = sessionName(userId, platform);
  setConn(userId, platform, 'connecting', '正在打开平台官方页面，请在弹出的浏览器窗口完成登录…');
  const action = await cliSessionOpen(session)
    ? await runCli(session, ['goto', cfg.loginUrl], 120000)
    : await runCli(session, ['open', '--headed', cfg.loginUrl], 120000);
  if (!action.ok) {
    const msg = '无法打开登录页面：' + (action.err || action.out || action.error?.message || '未知原因').trim().slice(0, 200);
    setConn(userId, platform, 'error', msg);
    return { ok: false, status: 'error', reason: msg };
  }
  setConn(userId, platform, 'connecting', '登录窗口已打开。请完成登录，然后点击「我已登录，开始搜索」；窗口会在整轮搜索结束后关闭。');
  return { ok: true, status: 'connecting' };
}

/** 本人确认登录后才保存状态；仅有 Cookie 不会自动开始搜索。 */
async function doConfirmLogin(platform, userId) {
  const cfg = PLATFORMS[platform];
  if (!cfg) return { ok: false, reason: '未知平台' };
  const session = sessionName(userId, platform);
  if (!(await cliSessionOpen(session))) {
    setConn(userId, platform, 'expired', '登录窗口已关闭。请重新连接账号后再确认。');
    return { ok: false, reason: '登录窗口已关闭，请重新连接账号。' };
  }
  const names = await cliCookieNames(session);
  if (!cfg.loginCookies.some((name) => names.has(name))) {
    return { ok: false, reason: '还未检测到有效登录状态。请在打开的窗口完成登录后，再点击确认。' };
  }
  ensureAuthDir();
  const saved = await runCli(session, ['state-save', stateFile(userId, platform)], 60000);
  if (!saved.ok || !hasLoginCookie(readState(userId, platform), platform)) {
    return { ok: false, reason: '登录状态保存失败，请保持窗口打开后重试。' };
  }
  return { ok: true, status: 'confirmed' };
}

/**
 * 读取目标页并取数；有有效登录状态时恢复状态，抖音公开榜可直接匿名读取。
 *
 * 有登录状态时顺序是 open → state-load → goto：
 *  1) open 先开浏览器。会话没打开时 state-load 会被直接拒绝
 *     （exit 1，提示 "please run open first"，而且提示打在 stdout、stderr 为空，
 *      所以判断成败必须看退出码，不能只看 stderr）。
 *  2) state-load 必须在导航之前，登录 cookie 才会对本次请求生效。
 *  3) 抖音后台采集使用无头浏览器，避免每次刷新都弹新窗口；
 *     小红书仍需有头模式，因为无头模式曾触发平台安全限制。
 */
async function cliGotoAndExtract(session, url, extractFn, statePath, headed = false, latest = false, limit = 30) {
  // open 在已有会话上会重开浏览器，导致登录窗口突然关闭；只在确实没有会话时调用。
  if (!(await cliSessionOpen(session))) {
    const open = await runCli(session, headed ? ['open', '--headed'] : ['open'], 120000);
    if (!open.ok) {
      return { ok: false, reason: '打开浏览器失败：' + (open.err || open.out || '').trim().slice(0, 200) };
    }
    if (statePath) {
      const load = await runCli(session, ['state-load', statePath], 60000);
      if (!load.ok) {
        return { ok: false, reason: '登录状态加载失败：' + (load.out || load.err || '').trim().slice(0, 200) };
      }
    }
  }

  const nav = await runCli(session, ['goto', url], 120000);
  if (!nav.ok && !nav.out) {
    return { ok: false, reason: '打开页面失败：' + (nav.err || nav.out || '').trim().slice(0, 200) };
  }

  // 页面内容多为异步渲染，给一点时间
  await new Promise((r) => setTimeout(r, 3500));
  if (latest) {
    const sorted = await selectLatestSort(session);
    if (!sorted.ok) return sorted;
    // 点击「最新」后结果列表会重新加载，不能读取切换前的默认排序。
    await new Promise((r) => setTimeout(r, 3500));
    // 小红书会回收已滚出屏幕的卡片，必须每次滚动前累积，不能只在底部提取一次。
    const rows = []; const seen = new Set(); let stagnant = 0;
    for (let i = 0; i < 60; i++) {
      const before = rows.length;
      const visible = await cliEval(session, extractFn, 90000);
      for (const note of Array.isArray(visible) ? visible : []) {
        if (!note.href || seen.has(note.href)) continue;
        seen.add(note.href);
        rows.push(note);
      }
      stagnant = rows.length === before ? stagnant + 1 : 0;
      if (rows.length >= limit || stagnant >= 6) break;
      await cliEval(session, `() => { window.scrollTo(0, document.body.scrollHeight); return true; }`, 30000);
      await new Promise((r) => setTimeout(r, 1100));
    }
    return { ok: true, data: rows.slice(0, limit) };
  }
  const data = await cliEval(session, extractFn, 90000);
  return { ok: true, data: Array.isArray(data) ? data : [] };
}

/** 在官方搜索页点击「最新」。控件找不到时失败，不把默认综合结果冒充最新结果。 */
async function selectLatestSort(session) {
  const panelOpen = `() => !!document.querySelector('.filter-panel')`;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (await cliEval(session, panelOpen, 30000)) break;
    await cliEval(session, `() => { const el = document.querySelector('.filter'); if (!el) return false; el.click(); return true; }`, 30000);
    await new Promise((r) => setTimeout(r, 350));
  }
  if (!(await cliEval(session, panelOpen, 30000))) {
    return { ok: false, reason: '小红书搜索页的「筛选」菜单未能展开。' };
  }
  const clicked = await cliEval(session, `() => {
    const choices = Array.from(document.querySelectorAll('.filter-panel .tags:not([aria-hidden])'));
    const latest = choices.find((el) => el.textContent.trim() === '最新');
    if (!latest) return false;
    latest.click(); return true;
  }`, 30000);
  if (!clicked) return { ok: false, reason: '小红书筛选菜单未找到可点击的「最新」选项。' };
  await new Promise((r) => setTimeout(r, 400));
  const active = await cliEval(session, `() => Array.from(document.querySelectorAll('.filter-panel .tags.active:not([aria-hidden])')).some((el) => el.textContent.trim() === '最新')`, 30000);
  return active ? { ok: true }
    : { ok: false, reason: '点击后未能确认「最新」排序已生效，本次结果未保存。' };
}

async function collectPlatform(platform, userId) {
  const cfg = PLATFORMS[platform];
  const state = readState(userId, platform);
  const loggedIn = hasLoginCookie(state, platform);

  if (platform !== 'douyin' && !state) {
    setConn(userId, platform, 'disconnected', '尚未连接，请先连接平台账号。');
    return { ok: false, status: 'disconnected', reason: '尚未连接' };
  }
  if (platform !== 'douyin' && !loggedIn) {
    setConn(userId, platform, 'expired', '登录状态已失效，请重新连接。');
    return { ok: false, status: 'expired', reason: '登录状态已失效' };
  }

  const session = sessionName(userId, platform);
  const f = loggedIn ? stateFile(userId, platform) : null;
  setConn(userId, platform, 'refreshing', `正在通过 Playwright CLI 读取${cfg.hotKindLabel}…`);

  try {
    const extract = platform === 'douyin' ? DOUYIN_EXTRACT : SEARCH_EXTRACT;
    const r = await cliGotoAndExtract(session, cfg.hotUrl, extract, f, platform === 'xiaohongshu');
    if (!r.ok) throw new Error(r.reason);

    const items = toTrendItems(r.data, platform, cfg);

    if (items.length === 0) {
      throw new Error(`${cfg.label}未返回可识别的内容（可能需要登录、页面结构变化或存在反爬限制）。`);
    }

    // ---- 板块缺少热榜内容时，用动态关键词搜索补充（结果单独标注来源）----
    const supplement = await supplementEmptySections(platform, session, f, items);
    const video = platform === 'douyin'
      ? await enrichDouyinVideos(session, userId, items)
      : { enriched: 0, tried: 0, matched: 0 };
    const all = items.concat(supplement.items);
    // 采集完成不关闭浏览器：保持窗口打开，登录时回写一次状态，避免下次重复登录。
    if (f) await runCli(session, ['state-save', f], 60000).catch(() => {});

    insertTrends(userId, platform, all);

    let detail = `${cfg.hotKindLabel} ${items.length} 条`;
    if (supplement.items.length) {
      detail += `；关键词搜索补充 ${supplement.items.length} 条（覆盖 ${supplement.sections.length} 个板块）`;
    }
    if (platform === 'douyin') {
      detail += `；已读取 ${video.enriched}/${video.tried} 条关联视频数据（点赞／评论／发布时间）`;
      if (video.tried < video.matched) {
        detail += `，单次只读取榜单前 ${MAX_VIDEO_ENRICH} 条，其余标注为未提供`;
      }
    }
    if (supplement.skipped.length) {
      detail += `；另有 ${supplement.skipped.length} 个空板块未补充（单次上限 ${MAX_SUPPLEMENT_SECTIONS}）`;
    }
    if (cfg.hotKind !== 'hotlist') detail += `。注意：${cfg.note}`;
    const finalStatus = loggedIn ? 'connected' : 'public';
    if (platform === 'douyin' && !loggedIn) detail = '公开页面读取（无需登录）；' + detail;
    setConn(userId, platform, finalStatus, detail);
    return { ok: true, status: finalStatus, count: all.length, hotCount: items.length, supplementCount: supplement.items.length };
  } catch (e) {
    // 采集失败也保持浏览器窗口打开，便于直接重试，无需重新登录。
    if (f) await runCli(session, ['state-save', f], 60000).catch(() => {});
    setConn(userId, platform, 'error', e.message);
    return { ok: false, status: 'error', reason: e.message };
  }
}

/** 找出热榜里没有内容的板块，逐个用动态关键词搜索补充 */
async function supplementEmptySections(platform, session, statePath, hotItems) {
  const covered = new Set();
  for (const it of hotItems) for (const c of it.category) covered.add(c);

  const empty = SECTIONS.filter((s) => s.key !== 'other' && !covered.has(s.key));
  const todo = empty.slice(0, MAX_SUPPLEMENT_SECTIONS);
  const skipped = empty.slice(MAX_SUPPLEMENT_SECTIONS);

  const items = [];
  const sections = [];
  for (const sec of todo) {
    const q = supplementQuery(sec.key);
    if (!q) continue;
    const r = await cliGotoAndExtract(session, searchUrl(platform, q), SEARCH_EXTRACT, statePath, platform === 'xiaohongshu');
    if (!r.ok || !r.data.length) continue;
    let added = 0;
    for (const x of r.data.slice(0, 8)) {
      const title = String(x.title || '').replace(/\s+/g, ' ').trim();
      if (!title || title.length < 4 || title.length > 80) continue;
      items.push({
        title,
        // 结果归入被补充的板块，但仍保留分类命中的其它板块
        category: Array.from(new Set([sec.key, ...classify(title)])),
        heat: '',
        link: x.href || fallbackLink(platform, title),
        sourceKind: 'search',
        query: q,
      });
      added++;
    }
    if (added) sections.push({ key: sec.key, label: sec.label, query: q, count: added });
  }
  return { items, sections, skipped: skipped.map((s) => s.key) };
}

/* ------------------------------------------------------------------ */
/* 竞品玩家讨论监控                                                    */
/* ------------------------------------------------------------------ */

/** 解析「1.2万 / 3亿 / 100w」这类计数为数值，解析不了返回 0 */
function parseNoteCount(s) {
  if (!s) return 0;
  const m = String(s).replace(/\s+/g, '').match(/^(\d+(?:\.\d+)?)(万|w|W|亿)?$/);
  if (!m) return 0;
  let n = parseFloat(m[1]);
  if (m[2] === '万' || m[2] === 'w' || m[2] === 'W') n *= 10000;
  else if (m[2] === '亿') n *= 100000000;
  return n;
}

/** 讨论价值：点赞 + 评论（评论权重更高）。取不到计数时都为 0，排序退化为稳定序。 */
function noteValue(n) {
  return parseNoteCount(n.noteLikeCount) + parseNoteCount(n.noteCommentCount) * 3;
}

const SEVEN_DAYS_MS = 7 * 86400000;

/** 解析笔记发布时间。绝对日期或「x天前/昨天/今天/小时/分钟/刚刚」都可；解析不了返回 null */
function parseNoteDate(s, now) {
  if (!s) return null;
  const t = String(s).trim();
  let m = t.match(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return isNaN(d.getTime()) ? null : d;
  }
  if (/刚刚|分钟|小时|今天|昨天/.test(t)) return now;
  m = t.match(/^(\d+)\s*天前/);
  if (m) { const d = new Date(now); d.setDate(d.getDate() - Number(m[1])); return d; }
  return null;
}

/**
 * 近 7 天过滤：只在能解析出发布时间时生效；解析不了的笔记保留（无法判断），
 * 但会在采集报告里如实说明有多少条未取得发布时间、未参与过滤。
 */
function filterRecentNotes(notes, now) {
  let kept = [];
  let dropped = 0;
  for (const n of notes) {
    const d = parseNoteDate(n.notePublishedAt, now);
    if (!d) { kept.push(n); continue; }
    if (now.getTime() - d.getTime() <= SEVEN_DAYS_MS) kept.push(n);
    else dropped++;
  }
  return { kept, dropped };
}

/** 去重：同一链接只保留一条（不同搜索词可能返回同一篇笔记） */
function dedupNotes(notes) {
  const seen = new Set();
  const out = [];
  for (const n of notes) {
    const key = n.link || (n.title + '|' + n.competitorKey);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(n);
  }
  return out;
}

/** 排除词过滤：标题命中任一排除词即剔除（用于区分同名端游／黄金服等） */
function filterExcluded(notes, exclude) {
  if (!exclude || !exclude.length) return notes;
  return notes.filter((n) => !exclude.some((w) => n.title.includes(w)));
}

function insertCompetitorTrends(userId, items) {
  // 只替换本轮成功的竞品。失败分类与个人搜索结果保留，避免一次限流抹掉旧数据。
  for (const key of new Set(items.map((it) => it.competitorKey)))
    store.run("DELETE FROM trend_items WHERE user_id = ? AND platform = 'xiaohongshu' AND competitor_key = ? AND source_kind IN ('competitor', 'competitor_filtered_v2')", userId, key);
  const t = dbMod.now();
  for (const it of items) {
    store.run(
      `INSERT INTO trend_items (user_id, platform, title, category, heat, link, discovered_at, is_real, source_kind, query,
         competitor_key, note_published_at, note_like_count, note_comment_count, topic_post_count, topic_summary, topic_evidence, sample_count, body_read_count)
       VALUES (?,?,?,?,?,?,?,1,?,?,?,?,?,?,?,?,?,?,?)`,
      userId, 'xiaohongshu', it.title, '', it.heat || '', it.link || '', t,
      it.sourceKind || 'competitor', it.query || '',
      it.competitorKey || '', it.notePublishedAt || null,
      it.noteLikeCount || null, it.noteCommentCount || null,
      it.topicPostCount || null, it.topicSummary || null,
      it.topicEvidence ? JSON.stringify(it.topicEvidence) : null, it.sampleCount || null, it.bodyReadCount || 0
    );
  }
}

/**
 * 小红书默认采集：竞品玩家讨论监控。
 * 每个竞品仅搜索游戏名 → 选择「最新」→ 向后补足 30 条有效游戏讨论正文 →
 * 语义归纳话题，按讨论帖数（同帖数比较可得的评论数）选 Top 3。
 */
async function collectCompetitors(userId, onlyKey = '') {
  const platform = 'xiaohongshu';
  const completedKeys = new Set(store.all(
    "SELECT DISTINCT competitor_key FROM trend_items WHERE user_id = ? AND platform = 'xiaohongshu' AND source_kind = 'competitor_filtered_v2' AND sample_count = 30",
    userId).map((row) => row.competitor_key));
  const incomplete = COMPETITORS.filter((c) => !completedKeys.has(c.key));
  const resumeIncomplete = !onlyKey && completedKeys.size > 0 && incomplete.length > 0;
  const targets = onlyKey ? COMPETITORS.filter((c) => c.key === onlyKey) : resumeIncomplete ? incomplete : COMPETITORS;
  if (!targets.length) throw new Error(`未知竞品：${onlyKey}`);
  const state = readState(userId, platform);
  const loggedIn = hasLoginCookie(state, platform);

  if (!state) {
    setConn(userId, platform, 'disconnected', '尚未连接，请先连接小红书账号。');
    return { ok: false, status: 'disconnected', reason: '尚未连接' };
  }
  if (!loggedIn) {
    setConn(userId, platform, 'expired', '登录状态已失效，请重新连接。');
    return { ok: false, status: 'expired', reason: '登录状态已失效' };
  }

  const session = sessionName(userId, platform);
  const f = stateFile(userId, platform);
  setConn(userId, platform, 'refreshing', '正在同一浏览器窗口逐个读取竞品搜索结果…');

  try {
    const failed = [];          // 单个竞品失败不终止整轮搜索
    const collected = [];

    for (const comp of targets) {
      try {
      setConn(userId, platform, 'refreshing', `正在搜索 ${comp.label}，并切换为「最新」排序…`);
      const r = await cliGotoAndExtract(session, searchUrl(platform, comp.query), COMPETITOR_EXTRACT, f, true, true, 400);
      if (!r.ok) throw new Error(`${comp.label}：${r.reason}`);
      const notes = r.data;
      if (!notes.length) throw new Error('搜索结果中没有可识别的笔记');

      let items = notes.map((x) => ({
        title: String(x.title || '').replace(/\s+/g, ' ').trim(),
        link: x.href || '',
        noteLikeCount: x.likeCount || '',
        noteCommentCount: x.commentCount || '',
        notePublishedAt: x.publishedAt || '',
        content: x.content || '',
        competitorKey: comp.key,
        competitorLabel: comp.label,
        query: comp.query,
      })).filter((x) => x.title && x.link);   // 链接校验：无有效链接的笔记丢弃

      items = dedupNotes(items);
      items = filterExcluded(items, comp.exclude);

      items = items.filter((n) => !isObviousCommercial(n));
      const valid = [];
      for (let start = 0; start < items.length && valid.length < 30; start += 25) {
        const batch = await enrichCompetitorNotes(session, items.slice(start, start + 25), comp.label, userId);
        const withBody = batch.filter((n) => n.bodyRead);
        const readable = withBody.filter((n) => !isObviousCommercial(n));
        if (!readable.length) {
          setConn(userId, platform, 'refreshing', `${comp.label}：已筛出 ${valid.length}/30 篇游戏讨论；本批正文 ${withBody.length}/${batch.length}，商业排除 ${withBody.length}。`);
          continue;
        }
        const selected = await selectGameDiscussions(comp.label, readable);
        valid.push(...selected.slice(0, 30 - valid.length));
        setConn(userId, platform, 'refreshing', `${comp.label}：已筛出 ${valid.length}/30 篇游戏讨论；本批正文 ${withBody.length}/${batch.length}，商业排除 ${withBody.length - readable.length}，内容讨论 ${selected.length}。`);
      }
      if (valid.length < 30)
        throw new Error(`已查看 ${notes.length} 条最新搜索结果，仅找到 ${valid.length} 篇有效游戏讨论帖，未达到 30 篇；商业交易帖未计入。`);
      items = valid.slice(0, 30);
      const bodyReadCount = 30;
      setConn(userId, platform, 'refreshing', `正在归纳 ${comp.label} 的 30 篇有效游戏讨论帖…`);
      const topics = await summarizeTopics(comp.label, items);
      collected.push(...topics.map((topic) => ({
        title: topic.title,
        link: topic.representative?.link || '',
        noteCommentCount: topic.commentTotal ? String(topic.commentTotal) : '',
        competitorKey: comp.key,
        competitorLabel: comp.label,
        query: comp.query,
        sourceKind: 'competitor_filtered_v2',
        topicPostCount: topic.postCount,
        topicSummary: topic.summary,
        topicEvidence: topic.evidence,
        sampleCount: items.length,
        bodyReadCount,
      })));
      } catch (e) {
        failed.push(`${comp.label}：${String(e.message || e).replace(/^.*?：/, '').slice(0, 100)}`);
        if (/访问频繁/.test(String(e.message || e))) break;
      }
    }

    // 整轮搜索完成后回写状态（平台可能在此期间轮换了 cookie）。
    await runCli(session, ['state-save', f], 60000).catch(() => {});

    const all = collected;
    if (all.length === 0) {
      throw new Error(`${targets.length} 个竞品均未完成采集：${failed.join('；') || '没有可归纳的帖子'}`);
    }

    insertCompetitorTrends(userId, all);

    const current = store.all(
      "SELECT competitor_key FROM trend_items WHERE user_id = ? AND platform = 'xiaohongshu' AND source_kind = 'competitor_filtered_v2' AND sample_count = 30",
      userId);
    const covered = new Set(current.map((n) => n.competitor_key));
    let detail = `归纳出 ${current.length} 个话题，覆盖 ${covered.size} 个竞品`;
    if (failed.length) detail += `；${failed.length} 个竞品未完成（${failed.join('；')}）`;
    detail += `。${PLATFORMS[platform].note}`;
    setConn(userId, platform, 'connected', detail);
    return { ok: true, status: 'connected', count: current.length, covered: covered.size };
  } catch (e) {
    // 失败前尽力保存状态；窗口由 finally 在本轮结束后关闭。
    await runCli(session, ['state-save', f], 60000).catch(() => {});
    // 采集失败时不清空上一次成功结果：旧数据保留在库中，前端据 discovered_at 标注「上次成功时间」。
    setConn(userId, platform, 'error', e.message);
    return { ok: false, status: 'error', reason: e.message };
  } finally {
    // 五个竞品全部处理完（或整轮失败）后才关窗口，循环中始终复用同一会话。
    await runCli(session, ['close'], 20000).catch(() => {});
  }
}

async function doCollect(platform, userId, onlyKey = '') {
  if (!PLATFORMS[platform]) throw new Error('未知平台: ' + platform);
  if (platform === 'xiaohongshu') return collectCompetitors(userId, onlyKey);
  return collectPlatform(platform, userId);
}

async function doSearch(platform, userId, keyword) {
  const cfg = PLATFORMS[platform];
  if (!cfg) throw new Error('未知平台: ' + platform);
  const kw = String(keyword || '').trim();
  if (!kw) return { ok: false, reason: '请输入搜索关键词' };
  if (!cliAvailable()) return { ok: false, reason: 'Playwright CLI 不可用，请先 npm install。' };

  const state = readState(userId, platform);
  const loggedIn = hasLoginCookie(state, platform);
  if (platform !== 'douyin' && !state) return { ok: false, reason: '尚未连接平台账号，请先连接。' };
  if (platform !== 'douyin' && !loggedIn) return { ok: false, reason: '登录状态已失效，请重新连接。' };

  const session = sessionName(userId, platform);
  try {
    const r = await cliGotoAndExtract(session, searchUrl(platform, kw), SEARCH_EXTRACT,
      loggedIn ? stateFile(userId, platform) : null, platform === 'xiaohongshu');
    if (!r.ok) return { ok: false, reason: r.reason };
    const items = r.data.slice(0, 30).map((x) => ({
      title: String(x.title || '').replace(/\s+/g, ' ').trim(),
      // 搜索发现：不是热榜排名，单独标注来源
      sourceKind: 'search',
      query: kw,
      link: x.href || fallbackLink(platform, x.title),
    })).filter((x) => x.title);
    if (items.length === 0) return { ok: false, reason: `${cfg.label}未返回可识别的搜索结果（可能需要登录或页面结构变化）。` };
    return { ok: true, items, sourceKind: 'search', sourceLabel: '搜索发现（非热榜排名）', query: kw };
  } catch (e) {
    return { ok: false, reason: '搜索失败：' + e.message };
  } finally {
    await runCli(session, ['close'], 20000).catch(() => {});
  }
}

/* ------------------------------------------------------------------ */
/* CLI 入口                                                            */
/* ------------------------------------------------------------------ */
async function main() {
  const [, , cmd, platform, userId, keyword] = process.argv;
  const resolvedUserId = normalizeUserId(userId);
  dbMod.open();
  try {
    let r;
    if (cmd === 'login') r = await doLogin(platform, resolvedUserId);
    else if (cmd === 'collect') r = await doCollect(platform, resolvedUserId, keyword || '');
    else if (cmd === 'search') r = await doSearch(platform, resolvedUserId, keyword);
    else {
      console.error('用法: node lib/hotspot.js <login|collect|search> <platform> <userId> [keyword]');
      process.exit(2);
    }
    console.log(JSON.stringify(r));
  } catch (e) {
    console.error(JSON.stringify({ ok: false, status: 'error', reason: e.message }));
    process.exit(1);
  } finally {
    dbMod.close();
  }
}

module.exports = {
  PLATFORMS,
  SECTIONS,
  COMPETITORS,
  classify,
  supplementQuery,
  doLogin,
  doConfirmLogin,
  doCollect,
  doSearch,
  readState,
  stateFile,
  sessionName,
  DOUYIN_EXTRACT,
  DOUYIN_VIDEO_EXTRACT,
  SEARCH_EXTRACT,
  COMPETITOR_EXTRACT,
  toTrendItems,
  parseNoteCount,
  parseNoteDate,
  filterRecentNotes,
  dedupNotes,
  filterExcluded,
  cliAvailable,
  AUTH_DIR,
};

if (require.main === module) main();
