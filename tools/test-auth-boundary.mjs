import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  normalizeUsername,
  usernameToInternalEmail,
  bearerToken,
  createAuthBoundary,
} = require('../lib/supabase.js');

assert.equal(normalizeUsername('  Alice.Team  '), 'alice.team');
assert.equal(usernameToInternalEmail('Alice.Team'), 'alice.team@users.tianyu.invalid');
assert.throws(() => normalizeUsername('张三'), /用户名/);
assert.throws(() => normalizeUsername('ab'), /用户名/);
assert.throws(() => normalizeUsername('a b c'), /用户名/);

assert.equal(bearerToken({ headers: { authorization: 'Bearer abc.def' } }), 'abc.def');
assert.equal(bearerToken({ headers: {} }), null);

function mockClient({ authUser = { id: 'user-1' }, profile = { id: 'user-1', role: 'member', is_active: true } } = {}) {
  return {
    auth: {
      async getUser(token) {
        if (token !== 'valid-token') return { data: { user: null }, error: new Error('bad token') };
        return { data: { user: authUser }, error: null };
      },
    },
    from(table) {
      assert.equal(table, 'profiles');
      return {
        select() { return this; },
        eq() { return this; },
        async maybeSingle() { return { data: profile, error: null }; },
      };
    },
  };
}

const boundary = createAuthBoundary({
  userClientForToken: () => mockClient(),
});

await assert.rejects(() => boundary.requireUser({ headers: {} }), (e) => e.statusCode === 401);
await assert.rejects(
  () => boundary.requireUser({ headers: { authorization: 'Bearer forged' } }),
  (e) => e.statusCode === 401,
);

const authenticated = await boundary.requireUser({
  headers: { authorization: 'Bearer valid-token' },
  body: { user: 'forged-user' },
});
assert.equal(authenticated.profile.id, 'user-1', 'identity must come from the verified JWT');

const inactiveBoundary = createAuthBoundary({
  userClientForToken: () => mockClient({ profile: { id: 'user-1', role: 'member', is_active: false } }),
});
await assert.rejects(
  () => inactiveBoundary.requireUser({ headers: { authorization: 'Bearer valid-token' } }),
  (e) => e.statusCode === 403,
);

await assert.rejects(
  () => boundary.requireAdmin({ headers: { authorization: 'Bearer valid-token' } }),
  (e) => e.statusCode === 403,
);

const adminBoundary = createAuthBoundary({
  userClientForToken: () => mockClient({ profile: { id: 'user-1', role: 'admin', is_active: true } }),
});
assert.equal(
  (await adminBoundary.requireAdmin({ headers: { authorization: 'Bearer valid-token' } })).profile.role,
  'admin',
);

console.log('auth boundary passed');
