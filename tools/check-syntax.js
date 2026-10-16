'use strict';

/**
 * 前端 ES Module 语法检查。
 * node --check 默认按 CommonJS 解析，无法检查含 import 的模块，
 * 这里把每个模块复制成临时 .mjs 再检查。
 *
 * 用法：node tools/check-syntax.js
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const TARGETS = [
  'public/js/main.js', 'public/js/api.js', 'public/js/util.js',
  'public/js/batch-ops.js', 'public/js/batch-content.js',
  'public/js/team-progress-model.js', 'public/js/team-progress-view.js',
  'public/js/ui.js', 'public/js/shell.js',
  'public/js/pages/dashboard.js', 'public/js/pages/mywork.js',
  'public/js/pages/milestones.js', 'public/js/pages/schedule.js',
  'public/js/pages/sellingpoints.js', 'public/js/pages/hotspot.js',
  'public/js/pages/admin.js', 'public/js/pages/teamboard.js',
  'lib/db.js', 'lib/store.js', 'lib/seed.js', 'lib/hotspot.js',
  'lib/hotspot-context.js', 'tools/migrate-hotspot-user.js',
  'server.js', 'tools/verify-ui.js',
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ty-syntax-'));
let bad = 0;

for (const rel of TARGETS) {
  const src = path.join(ROOT, rel);
  if (!fs.existsSync(src)) { console.log(`跳过（不存在） ${rel}`); continue; }
  const isEsm = src.includes(`${path.sep}public${path.sep}`);
  const dst = path.join(tmp, rel.replace(/[\\/]/g, '_') + (isEsm ? '.mjs' : '.cjs'));
  fs.copyFileSync(src, dst);
  try {
    execFileSync(process.execPath, ['--check', dst], { stdio: 'pipe' });
    console.log(`OK    ${rel}`);
  } catch (e) {
    bad++;
    console.log(`FAIL  ${rel}`);
    console.log(String(e.stderr || e.message).split('\n').slice(0, 6).join('\n'));
  }
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(bad ? `\n${bad} 个文件存在语法错误` : '\n全部文件语法检查通过');
process.exit(bad ? 1 : 0);
