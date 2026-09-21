#!/usr/bin/env node
/**
 * Postgres ở máy dev (docker-compose.yml ở gốc repo).
 *
 *   node scripts/db-local.mjs up       — bật (giữ dữ liệu cũ)
 *   node scripts/db-local.mjs reset    — xoá sạch, bật lại, chạy mọi migration
 *   node scripts/db-local.mjs migrate  — chạy migration còn thiếu
 *   node scripts/db-local.mjs down     — tắt
 *
 * Luôn đặt DIRECT_URL trỏ vào máy này trước khi gọi Prisma, nên apps/api/.env
 * (đang trỏ staging) không bao giờ được dùng ở đây.
 */

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const LOCAL_ADMIN_URL = 'postgresql://postgres:postgres@localhost:54329/thumua365';
export const LOCAL_SERVICE_URL = 'postgresql://api_service:api_service_dev@localhost:54329/thumua365';

const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(apiDir, '..', '..');

const run = (cmd, args, opts = {}) => {
  const res = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', ...opts });
  if (res.status !== 0) process.exit(res.status ?? 1);
};

const compose = (...args) => run('docker', ['compose', ...args], { cwd: repoRoot });

export const migrate = () =>
  run('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: apiDir,
    env: { ...process.env, DIRECT_URL: LOCAL_ADMIN_URL },
  });

const commands = {
  up: () => compose('up', '-d', '--wait'),
  down: () => compose('down'),
  reset: () => {
    compose('down', '-v');
    compose('up', '-d', '--wait');
    migrate();
  },
  migrate,
};

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const cmd = commands[process.argv[2] ?? ''];
  if (!cmd) {
    console.error(`Dùng: node scripts/db-local.mjs ${Object.keys(commands).join('|')}`);
    process.exit(1);
  }
  cmd();
}
