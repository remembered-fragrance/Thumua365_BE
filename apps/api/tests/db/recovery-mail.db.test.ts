/**
 * 0.16.0 trên Postgres thật — xác nhận email khôi phục, quên mật khẩu. Gửi thư và Supabase Auth Admin
 * là giả. Điểm phải giữ: chỉ email ĐÃ XÁC NHẬN nhận link đặt lại mật khẩu; API không tự đánh dấu
 * "đã xác nhận" được; quên mật khẩu không cho dò ai có tài khoản.
 */

import { ErrorBody, MeProfile, PasswordResetRequestResult, RecoveryEmailConfirmResult, RecoveryEmailVerifyResult } from '@mambo/contracts';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaMemberships } from '../../src/auth/prisma-memberships';
import { Database } from '../../src/db/database';
import { FakeMailer, FakeSupabaseAdmin, FakeSupabaseUsers, USER_ID, buildTestApp, makeSigner, testEnv } from '../helpers';
import { SERVICE_URL, admin, newId, service, serviceError, truncateAll } from './db';

const APP_URL = 'https://app.thumua365.test';

let app: INestApplication;
let auth: FakeSupabaseAdmin;
let mailer: FakeMailer;
let users: FakeSupabaseUsers;
let signer: Awaited<ReturnType<typeof makeSigner>>;
let ip = 0;

beforeAll(async () => {
  signer = await makeSigner();
  auth = new FakeSupabaseAdmin();
  mailer = new FakeMailer();
  users = new FakeSupabaseUsers();
  const db = new Database(SERVICE_URL);
  app = await buildTestApp({
    // Hạn mức riêng của các route này là 5/phút/IP — mỗi request một IP giả để test không chạm 429.
    env: testEnv({ DATABASE_URL: SERVICE_URL, RATE_LIMIT_PER_MINUTE: '10000', CLIENT_IP_HEADER: 'x-test-ip', APP_URL }),
    jwks: signer.jwks,
    supabaseAdmin: auth,
    supabaseUsers: users,
    mailer,
    db,
    memberships: new PrismaMemberships(db),
  });
});

afterAll(async () => {
  await app.close();
  await admin.end();
  await service.end();
});

beforeEach(async () => {
  await truncateAll();
  mailer.sent.length = 0;
  mailer.failing = false;
  mailer.configured = true;
  auth.recoveries.length = 0;
  auth.emails.clear();
});

const http = () => request(app.getHttpServer());
const nextIp = () => `10.0.${Math.floor(++ip / 250)}.${ip % 250}`;

const as = async (userId: string) => {
  const token = await signer.sign({ sub: userId });
  const authed = <T extends request.Test>(r: T) => r.set('authorization', `Bearer ${token}`).set('x-test-ip', nextIp());
  return {
    get: (path: string) => authed(http().get(path)),
    post: (path: string, body: object = {}) => authed(http().post(path).send(body)),
    patch: (path: string, body: object) => authed(http().patch(path).send(body)),
  };
};

const confirm = (token: string) => http().post('/v1/auth/recovery-email/confirm').set('x-test-ip', nextIp()).send({ token });
const forgot = (identifier: string) => http().post('/v1/auth/password-reset').set('x-test-ip', nextIp()).send({ identifier });

const tokenOf = (link: string | null): string => new URL(link ?? 'http://x').searchParams.get('token') ?? '';

const profile = async (id: string, phone: string, extra: { username?: string; email?: string; verified?: boolean } = {}) => {
  await admin.query(
    'insert into profiles (id, name, phone, username, recovery_email, recovery_email_verified_at) values ($1, $2, $3, $4, $5, $6)',
    [id, 'Chị Lan', phone, extra.username ?? null, extra.email ?? null, extra.verified ? new Date() : null],
  );
  auth.emails.set(id, `${phone.replace('+', '')}@id.thumua365.vn`);
};

const row = async (id: string) =>
  (
    await admin.query<{ verified: boolean; token: string | null; sent: Date | null }>(
      `select recovery_email_verified_at is not null as verified, recovery_email_token_hash as token, auth_mail_sent_at as sent
         from profiles where id = $1`,
      [id],
    )
  ).rows[0];

/** Đẩy mốc gửi thư về quá khứ — thay cho chờ 60 giây. */
const pastCooldown = (id: string) => admin.query(`update profiles set auth_mail_sent_at = now() - interval '2 minutes' where id = $1`, [id]);

describe('xác nhận email khôi phục', () => {
  it('sửa email → thư có link; bấm link → đã xác nhận; link dùng một lần', async () => {
    const me = newId();
    await profile(me, '+84907000111');
    const api = await as(me);

    const after = MeProfile.parse((await api.patch('/v1/me/profile', { recoveryEmail: 'lan@example.com' }).expect(200)).body);
    expect(after).toMatchObject({ recoveryEmail: 'lan@example.com', recoveryEmailVerified: false });
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]?.to).toBe('lan@example.com');
    const link = mailer.lastLink();
    expect(link).toMatch(new RegExp(`^${APP_URL}/xac-nhan-email\\?token=[A-Za-z0-9_-]{43}$`));
    // Database chỉ giữ hash — không giữ mã trong link.
    const stored = await row(me);
    expect(stored?.token).toMatch(/^[0-9a-f]{64}$/);
    expect(stored?.token).not.toBe(tokenOf(link));

    expect(RecoveryEmailConfirmResult.parse((await confirm(tokenOf(link)).expect(200)).body)).toEqual({ email: 'lan@example.com' });
    expect(MeProfile.parse((await api.get('/v1/me/profile').expect(200)).body).recoveryEmailVerified).toBe(true);
    expect((await row(me))?.token).toBeNull();
    expect((await confirm(tokenOf(link)).expect(200)).body).toEqual({ email: null });

    // Sửa tên (email giữ nguyên, kể cả khác hoa/thường) → không gửi thư, không mất xác nhận.
    await api.patch('/v1/me/profile', { name: 'Lan Tư', recoveryEmail: 'LAN@example.com' }).expect(200);
    expect(mailer.sent).toHaveLength(1);
    expect((await row(me))?.verified).toBe(true);
  });

  it('gửi lại: no_email · too_soon trong 60 giây · mã mới thay mã cũ · already_verified', async () => {
    const me = newId();
    await profile(me, '+84907000112');
    const api = await as(me);
    const verify = async () => RecoveryEmailVerifyResult.parse((await api.post('/v1/me/recovery-email/verify').expect(200)).body).status;

    expect(await verify()).toBe('no_email');
    await api.patch('/v1/me/profile', { recoveryEmail: 'a@example.com' }).expect(200);
    const first = mailer.lastLink();
    expect(await verify()).toBe('too_soon');
    expect(mailer.sent).toHaveLength(1);

    await pastCooldown(me);
    expect(await verify()).toBe('sent');
    expect(mailer.sent).toHaveLength(2);
    expect((await confirm(tokenOf(first)).expect(200)).body).toEqual({ email: null });
    await confirm(tokenOf(mailer.lastLink())).expect(200);
    expect(await verify()).toBe('already_verified');
  });

  it('🔴 đổi email → mất xác nhận, link cũ hết dùng được; link hết hạn → null', async () => {
    const me = newId();
    await profile(me, '+84907000113', { email: 'cu@example.com', verified: true });
    const api = await as(me);

    await api.patch('/v1/me/profile', { recoveryEmail: 'moi@example.com' }).expect(200);
    expect(await row(me)).toMatchObject({ verified: false });
    const link = mailer.lastLink();
    await pastCooldown(me);
    await api.patch('/v1/me/profile', { recoveryEmail: 'khac@example.com' }).expect(200);
    expect((await confirm(tokenOf(link)).expect(200)).body).toEqual({ email: null });

    await admin.query(`update profiles set recovery_email_token_expires_at = now() - interval '1 second' where id = $1`, [me]);
    expect((await confirm(tokenOf(mailer.lastLink())).expect(200)).body).toEqual({ email: null });
    expect(await row(me)).toMatchObject({ verified: false });

    // Bỏ email → không còn gì để xác nhận.
    await api.patch('/v1/me/profile', { recoveryEmail: null }).expect(200);
    expect(await row(me)).toEqual({ verified: false, token: null, sent: expect.any(Date) });
  });

  it('🔴 api_service không tự đánh dấu "đã xác nhận" được — chỉ qua confirm_recovery_email()', async () => {
    const me = newId();
    await profile(me, '+84907000114', { email: 'x@example.com' });
    expect(await serviceError({ userId: me }, `update profiles set recovery_email_verified_at = now() where id = $1`, [me])).toMatch(
      /confirm_recovery_email/,
    );
    const other = newId();
    expect(
      await serviceError(
        { userId: other },
        `insert into profiles (id, name, recovery_email, recovery_email_verified_at) values ($1, 'X', 'y@example.com', now())`,
        [other],
      ),
    ).toMatch(/confirm_recovery_email|row-level security/);
    // Mã sai dạng → CHECK chặn.
    expect(await serviceError({ userId: me }, `update profiles set recovery_email_token_hash = 'abc', recovery_email_token_expires_at = now() where id = $1`, [me])).toMatch(
      /profiles_recovery_email_token_check/,
    );
  });

  it('gửi hỏng → 503 EMAIL_UNAVAILABLE, gỡ mã và mốc gửi (thử lại ngay được); chưa cấu hình → 503', async () => {
    const me = newId();
    await profile(me, '+84907000115', { email: 'b@example.com' });
    const api = await as(me);

    mailer.failing = true;
    const failed = await api.post('/v1/me/recovery-email/verify').expect(503);
    expect(ErrorBody.parse(failed.body).error.code).toBe('EMAIL_UNAVAILABLE');
    expect(await row(me)).toEqual({ verified: false, token: null, sent: null });

    mailer.failing = false;
    expect((await api.post('/v1/me/recovery-email/verify').expect(200)).body).toEqual({ status: 'sent' });

    mailer.configured = false;
    await api.post('/v1/me/recovery-email/verify').expect(503);
    // Sửa hồ sơ vẫn được dù chưa gửi được thư.
    await api.patch('/v1/me/profile', { recoveryEmail: 'c@example.com' }).expect(200);
  });

  it('mã quá ngắn / quá dài → 422', async () => {
    await confirm('ngan').expect(422);
    await confirm('x'.repeat(201)).expect(422);
  });

  it('đăng ký kèm email (user_metadata) → gửi thư xác nhận sau khi tạo tổ chức', async () => {
    users.account = {
      id: USER_ID,
      email: '84912345678@id.thumua365.vn',
      phone: '84912345678',
      phone_confirmed_at: '2026-09-21T03:00:00Z',
      user_metadata: { name: 'Cô Mai', recoveryEmail: 'Mai@Example.com' },
    };
    const api = await as(USER_ID);
    await api.post('/v1/me/bootstrap', { orgType: 'trader', orgName: 'Vựa cô Mai', name: 'Cô Mai' }).expect(200);
    expect(mailer.sent.map((m) => m.to)).toEqual(['mai@example.com']);
    // Gọi lại (idempotent) → không gửi thêm.
    await api.post('/v1/me/bootstrap', { orgType: 'trader', orgName: 'Vựa cô Mai', name: 'Cô Mai' }).expect(200);
    expect(mailer.sent).toHaveLength(1);
  });
});

describe('quên mật khẩu', () => {
  const ok = async (identifier: string) => expect(PasswordResetRequestResult.parse((await forgot(identifier).expect(200)).body)).toEqual({ ok: true });

  it('chỉ email ĐÃ XÁC NHẬN nhận link; SĐT / tên đăng nhập / email đều tìm được tài khoản', async () => {
    const lan = newId();
    await profile(lan, '+84907000121', { username: 'chilan', email: 'lan@example.com', verified: true });

    await ok('0907 000 121');
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]?.to).toBe('lan@example.com');
    expect(mailer.lastLink()).toBe(`${APP_URL}/dat-lai-mat-khau?token_hash=hashed-1&type=recovery`);
    expect(auth.recoveries).toEqual(['84907000121@id.thumua365.vn']);

    await pastCooldown(lan);
    await ok('ChiLan');
    await pastCooldown(lan);
    await ok('LAN@example.com');
    expect(mailer.sent.map((m) => m.to)).toEqual(['lan@example.com', 'lan@example.com', 'lan@example.com']);
  });

  it('🔴 không cho dò tài khoản: không có / chưa xác nhận / không email / vừa gửi → cùng { ok: true }, không thư', async () => {
    const unverified = newId();
    const noEmail = newId();
    const verified = newId();
    await profile(unverified, '+84907000131', { email: 'chua@example.com' });
    await profile(noEmail, '+84907000132');
    await profile(verified, '+84907000133', { email: 'roi@example.com', verified: true });

    await ok('0907000199');
    await ok('ai-do@example.com');
    await ok('0907000131');
    await ok('chua@example.com');
    await ok('0907000132');
    expect(mailer.sent).toHaveLength(0);
    expect(auth.recoveries).toHaveLength(0);

    await ok('0907000133');
    await ok('0907000133');
    expect(mailer.sent).toHaveLength(1);
  });

  it('dùng chung mốc 60 giây với thư xác nhận; tài khoản đã xoá → không thư', async () => {
    const me = newId();
    await profile(me, '+84907000141', { email: 'd@example.com', verified: true });
    await ok('0907000141');
    const api = await as(me);
    await admin.query(`update profiles set recovery_email = 'e@example.com' where id = $1`, [me]);
    expect((await api.post('/v1/me/recovery-email/verify').expect(200)).body).toEqual({ status: 'too_soon' });

    const gone = newId();
    await profile(gone, '+84907000142', { email: 'f@example.com', verified: true });
    await admin.query('update profiles set deleted_at = now() where id = $1', [gone]);
    await ok('0907000142');
    expect(mailer.sent).toHaveLength(1);
  });

  it('gửi hỏng → 503; chưa cấu hình → 503 với MỌI định danh (không lộ gì)', async () => {
    const me = newId();
    await profile(me, '+84907000151', { email: 'g@example.com', verified: true });
    mailer.failing = true;
    expect(ErrorBody.parse((await forgot('0907000151').expect(503)).body).error.code).toBe('EMAIL_UNAVAILABLE');

    mailer.failing = false;
    mailer.configured = false;
    await forgot('0907000151').expect(503);
    await forgot('0907000199').expect(503);
  });

  it('định danh rỗng / quá dài → 422', async () => {
    await forgot('   ').expect(422);
    await forgot('x'.repeat(201)).expect(422);
  });
});
