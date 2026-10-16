import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const port = 18787;
const appOrigin = 'https://yingxiaogongzuotai-rkp9.vercel.app';
const child = spawn(process.execPath, ['server.js'], {
  cwd: new URL('..', import.meta.url),
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let output = '';
child.stdout.on('data', (chunk) => { output += chunk; });
child.stderr.on('data', (chunk) => { output += chunk; });

async function waitUntilReady() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) return;
    } catch (_) {
      // Server is still starting.
    }
    await delay(100);
  }
  throw new Error(`测试服务未能启动：\n${output}`);
}

try {
  await waitUntilReady();

  const sameOrigin = await fetch(`http://127.0.0.1:${port}/api/demo/reset-token`, {
    method: 'POST',
    headers: {
      origin: appOrigin,
      host: '127.0.0.1:18787',
      'x-forwarded-host': 'yingxiaogongzuotai-rkp9.vercel.app',
      'x-forwarded-proto': 'https',
      'content-type': 'application/json',
    },
    body: '{}',
  });
  assert.equal(sameOrigin.status, 200, 'Vercel 代理后的同源写请求应被允许');

  const crossOrigin = await fetch(`http://127.0.0.1:${port}/api/demo/reset-token`, {
    method: 'POST',
    headers: {
      origin: 'https://attacker.example',
      host: '127.0.0.1:18787',
      'x-forwarded-host': 'yingxiaogongzuotai-rkp9.vercel.app',
      'x-forwarded-proto': 'https',
      'content-type': 'application/json',
    },
    body: '{}',
  });
  assert.equal(crossOrigin.status, 403, '真正的跨站写请求仍应被拒绝');

  console.log('PASS Vercel 同源请求放行，跨站请求拒绝');
} finally {
  child.kill('SIGTERM');
}
