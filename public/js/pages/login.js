import { bootstrapAdmin, signIn } from '../auth.js';

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}

function shell(title, subtitle, body) {
  return `<main class="auth-page">
    <section class="auth-card">
      <div class="auth-brand"><span class="brand-logo">T</span><span>天谕手游团队</span></div>
      <div class="auth-heading"><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div>
      ${body}
    </section>
  </main>`;
}

function setError(form, message) {
  const box = form.querySelector('[data-auth-error]');
  box.textContent = message || '';
  box.hidden = !message;
}

function setBusy(form, busy, text) {
  const button = form.querySelector('button[type="submit"]');
  button.disabled = busy;
  button.textContent = busy ? text : button.dataset.idle;
}

export function renderLogin(onSuccess) {
  const app = document.getElementById('app');
  app.className = 'app auth-app';
  app.innerHTML = shell('登录营销工作台', '使用主营销分配的用户名和密码', `
    <form class="auth-form" data-auth-form="login">
      <label>用户名<input name="username" autocomplete="username" required maxlength="32" placeholder="例如 chenmi"></label>
      <label>密码<input name="password" type="password" autocomplete="current-password" required placeholder="请输入密码"></label>
      <div class="auth-error" data-auth-error hidden></div>
      <button class="btn primary auth-submit" type="submit" data-idle="登录">登录</button>
    </form>`);

  const form = app.querySelector('form');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setError(form, '');
    setBusy(form, true, '登录中…');
    try {
      const values = new FormData(form);
      const profile = await signIn(values.get('username'), values.get('password'));
      await onSuccess(profile);
    } catch (error) {
      setError(form, error.message);
      setBusy(form, false, '');
    }
  });
}

export function renderSetup(onCreated) {
  const app = document.getElementById('app');
  app.className = 'app auth-app';
  app.innerHTML = shell('创建第一个主营账号', '团队数据将从空白工作台开始', `
    <form class="auth-form" data-auth-form="setup">
      <label>显示姓名<input name="name" required maxlength="40" placeholder="工作台中展示的姓名"></label>
      <label>登录用户名<input name="username" autocomplete="username" required maxlength="32" placeholder="3–32 位英文、数字、点、下划线或短横线"></label>
      <label>岗位<input name="title" maxlength="40" value="主营销"></label>
      <label>初始密码<input name="password" type="password" autocomplete="new-password" required minlength="8" maxlength="72" placeholder="至少 8 位"></label>
      <label>再次输入密码<input name="password2" type="password" autocomplete="new-password" required minlength="8" maxlength="72"></label>
      <div class="auth-error" data-auth-error hidden></div>
      <button class="btn primary auth-submit" type="submit" data-idle="创建主营账号">创建主营账号</button>
    </form>`);

  const form = app.querySelector('form');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setError(form, '');
    const values = Object.fromEntries(new FormData(form));
    if (values.password !== values.password2) {
      setError(form, '两次输入的密码不一致');
      return;
    }
    setBusy(form, true, '创建中…');
    try {
      await bootstrapAdmin(values);
      await onCreated(values.username);
    } catch (error) {
      setError(form, error.message);
      setBusy(form, false, '');
    }
  });
}
