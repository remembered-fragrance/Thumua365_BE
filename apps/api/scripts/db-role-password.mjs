#!/usr/bin/env node
/**
 * Đặt (hoặc đổi) mật khẩu cho một role rồi ghi chuỗi kết nối của nó vào apps/api/.env.
 *
 *   npm run db:role-password -w @mambo/api                              # api_service    → DATABASE_URL
 *   npm run db:role-password -w @mambo/api -- --role api_privileged     # api_privileged → PRIVILEGED_DATABASE_URL
 *   npm run db:role-password -w @mambo/api -- --role backup_reader      # backup_reader  → BACKUP_DATABASE_URL
 *
 * Chạy MỘT lần cho mỗi project Supabase, sau khi migration đầu tiên đã tạo role
 * (NOLOGIN). Chạy lại = đổi mật khẩu (cũ hết hiệu lực ngay) — nhớ cập nhật Render.
 *
 * An toàn:
 *   - Mật khẩu sinh ngẫu nhiên tại máy, KHÔNG in ra màn hình, không đi qua chat.
 *   - Gửi lên Postgres dạng đã băm SCRAM-SHA-256 — log câu lệnh DDL của Supabase (nếu
 *     có) chỉ thấy chuỗi băm, không thấy mật khẩu.
 *   - Kết nối bằng DIRECT_URL (role postgres) trong apps/api/.env.
 */

import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

/** Role → biến chứa chuỗi kết nối, cổng pooler. API đi Transaction pooler; pg_dump cần Session pooler. */
const TARGETS = {
  api_service: { envVar: 'DATABASE_URL', port: '6543' },
  api_privileged: { envVar: 'PRIVILEGED_DATABASE_URL', port: '6543' },
  backup_reader: { envVar: 'BACKUP_DATABASE_URL', port: '5432' },
};
const roleFlag = process.argv.indexOf('--role');
const ROLE = roleFlag > 0 ? process.argv[roleFlag + 1] : 'api_service';
const TARGET = TARGETS[ROLE];
// `--env <file>` để thử trên Postgres ở máy; mặc định apps/api/.env.
const envFlag = process.argv.indexOf('--env');
const envPath =
  envFlag > 0 && process.argv[envFlag + 1]
    ? resolve(process.argv[envFlag + 1])
    : resolve(dirname(fileURLToPath(import.meta.url)), '..', '.env');

const fail = (message) => {
  console.error(`✘ ${message}`);
  process.exit(1);
};

if (!TARGET) fail(`--role phải là một trong: ${Object.keys(TARGETS).join(', ')}`);

if (!existsSync(envPath)) fail(`Chưa có ${envPath}`);
const envText = readFileSync(envPath, 'utf8');
const readVar = (name) => {
  const line = envText.split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
  return line ? line.slice(name.length + 1).trim().replace(/^["']|["']$/g, '') : '';
};

const directUrl = readVar('DIRECT_URL');
if (!directUrl) fail('DIRECT_URL trong apps/api/.env đang trống');

/** Chuỗi băm SCRAM-SHA-256 đúng định dạng Postgres lưu trong pg_authid (RFC 5802/7677). */
const scramVerifier = (password) => {
  const salt = randomBytes(16);
  const iterations = 4096;
  const salted = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  const clientKey = createHmac('sha256', salted).update('Client Key').digest();
  const storedKey = createHash('sha256').update(clientKey).digest();
  const serverKey = createHmac('sha256', salted).update('Server Key').digest();
  return `SCRAM-SHA-256$${iterations}:${salt.toString('base64')}$${storedKey.toString('base64')}:${serverKey.toString('base64')}`;
};

/**
 * DATABASE_URL cho API từ DIRECT_URL:
 *   Supabase pooler — user `postgres.<ref>` → `api_service.<ref>`, cổng 5432 → 6543 (Transaction pooler)
 *   Postgres thường — user `api_service`, giữ cổng
 */
const serviceUrl = (password) => {
  const url = new URL(directUrl);
  const [, projectRef] = decodeURIComponent(url.username).split('.');
  url.username = projectRef ? `${ROLE}.${projectRef}` : ROLE;
  url.password = encodeURIComponent(password);
  if (url.hostname.endsWith('.pooler.supabase.com')) url.port = TARGET.port;
  url.search = '';
  return url.toString();
};

const host = new URL(directUrl).hostname;
const password = randomBytes(24).toString('base64url');

const adminClient = new pg.Client({ connectionString: directUrl });
await adminClient.connect();
try {
  const exists = await adminClient.query('select 1 from pg_roles where rolname = $1', [ROLE]);
  if (exists.rowCount === 0) fail(`Chưa có role ${ROLE} — chạy migration trước (prisma migrate deploy).`);
  const { rows } = await adminClient.query(`select format('alter role %I with login password %L', $1::text, $2::text) as sql`, [
    ROLE,
    scramVerifier(password),
  ]);
  await adminClient.query(rows[0].sql);
} finally {
  await adminClient.end();
}

const url = serviceUrl(password);
const envLine = new RegExp(`^${TARGET.envVar}=.*$`, 'm');
const next = envLine.test(envText)
  ? envText.replace(envLine, `${TARGET.envVar}=${url}`)
  : `${envText.trimEnd()}\n${TARGET.envVar}=${url}\n`;
writeFileSync(envPath, next);

// Thử ngay bằng chính chuỗi mới — qua pooler, đúng đường API sẽ đi.
let who;
for (let attempt = 1; ; attempt++) {
  const check = new pg.Client({ connectionString: url });
  try {
    await check.connect();
    const { rows } = await check.query(
      `select current_user as role, (select rolbypassrls from pg_roles where rolname = current_user) as bypass`,
    );
    who = rows[0];
    break;
  } catch (err) {
    // Pooler có thể cần vài giây để thấy mật khẩu mới.
    if (attempt >= 5) fail(`Đã đặt mật khẩu nhưng chưa kết nối được bằng ${TARGET.envVar} mới: ${err.message}`);
    await new Promise((r) => setTimeout(r, 2000));
  } finally {
    await check.end().catch(() => undefined);
  }
}

const say = (line) => process.stdout.write(`${line}
`);
say(`✔ Đặt mật khẩu mới cho ${ROLE} trên ${host}`);
say(`✔ Ghi ${TARGET.envVar} (user ${new URL(url).username}, cổng ${new URL(url).port || 5432}) vào ${envPath}`);
say(`✔ Kết nối thử: current_user = ${who.role}, bypass RLS = ${who.bypass}`);
say(
  ROLE === 'backup_reader'
    ? `→ Chép ${TARGET.envVar} sang GitHub secrets (không dán qua chat).`
    : `→ Chép ${TARGET.envVar} từ apps/api/.env sang biến môi trường của Render (không dán qua chat).`,
);
