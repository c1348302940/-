import { esc, ICON, toast } from '../util.js';
import { openModal, closeModal, confirmModal, field, selectOptions } from '../ui.js';
import { authFetch } from '../auth.js';
import { render as renderApp } from '../shell.js';

let accounts = null;
let loading = false;

async function request(url, options = {}) {
  const response = await authFetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error(data.error || '操作失败');
  return data;
}

async function reload() {
  loading = true;
  try {
    const data = await request('/api/accounts');
    accounts = data.accounts || [];
  } finally {
    loading = false;
  }
}

export function render() {
  const list = accounts || [];
  return `<div class="card">
    <div class="card-head">
      ${ICON.user}<h3>账号管理</h3><span class="spacer"></span>
      <button class="btn sm ghost" data-act="new-account">${ICON.plus} 添加成员账号</button>
    </div>
    ${loading || accounts === null
      ? '<div class="card-body" style="color:var(--text-3)">正在读取账号…</div>'
      : list.length === 0
        ? '<div class="card-body" style="color:var(--text-3)">暂无账号</div>'
        : `<div>${list.map((account) => `<div class="pub-item">
            <span class="avatar" style="background:${esc(account.color || '#6a7ae0')};width:30px;height:30px">${esc((account.name || '?').slice(0, 1))}</span>
            <div style="flex:1;min-width:0">
              <div class="p-title">${esc(account.name)} <span class="pill ${account.role === 'admin' ? 'blue' : 'gray'}">${account.role === 'admin' ? '主营销' : '成员'}</span></div>
              <div class="p-meta">用户名：${esc(account.username)}${account.title ? ` · ${esc(account.title)}` : ''}</div>
            </div>
            <span class="pill ${account.is_active ? 'green' : 'gray'}">${account.is_active ? '启用中' : '已停用'}</span>
            <button class="btn sm ghost" data-act="reset-account-password" data-id="${account.id}" data-name="${esc(account.name)}">重置密码</button>
            <button class="btn sm ${account.is_active ? 'danger' : ''}" data-act="toggle-account-active" data-id="${account.id}" data-active="${account.is_active ? '0' : '1'}" data-name="${esc(account.name)}">${account.is_active ? '停用' : '恢复'}</button>
          </div>`).join('')}</div>`}
  </div>`;
}

export async function afterRender() {
  if (accounts !== null || loading) return;
  try {
    await reload();
    renderApp();
  } catch (error) {
    accounts = [];
    toast(error.message, 'err');
    renderApp();
  }
}

function passwordFields() {
  return `${field('初始密码', '<input name="password" type="password" autocomplete="new-password" minlength="8" maxlength="72" required placeholder="至少 8 位">')}
    ${field('再次输入密码', '<input name="password2" type="password" autocomplete="new-password" minlength="8" maxlength="72" required>')}`;
}

function validatePasswords(root) {
  const password = root.querySelector('[name="password"]').value;
  const password2 = root.querySelector('[name="password2"]').value;
  if (password.length < 8) throw new Error('密码至少需要 8 位');
  if (password !== password2) throw new Error('两次输入的密码不一致');
  return password;
}

export const actions = {
  'new-account'() {
    openModal({
      title: '添加成员账号',
      body: `<div class="form-grid">
        ${field('显示姓名', '<input name="name" maxlength="40" required>')}
        ${field('登录用户名', '<input name="username" maxlength="32" required placeholder="英文、数字、点、下划线或短横线">')}
        ${field('岗位', '<input name="title" maxlength="40" placeholder="例如 内容策划">')}
        ${field('账号角色', `<select name="role">${selectOptions([{ value: 'member', label: '成员' }, { value: 'admin', label: '主营销' }], 'member')}</select>`)}
        ${passwordFields()}
      </div>`,
      footer: '<button class="btn" data-act="close-modal">取消</button><button class="btn primary" data-save-account>创建账号</button>',
      onMount(root) {
        root.querySelector('[data-save-account]').addEventListener('click', async () => {
          try {
            const password = validatePasswords(root);
            const value = (name) => root.querySelector(`[name="${name}"]`).value.trim();
            await request('/api/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name: value('name'), username: value('username'), title: value('title'),
                role: value('role'), password }) });
            accounts = null;
            closeModal();
            toast('账号已创建', 'ok');
            renderApp();
          } catch (error) { toast(error.message, 'err'); }
        });
      },
    });
  },

  'reset-account-password'(button) {
    openModal({
      title: `重置 ${button.dataset.name} 的密码`,
      body: `<div class="form-grid">${passwordFields()}</div>`,
      footer: '<button class="btn" data-act="close-modal">取消</button><button class="btn primary" data-reset-password>保存新密码</button>',
      onMount(root) {
        root.querySelector('[data-reset-password]').addEventListener('click', async () => {
          try {
            const password = validatePasswords(root);
            await request(`/api/accounts/${button.dataset.id}/password`, { method: 'POST',
              headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
            closeModal();
            toast('密码已重置', 'ok');
          } catch (error) { toast(error.message, 'err'); }
        });
      },
    });
  },

  'toggle-account-active'(button) {
    const active = button.dataset.active === '1';
    const verb = active ? '恢复' : '停用';
    confirmModal(`${verb}账号`, `${verb}「${esc(button.dataset.name)}」的账号？${active ? '恢复后可重新登录。' : '停用后将立即无法继续使用工作台，历史任务仍会保留。'}`, async () => {
      try {
        await request(`/api/accounts/${button.dataset.id}/active`, { method: 'POST',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active }) });
        accounts = null;
        toast(`账号已${verb}`, 'ok');
        renderApp();
      } catch (error) { toast(error.message, 'err'); }
    }, verb);
  },
};
