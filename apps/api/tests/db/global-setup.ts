import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import pg from 'pg';
import { ADMIN_URL } from './db';

/**
 * Chạy MỌI migration lên database test trước khi test chạy — đúng lệnh
 * `prisma migrate deploy` staging sẽ chạy. Migration hỏng thì dừng ở đây.
 */
export default async function setup(): Promise<void> {
  const probe = new pg.Client({ connectionString: ADMIN_URL });
  try {
    await probe.connect();
  } catch {
    throw new Error(`Không kết nối được Postgres test (${new URL(ADMIN_URL).host}). Máy dev: chạy \`npm run db:up\` trước.`);
  } finally {
    await probe.end().catch(() => undefined);
  }

  const res = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: resolve(import.meta.dirname, '..', '..'),
    env: { ...process.env, DIRECT_URL: ADMIN_URL },
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (res.status !== 0) throw new Error(`prisma migrate deploy lỗi:\n${res.stdout}\n${res.stderr}`);
}
