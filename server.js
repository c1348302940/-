'use strict';

/**
 * 《天谕》手游营销工作台 · 单机体验版 —— 本地服务。
 * 零外部依赖（核心），数据落在 app/data/app.db（SQLite），仅监听本机 127.0.0.1。
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const dbMod = require('./lib/db');
const store = require('./lib/store');
const hotspot = require('./lib/hotspot');
const seed = require('./lib/seed');
const supabaseAuth = require('./lib/supabase');
const accountAdmin = require('./lib/account-admin');
const supabaseStore = require('./lib/supabase-store');
const { authenticatedUserId, mergeLocalHotspotState } = require('./lib/hotspot-context');

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_DIR = path.join(__dirname, 'public');
const HOTSPOT_JS = path.join(__dirname, 'lib', 'hotspot.js');

/* Supabase 模式从空白团队开始；旧 SQLite 仅供本机热点采集兼容层按需使用。 */

/* ------------------------------------------------------------------ */
/* 静态文件                                                            */
/* ------------------------------------------------------------------ */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.map': 'application/json',
};

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, urlPath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

/* ------------------------------------------------------------------ */
/* 工具                                                                */
/* ------------------------------------------------------------------ */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 5e6) { reject(new Error('body too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

function sendJSON(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

/* ------------------------------------------------------------------ */
/* 写接口防护                                                          */
/*                                                                     */
/* 本机服务同样会被浏览器里的其它网站请求到，因此不能只靠「只监听        */
/* 127.0.0.1」。两道防线：                                              */
/*  1) 校验 Origin / Referer 必须来自本服务，挡住跨站请求；             */
/*  2) 要求 Content-Type: application/json，表单能直接发出的三种简单    */
/*     类型（urlencoded / form-data / text-plain）一律拒绝，            */
/*     使跨站表单无法构造写请求。                                       */
/* ------------------------------------------------------------------ */

const ALLOWED_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

function originAllowed(req) {
  const raw = req.headers.origin || req.headers.referer;
  if (!raw) {
    // 没有 Origin/Referer：非浏览器客户端（curl、自检脚本、热点子进程）。
    // 浏览器对跨站写请求一定会带 Origin，因此这里放行不会打开 CSRF 口子。
    return true;
  }
  try {
    const u = new URL(raw);
    return ALLOWED_HOSTS.has(u.hostname) && Number(u.port || 80) === PORT;
  } catch (_) {
    return false;
  }
}

function guardWrite(req, res) {
  if (!originAllowed(req)) {
    sendJSON(res, 403, { ok: false, error: '请求来源不被允许（跨站请求已拒绝）' });
    return false;
  }
  const ct = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (ct !== 'application/json') {
    sendJSON(res, 415, { ok: false, error: '写接口只接受 application/json' });
    return false;
  }
  return true;
}

/* 一次性确认令牌：重置这类破坏性操作必须在应用内显式确认后才拿得到 */
const resetTokens = new Map();
const RESET_TOKEN_TTL_MS = 2 * 60 * 1000;

function issueResetToken() {
  const token = crypto.randomBytes(24).toString('hex');
  const now = Date.now();
  for (const [k, v] of resetTokens) if (v < now) resetTokens.delete(k);
  resetTokens.set(token, now + RESET_TOKEN_TTL_MS);
  return token;
}

function consumeResetToken(token) {
  const exp = resetTokens.get(String(token || ''));
  if (!exp) return false;
  resetTokens.delete(String(token)); // 一次性
  return exp > Date.now();
}

/* 后台运行 Playwright 子进程；同一账号同一平台一次只执行一轮采集。 */
const collecting = new Set();
function hotspotKey(platform, userId) { return `${userId}:${platform}`; }

async function workbenchState(auth, cloudState = null) {
  const userId = authenticatedUserId(auth);
  const state = cloudState || await supabaseStore.getState(auth);
  return mergeLocalHotspotState(state, store.getState(userId));
}

function spawnHotspot(cmd, platform, userId, keyword) {
  const key = hotspotKey(platform, userId);
  if (cmd === 'collect') {
    if (collecting.has(key)) return null;
    collecting.add(key);
  }
  const args = [HOTSPOT_JS, cmd, platform, String(userId)];
  if (keyword) args.push(keyword);
  const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let out = '';
  child.stdout.on('data', (d) => { out += d.toString(); });
  child.stderr.on('data', (d) => { out += d.toString(); });
  child.on('error', (e) => {
    collecting.delete(key);
    console.error('[hotspot] spawn error:', e.message);
    store.apply('set_connection_status', {
      userId, platform, statePath: hotspot.stateFile(userId, platform),
      status: 'error', statusDetail: '无法启动浏览器任务：' + e.message,
    }, userId);
  });
  child.on('close', (code) => {
    collecting.delete(key);
    if (code !== 0) {
      const current = store.getState(userId).connections.find((c) => c.platform === platform);
      if (current?.status === 'connecting' || current?.status === 'refreshing') {
        store.apply('set_connection_status', {
          userId, platform, statePath: hotspot.stateFile(userId, platform),
          status: 'error', statusDetail: '浏览器任务异常结束，请重新连接后重试。',
        }, userId);
      }
    }
    if (out.trim()) console.log(`[hotspot ${cmd} ${platform}] (exit ${code}) ${out.trim().slice(0, 500)}`);
  });
  return child;
}

/* ------------------------------------------------------------------ */
/* 路由                                                                */
/* ------------------------------------------------------------------ */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  try {
    /* ---- API ---- */
    if (url.pathname === '/api/bootstrap/status' && req.method === 'GET') {
      sendJSON(res, 200, await accountAdmin.bootstrapStatus());
      return;
    }

    if (url.pathname === '/api/bootstrap' && req.method === 'POST') {
      if (!guardWrite(req, res)) return;
      const body = await readBody(req);
      sendJSON(res, 201, await accountAdmin.bootstrapFirstAdmin(body));
      return;
    }

    if (url.pathname === '/api/auth/login' && req.method === 'POST') {
      if (!guardWrite(req, res)) return;
      const body = await readBody(req);
      const email = supabaseAuth.usernameToInternalEmail(body.username);
      const { data, error } = await supabaseAuth.getPublicClient().auth.signInWithPassword({
        email,
        password: String(body.password || ''),
      });
      if (error || !data.session) {
        sendJSON(res, 401, { ok: false, error: '用户名或密码不正确' });
        return;
      }
      const auth = await supabaseAuth.createAuthBoundary().requireUser({
        headers: { authorization: `Bearer ${data.session.access_token}` },
      });
      sendJSON(res, 200, {
        ok: true,
        session: {
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
          expires_at: data.session.expires_at,
        },
        profile: auth.profile,
      });
      return;
    }

    if (url.pathname === '/api/auth/refresh' && req.method === 'POST') {
      if (!guardWrite(req, res)) return;
      const body = await readBody(req);
      const { data, error } = await supabaseAuth.getPublicClient().auth.refreshSession({
        refresh_token: String(body.refresh_token || ''),
      });
      if (error || !data.session) {
        sendJSON(res, 401, { ok: false, error: '登录状态已失效，请重新登录' });
        return;
      }
      sendJSON(res, 200, {
        ok: true,
        session: {
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
          expires_at: data.session.expires_at,
        },
      });
      return;
    }

    if (url.pathname === '/api/auth/me' && req.method === 'GET') {
      const auth = await supabaseAuth.requireUser(req);
      sendJSON(res, 200, { ok: true, profile: auth.profile });
      return;
    }

    if (url.pathname === '/api/accounts' && req.method === 'GET') {
      const auth = await supabaseAuth.requireAdmin(req);
      sendJSON(res, 200, { ok: true, accounts: await accountAdmin.listAccounts(auth.profile.team_id) });
      return;
    }

    if (url.pathname === '/api/accounts' && req.method === 'POST') {
      if (!guardWrite(req, res)) return;
      const auth = await supabaseAuth.requireAdmin(req);
      const body = await readBody(req);
      sendJSON(res, 201, await accountAdmin.createAccount(auth.profile, body));
      return;
    }

    const accountPasswordMatch = url.pathname.match(/^\/api\/accounts\/([^/]+)\/password$/);
    if (accountPasswordMatch && req.method === 'POST') {
      if (!guardWrite(req, res)) return;
      const auth = await supabaseAuth.requireAdmin(req);
      const body = await readBody(req);
      sendJSON(res, 200, await accountAdmin.resetPassword(auth.profile, accountPasswordMatch[1], body.password));
      return;
    }

    const accountActiveMatch = url.pathname.match(/^\/api\/accounts\/([^/]+)\/active$/);
    if (accountActiveMatch && req.method === 'POST') {
      if (!guardWrite(req, res)) return;
      const auth = await supabaseAuth.requireAdmin(req);
      const body = await readBody(req);
      sendJSON(res, 200, await accountAdmin.setAccountActive(auth.profile, accountActiveMatch[1], !!body.active));
      return;
    }

    if (url.pathname === '/api/state') {
      const auth = await supabaseAuth.requireUser(req);
      sendJSON(res, 200, await workbenchState(auth));
      return;
    }

    if (url.pathname === '/api/mutate' && req.method === 'POST') {
      if (!guardWrite(req, res)) return;
      const auth = await supabaseAuth.requireUser(req);
      const body = await readBody(req);
      const state = await supabaseStore.apply(body.action, body.payload || {}, auth);
      sendJSON(res, 200, await workbenchState(auth, state));
      return;
    }

    if (url.pathname === '/api/hotspot/login' && req.method === 'POST') {
      if (!guardWrite(req, res)) return;
      const auth = await supabaseAuth.requireUser(req);
      const body = await readBody(req);
      const platform = body.platform;
      const userId = authenticatedUserId(auth);
      if (collecting.has(hotspotKey(platform, userId))) {
        sendJSON(res, 409, { ok: false, error: '竞品搜索正在进行，请等待本轮结束。' });
        return;
      }
      const existing = store.getState(userId).connections.find((c) => c.platform === platform);
      if (existing?.status === 'connecting') {
        sendJSON(res, 409, { ok: false, error: '登录窗口已经打开，请完成登录并点击确认。' });
        return;
      }
      // 先写入状态，再启动登录进程；前端收到响应后不会短暂看到旧的
      // “已连接”状态而自动开启另一个采集窗口。
      store.apply('set_connection_status', {
        userId, platform, status: 'connecting',
        statePath: hotspot.stateFile(userId, platform),
        statusDetail: '正在打开平台官方页面。请完成登录，再点击「我已登录，开始搜索」。',
      }, userId);
      spawnHotspot('login', platform, userId);
      sendJSON(res, 200, { ok: true, status: 'connecting', message: '已打开独立浏览器窗口，请在弹出的窗口完成登录。' });
      return;
    }

    if (url.pathname === '/api/hotspot/confirm-login' && req.method === 'POST') {
      if (!guardWrite(req, res)) return;
      const auth = await supabaseAuth.requireUser(req);
      const body = await readBody(req);
      const platform = body.platform;
      const userId = authenticatedUserId(auth);
      const key = hotspotKey(platform, userId);
      if (collecting.has(key)) {
        sendJSON(res, 409, { ok: false, error: '本轮搜索已在进行，请等待完成。' });
        return;
      }
      const conn = store.getState(userId).connections.find((c) => c.platform === platform);
      if (conn?.status !== 'connecting') {
        sendJSON(res, 409, { ok: false, error: '当前没有等待确认的登录窗口。' });
        return;
      }
      const checked = await hotspot.doConfirmLogin(platform, userId);
      if (!checked.ok) {
        sendJSON(res, 409, { ok: false, error: checked.reason });
        return;
      }
      store.apply('set_connection_status', {
        userId, platform, status: 'refreshing',
        statePath: hotspot.stateFile(userId, platform),
        statusDetail: platform === 'xiaohongshu' ? '已确认登录，正在同一窗口搜索五个竞品…' : '已确认登录，正在读取热榜…',
      }, userId);
      spawnHotspot('collect', platform, userId);
      sendJSON(res, 200, { ok: true, status: 'refreshing' });
      return;
    }

    if (url.pathname === '/api/hotspot/collect' && req.method === 'POST') {
      if (!guardWrite(req, res)) return;
      const auth = await supabaseAuth.requireUser(req);
      const body = await readBody(req);
      const platform = body.platform;
      const userId = authenticatedUserId(auth);
      if (collecting.has(hotspotKey(platform, userId))) {
        sendJSON(res, 409, { ok: false, error: '本轮搜索仍在进行。' });
        return;
      }
      const conn = store.getState(userId).connections.find((c) => c.platform === platform);
      if (platform === 'xiaohongshu' && conn?.status === 'connecting') {
        sendJSON(res, 409, { ok: false, error: '请先在登录窗口完成登录并点击「我已登录，开始搜索」。' });
        return;
      }
      spawnHotspot('collect', platform, userId);
      sendJSON(res, 200, { ok: true, status: 'refreshing', message: '正在采集平台内容…' });
      return;
    }

    if (url.pathname === '/api/hotspot/search' && req.method === 'POST') {
      if (!guardWrite(req, res)) return;
      const auth = await supabaseAuth.requireUser(req);
      const body = await readBody(req);
      const userId = authenticatedUserId(auth);
      const conn = store.getState(userId).connections.find((c) => c.platform === body.platform);
      if (body.platform === 'xiaohongshu' && (conn?.status === 'connecting' || conn?.status === 'refreshing' || collecting.has(hotspotKey(body.platform, userId)))) {
        sendJSON(res, 409, { ok: false, error: '请等待登录确认或本轮竞品搜索结束后再自由搜索。' });
        return;
      }
      const r = await hotspot.doSearch(body.platform, userId, body.keyword);
      sendJSON(res, 200, r);
      return;
    }

    if (url.pathname === '/api/hotspot/disconnect' && req.method === 'POST') {
      if (!guardWrite(req, res)) return;
      const auth = await supabaseAuth.requireUser(req);
      const body = await readBody(req);
      const userId = authenticatedUserId(auth);
      store.apply('clear_connection', { userId, platform: body.platform }, userId);
      sendJSON(res, 200, await workbenchState(auth));
      return;
    }

    /* 重置确认令牌：在应用内点击「重置」时先取令牌，再带令牌提交 */
    if (url.pathname === '/api/demo/reset-token' && req.method === 'POST') {
      if (!guardWrite(req, res)) return;
      await readBody(req);
      sendJSON(res, 200, { ok: true, token: issueResetToken(), expiresInMs: RESET_TOKEN_TTL_MS });
      return;
    }

    /* 重置为初始示例数据（单机体验版用；会清空本机业务数据）
       必须携带一次性确认令牌，防止被跨站请求或误触直接清库。 */
    if (url.pathname === '/api/demo/reset' && req.method === 'POST') {
      if (!guardWrite(req, res)) return;
      const body = await readBody(req);
      if (!consumeResetToken(body.token)) {
        sendJSON(res, 403, { ok: false, error: '重置确认令牌无效或已过期，请在界面中重新确认' });
        return;
      }
      console.log('[demo] 已按应用内确认重置为初始示例数据');
      seed.runSeed({ reset: true });
      sendJSON(res, 200, store.getState(Number(body.user || url.searchParams.get('user') || 2)));
      return;
    }

    /* 撤回／删除排期前的影响预览：会移除几项、会为成员保留几项历史任务 */
    if (url.pathname === '/api/schedule-impact') {
      const auth = await supabaseAuth.requireAdmin(req);
      const id = url.searchParams.get('id');
      if (!id) { sendJSON(res, 400, { ok: false, error: '缺少排期 id' }); return; }
      sendJSON(res, 200, { ok: true, ...await supabaseStore.scheduleImpact(auth, id) });
      return;
    }

    if (url.pathname === '/api/health') {
      sendJSON(res, 200, { ok: true, time: dbMod.now() });
      return;
    }

    /* ---- 静态 ---- */
    if (req.method === 'GET') {
      serveStatic(req, res);
      return;
    }

    sendJSON(res, 404, { ok: false, error: 'Not Found' });
  } catch (e) {
    console.error('[server]', e);
    sendJSON(res, e.statusCode || 500, { ok: false, error: e.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('======================================================');
  console.log('  《天谕》手游营销工作台 · Supabase MVP');
  console.log(`  已启动：http://${HOST}:${PORT}`);
  console.log('  业务数据：Supabase（本地服务仅监听 127.0.0.1）');
  console.log('  按 Ctrl+C 停止服务。');
  console.log('======================================================');
  console.log('');
});

function shutdown() {
  dbMod.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
