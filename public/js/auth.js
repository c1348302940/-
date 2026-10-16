const SESSION_KEY = 'tianyu-workbench-session';

let session = null;

function readSession() {
  try {
    const value = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    if (value?.access_token && value?.refresh_token) return value;
  } catch (_) { /* ignore invalid local data */ }
  return null;
}

function saveSession(value) {
  session = value || null;
  if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else localStorage.removeItem(SESSION_KEY);
}

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    const error = new Error(data.error || '请求失败');
    error.status = response.status;
    throw error;
  }
  return data;
}

async function refreshSession() {
  if (!session?.refresh_token) return null;
  try {
    const data = await jsonRequest('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: session.refresh_token }),
    });
    saveSession(data.session);
    return session;
  } catch (error) {
    saveSession(null);
    return null;
  }
}

export async function accessToken() {
  if (!session) session = readSession();
  if (!session) return null;
  const expiresAtMs = Number(session.expires_at || 0) * 1000;
  if (!expiresAtMs || expiresAtMs - Date.now() < 60_000) await refreshSession();
  return session?.access_token || null;
}

export async function authFetch(url, options = {}) {
  const token = await accessToken();
  if (!token) {
    const error = new Error('请先登录');
    error.status = 401;
    throw error;
  }
  const headers = new Headers(options.headers || {});
  headers.set('Authorization', `Bearer ${token}`);
  let response = await fetch(url, { ...options, headers });
  if (response.status === 401 && await refreshSession()) {
    headers.set('Authorization', `Bearer ${session.access_token}`);
    response = await fetch(url, { ...options, headers });
  }
  if (response.status === 401 || response.status === 403) {
    saveSession(null);
  }
  return response;
}

export async function bootstrapStatus() {
  return jsonRequest('/api/bootstrap/status');
}

export async function bootstrapAdmin(values) {
  return jsonRequest('/api/bootstrap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(values),
  });
}

export async function signIn(username, password) {
  const data = await jsonRequest('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  saveSession(data.session);
  return data.profile;
}

export async function currentProfile() {
  if (!await accessToken()) return null;
  try {
    const response = await authFetch('/api/auth/me');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '登录状态已失效');
    return data.profile;
  } catch (_) {
    saveSession(null);
    return null;
  }
}

export function signOut() {
  saveSession(null);
}
