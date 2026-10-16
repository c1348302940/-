'use strict';

const {
  getAdminClient,
  normalizeUsername,
  usernameToInternalEmail,
  httpError,
} = require('./supabase');

let bootstrapInFlight = false;

function cleanText(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function validatePassword(value) {
  const password = String(value || '');
  if (password.length < 8) throw httpError(400, '密码至少需要 8 位');
  if (password.length > 72) throw httpError(400, '密码不能超过 72 位');
  return password;
}

async function profileCount(client = getAdminClient()) {
  const { count, error } = await client.from('profiles').select('id', { count: 'exact', head: true });
  if (error) throw error;
  return count || 0;
}

async function bootstrapStatus(client = getAdminClient()) {
  return { needsBootstrap: (await profileCount(client)) === 0 };
}

async function bootstrapFirstAdmin(input, client = getAdminClient()) {
  if (bootstrapInFlight) throw httpError(409, '初始化正在进行，请稍候');
  bootstrapInFlight = true;
  let authUserId = null;
  let teamId = null;
  try {
    if ((await profileCount(client)) !== 0) throw httpError(409, '团队已经初始化');
    const username = normalizeUsername(input.username);
    const password = validatePassword(input.password);
    const name = cleanText(input.name);
    if (!name) throw httpError(400, '请填写显示姓名');

    const { data: authData, error: authError } = await client.auth.admin.createUser({
      email: usernameToInternalEmail(username),
      password,
      email_confirm: true,
      user_metadata: { username, name },
    });
    if (authError) throw authError;
    authUserId = authData.user.id;

    const { data: team, error: teamError } = await client
      .from('teams')
      .insert({ name: '天谕手游营销团队' })
      .select('id')
      .single();
    if (teamError) throw teamError;
    teamId = team.id;

    const profile = {
      id: authUserId,
      team_id: teamId,
      username,
      name,
      role: 'admin',
      title: cleanText(input.title, '主营销'),
      color: cleanText(input.color, '#18181b'),
      sort: 0,
      is_active: true,
    };
    const { error: profileError } = await client.from('profiles').insert(profile);
    if (profileError) throw profileError;
    return { ok: true, username };
  } catch (error) {
    if (teamId) await client.from('teams').delete().eq('id', teamId);
    if (authUserId) await client.auth.admin.deleteUser(authUserId);
    throw error;
  } finally {
    bootstrapInFlight = false;
  }
}

async function listAccounts(teamId, client = getAdminClient()) {
  const { data, error } = await client
    .from('profiles')
    .select('id,username,name,role,title,color,sort,is_active,created_at,updated_at')
    .eq('team_id', teamId)
    .order('sort')
    .order('created_at');
  if (error) throw error;
  return data || [];
}

async function createAccount(adminProfile, input, client = getAdminClient()) {
  const username = normalizeUsername(input.username);
  const password = validatePassword(input.password);
  const name = cleanText(input.name);
  if (!name) throw httpError(400, '请填写显示姓名');

  const { data: duplicate, error: duplicateError } = await client
    .from('profiles')
    .select('id')
    .eq('username', username)
    .maybeSingle();
  if (duplicateError) throw duplicateError;
  if (duplicate) throw httpError(409, '该用户名已被使用');

  let authUserId = null;
  try {
    const { data: authData, error: authError } = await client.auth.admin.createUser({
      email: usernameToInternalEmail(username),
      password,
      email_confirm: true,
      user_metadata: { username, name },
    });
    if (authError) throw authError;
    authUserId = authData.user.id;

    const profile = {
      id: authUserId,
      team_id: adminProfile.team_id,
      username,
      name,
      role: input.role === 'admin' ? 'admin' : 'member',
      title: cleanText(input.title),
      color: cleanText(input.color, '#6a7ae0'),
      sort: Number.isInteger(input.sort) ? input.sort : 0,
      is_active: true,
    };
    const { error: profileError } = await client.from('profiles').insert(profile);
    if (profileError) throw profileError;
    return { ok: true, id: authUserId, username };
  } catch (error) {
    if (authUserId) await client.auth.admin.deleteUser(authUserId);
    throw error;
  }
}

async function resetPassword(adminProfile, userId, password, client = getAdminClient()) {
  validatePassword(password);
  const { data: target, error: targetError } = await client
    .from('profiles')
    .select('id,team_id')
    .eq('id', userId)
    .eq('team_id', adminProfile.team_id)
    .maybeSingle();
  if (targetError) throw targetError;
  if (!target) throw httpError(404, '账号不存在');
  const { error } = await client.auth.admin.updateUserById(userId, { password });
  if (error) throw error;
  return { ok: true };
}

async function setAccountActive(adminProfile, userId, active, client = getAdminClient()) {
  if (userId === adminProfile.id && !active) throw httpError(400, '不能停用当前登录的主营账号');
  const { data: target, error: targetError } = await client
    .from('profiles')
    .select('id,team_id')
    .eq('id', userId)
    .eq('team_id', adminProfile.team_id)
    .maybeSingle();
  if (targetError) throw targetError;
  if (!target) throw httpError(404, '账号不存在');

  const { error: profileError } = await client
    .from('profiles')
    .update({ is_active: !!active })
    .eq('id', userId);
  if (profileError) throw profileError;

  const { error: authError } = await client.auth.admin.updateUserById(userId, {
    ban_duration: active ? 'none' : '876000h',
  });
  if (authError) {
    await client.from('profiles').update({ is_active: !active }).eq('id', userId);
    throw authError;
  }
  return { ok: true, active: !!active };
}

module.exports = {
  validatePassword,
  profileCount,
  bootstrapStatus,
  bootstrapFirstAdmin,
  listAccounts,
  createAccount,
  resetPassword,
  setAccountActive,
};
