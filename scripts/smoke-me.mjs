#!/usr/bin/env node
/**
 * Kiểm /v1/me trên staging bằng một tài khoản THẬT — bạn tự chạy trên máy mình.
 *
 *   npm run smoke:me
 *   npm run smoke:me -- https://thumua365-api-staging.onrender.com   (đổi API)
 *
 * Script hỏi email + mật khẩu (gõ mật khẩu không hiện chữ). Mật khẩu và token
 * KHÔNG bao giờ được in ra, ghi file hay gửi đi đâu ngoài Supabase Auth và API.
 *
 * Bốn bước:
 *   1. Đăng nhập Supabase Auth → lấy access_token
 *   2. GET /v1/me với token đó → phải 200 và đúng hợp đồng `Me`
 *   3. GET /v1/me với token bị sửa một ký tự → phải 401
 *   4. Đăng xuất phiên này ở Supabase, gọi lại /v1/me bằng token CŨ (chưa hết hạn)
 *      → phải 401: API phát hiện phiên đã bị thu hồi
 *
 * Biến môi trường (không bắt buộc — thiếu thì script hỏi):
 *   SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, TEST_EMAIL, TEST_PASSWORD
 * Script tự đọc apps/api/.env nếu có.
 */

import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';

const STAGING_API = 'https://thumua365-api-staging.onrender.com';
const STAGING_SUPABASE = 'https://bldlrkmszjmhifubxjvl.supabase.co';

if (existsSync('apps/api/.env')) process.loadEnvFile('apps/api/.env');

const apiUrl = (process.argv[2] ?? process.env.API_URL ?? STAGING_API).replace(/\/+$/, '');
const supabaseUrl = (process.env.SUPABASE_URL || STAGING_SUPABASE).replace(/\/+$/, '');

// ─── Nhập liệu ────────────────────────────────────────────────────────────────

// Một readline cho mọi câu hỏi, và mọi dòng nhận được đều xếp hàng: dòng gõ (hoặc
// dán) trước khi câu hỏi kịp hiện ra không bị mất.
let muted = false;
let rl = null;
let ended = false;
const lines = [];
const waiters = [];

const reader = () => {
  if (rl) return rl;
  // Readline tự in lại ký tự vừa gõ qua `output`; tắt tiếng nó khi đang gõ mật khẩu.
  const output = new Writable({
    write(chunk, encoding, done) {
      if (!muted) process.stdout.write(chunk, encoding);
      done();
    },
  });
  rl = createInterface({ input: process.stdin, output, terminal: process.stdin.isTTY === true });
  rl.on('line', (line) => {
    const waiter = waiters.shift();
    if (waiter) waiter.resolve(line);
    else lines.push(line);
  });
  rl.on('close', () => {
    ended = true;
    for (const waiter of waiters.splice(0)) waiter.reject(new Error('Đầu vào kết thúc trước khi trả lời đủ câu hỏi'));
  });
  return rl;
};

const nextLine = () => {
  if (lines.length > 0) return Promise.resolve(lines.shift());
  if (ended) return Promise.reject(new Error('Đầu vào kết thúc trước khi trả lời đủ câu hỏi'));
  return new Promise((resolve, reject) => waiters.push({ resolve, reject }));
};

const ask = async (question, { hidden = false } = {}) => {
  reader();
  process.stdout.write(question);
  muted = hidden;
  try {
    return (await nextLine()).trim();
  } finally {
    muted = false;
    if (hidden) process.stdout.write('\n');
  }
};

// ─── In kết quả ──────────────────────────────────────────────────────────────

let failed = 0;
const pass = (label, detail = '') => console.warn(`  ✅ ${label}${detail ? ` — ${detail}` : ''}`);
const fail = (label, detail = '') => {
  failed++;
  console.warn(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`);
};

/** Che bớt để nhận ra được mà không lộ trọn: 6f1c1d2e-…-4e5f */
const mask = (id) => (typeof id === 'string' && id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id);

const callMe = async (token) => {
  const res = await fetch(`${apiUrl}/v1/me`, { headers: { authorization: `Bearer ${token}` } });
  const body = await res.json().catch(() => null);
  return { status: res.status, body, requestId: res.headers.get('x-request-id') };
};

/** Dùng đúng schema của hợp đồng nếu đã build gói (npm run build:packages). */
const loadMeSchema = async () => {
  try {
    const { Me } = await import('@mambo/contracts');
    return Me;
  } catch {
    return null;
  }
};

// ─── Chạy ────────────────────────────────────────────────────────────────────

const main = async () => {
  console.warn(`API:      ${apiUrl}`);
  console.warn(`Supabase: ${supabaseUrl}\n`);

  const publishableKey =
    process.env.SUPABASE_PUBLISHABLE_KEY || (await ask('Publishable key của Supabase staging (sb_publishable_…): '));
  const email = process.env.TEST_EMAIL || (await ask('Email tài khoản thử: '));
  const password = process.env.TEST_PASSWORD || (await ask('Mật khẩu (không hiện khi gõ): ', { hidden: true }));
  rl?.close();
  if (!publishableKey || !email || !password) throw new Error('Thiếu publishable key, email hoặc mật khẩu');

  // API free của Render ngủ sau 15 phút — đánh thức trước để bước 2 không bị tính giờ oan.
  process.stdout.write('\nĐánh thức API… ');
  const health = await fetch(`${apiUrl}/v1/health`).then((r) => r.json());
  console.warn(`${health.env} · commit ${health.commit}\n`);

  // 1. Đăng nhập
  console.warn('1. Đăng nhập Supabase Auth');
  const login = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: publishableKey, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const session = await login.json().catch(() => ({}));
  if (!login.ok || !session.access_token) {
    fail('Đăng nhập', `HTTP ${login.status}: ${session.error_description ?? session.msg ?? session.message ?? 'không rõ'}`);
    return;
  }
  const token = session.access_token;
  pass('Đăng nhập', `user ${mask(session.user?.id)}, token hết hạn sau ${session.expires_in}s`);

  // 2. /v1/me
  console.warn('\n2. GET /v1/me với token thật');
  const me = await callMe(token);
  if (me.status !== 200) {
    fail(`HTTP ${me.status}`, JSON.stringify(me.body));
  } else {
    pass('HTTP 200', `requestId ${me.requestId}`);
    const schema = await loadMeSchema();
    if (schema) {
      const parsed = schema.safeParse(me.body);
      if (parsed.success) pass('Đúng hợp đồng Me của @mambo/contracts');
      else fail('Sai hợp đồng Me', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
    } else {
      console.warn('  (bỏ qua kiểm schema — chạy `npm run build:packages` trước để bật)');
    }
    const u = me.body?.user ?? {};
    if (u.id === session.user?.id) pass('user.id khớp tài khoản vừa đăng nhập');
    else fail('user.id không khớp tài khoản vừa đăng nhập');
    console.warn(
      `     name=${JSON.stringify(u.name)} · email=${u.email ? 'có' : 'null'} · phone=${u.phone ? 'có' : 'null'}` +
        ` · phoneVerified=${u.phoneVerified} · memberships=${me.body?.memberships?.length} · pendingLinks=${me.body?.pendingLinks}`,
    );
  }

  // 3. Token bị sửa
  console.warn('\n3. GET /v1/me với token bị sửa một ký tự');
  const last = token.at(-1) === 'A' ? 'B' : 'A';
  const tampered = await callMe(`${token.slice(0, -1)}${last}`);
  if (tampered.status === 401 && tampered.body?.error?.code === 'UNAUTHENTICATED') pass('401 UNAUTHENTICATED');
  else fail(`Mong 401, nhận ${tampered.status}`, JSON.stringify(tampered.body));

  // 4. Phiên bị thu hồi
  console.warn('\n4. Đăng xuất phiên này rồi gọi lại bằng token cũ (chưa hết hạn)');
  const logout = await fetch(`${supabaseUrl}/auth/v1/logout?scope=local`, {
    method: 'POST',
    headers: { apikey: publishableKey, authorization: `Bearer ${token}` },
  });
  if (!logout.ok) {
    fail('Đăng xuất ở Supabase', `HTTP ${logout.status}`);
    return;
  }
  const revoked = await callMe(token);
  if (revoked.status === 401) pass('401 — API phát hiện phiên đã bị thu hồi dù JWT còn hạn');
  else fail(`Mong 401, nhận ${revoked.status}`, 'API vẫn nhận token của phiên đã đăng xuất');
};

main()
  .catch((err) => fail('Lỗi không lường trước', err instanceof Error ? err.message : String(err)))
  .finally(() => {
    console.warn(failed === 0 ? '\nKết quả: ĐẠT\n' : `\nKết quả: ${failed} mục KHÔNG ĐẠT\n`);
    process.exitCode = failed === 0 ? 0 : 1;
  });
