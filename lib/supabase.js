'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createClient } = require('@supabase/supabase-js');

const INTERNAL_EMAIL_DOMAIN = 'users.tianyu.invalid';

function loadLocalEnv() {
  const file = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(file)) return;
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const at = line.indexOf('=');
    if (at < 1) continue;
    const key = line.slice(0, at).trim();
    let value = line.slice(at + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadLocalEnv();

function normalizeUsername(value) {
  const username = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username)) {
    throw new Error('用户名须为 3–32 位英文字母、数字、点、下划线或短横线');
  }
  return username;
}

function usernameToInternalEmail(value) {
  return `${normalizeUsername(value)}@${INTERNAL_EMAIL_DOMAIN}`;
}

function browserConfig() {
  const url = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) throw new Error('缺少 SUPABASE_URL 或 SUPABASE_PUBLISHABLE_KEY');
  return { url, publishableKey };
}

function serverConfig() {
  const { url, publishableKey } = browserConfig();
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!secretKey) throw new Error('缺少 SUPABASE_SECRET_KEY');
  return { url, publishableKey, secretKey };
}

let publicClient;
let adminClient;

function getPublicClient() {
  if (!publicClient) {
    const { url, publishableKey } = browserConfig();
    publicClient = createClient(url, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }
  return publicClient;
}

function getAdminClient() {
  if (!adminClient) {
    const { url, secretKey } = serverConfig();
    adminClient = createClient(url, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }
  return adminClient;
}

function userClientForToken(token) {
  const { url, publishableKey } = browserConfig();
  return createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

function bearerToken(req) {
  const value = String(req?.headers?.authorization || '');
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function createAuthBoundary(deps = {}) {
  const makeClient = deps.userClientForToken || userClientForToken;

  async function requireUser(req) {
    const token = bearerToken(req);
    if (!token) throw httpError(401, '请先登录');

    const client = makeClient(token);
    const { data: userData, error: userError } = await client.auth.getUser(token);
    if (userError || !userData?.user) throw httpError(401, '登录状态已失效，请重新登录');

    const { data: profile, error: profileError } = await client
      .from('profiles')
      .select('*')
      .eq('id', userData.user.id)
      .maybeSingle();
    if (profileError || !profile) throw httpError(403, '账号资料不存在或已停用');
    if (!profile.is_active) throw httpError(403, '账号已停用，请联系主营销');

    return { token, user: userData.user, profile, client };
  }

  async function requireAdmin(req) {
    const auth = await requireUser(req);
    if (auth.profile.role !== 'admin') throw httpError(403, '仅主营销可以执行此操作');
    return auth;
  }

  return { requireUser, requireAdmin };
}

const authBoundary = createAuthBoundary();

module.exports = {
  INTERNAL_EMAIL_DOMAIN,
  normalizeUsername,
  usernameToInternalEmail,
  browserConfig,
  serverConfig,
  getPublicClient,
  getAdminClient,
  userClientForToken,
  bearerToken,
  httpError,
  createAuthBoundary,
  requireUser: authBoundary.requireUser,
  requireAdmin: authBoundary.requireAdmin,
};
