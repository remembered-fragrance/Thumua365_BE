/**
 * BE6 trên Postgres thật — hồ sơ, mã giới thiệu, xoá tài khoản THẬT. Xoá tài khoản theo đúng thứ tự
 * ảnh → dữ liệu → tài khoản đăng nhập; giữ sổ đối soát ngân hàng và nhật ký; tổ chức còn người làm
 * thì không xoá được. Supabase Auth Admin và Storage là giả.
 */

import { AccountDeleteResult, ErrorBody, MeProfile, ReferralClaimResult } from '@mambo/contracts';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaMemberships } from '../../src/auth/prisma-memberships';
import { Database } from '../../src/db/database';
import { PrivilegedDatabase } from '../../src/db/privileged-database';
import { FakeStorageAdmin, FakeSupabaseAdmin, buildTestApp, makeSigner, testEnv } from '../helpers';
import { SERVICE_URL, admin, createOrg, createSupplier, newId, service, truncateAll } from './db';
import { NOW, addMember, rubberLine } from './sync-fixture';

const PRIVILEGED_URL =
  process.env.TEST_DATABASE_PRIVILEGED_URL ?? 'postgresql://api_privileged:api_privileged_dev@localhost:54329/thumua365';

let app: INestApplication;
let auth: FakeSupabaseAdmin;
let storage: FakeStorageAdmin;
let signer: Awaited<ReturnType<typeof makeSigner>>;

beforeAll(async () => {
  signer = await makeSigner();
  auth = new FakeSupabaseAdmin();
  storage = new FakeStorageAdmin();
  const db = new Database(SERVICE_URL);
  app = await buildTestApp({
    env: testEnv({ DATABASE_URL: SERVICE_URL, PRIVILEGED_DATABASE_URL: PRIVILEGED_URL, RATE_LIMIT_PER_MINUTE: '10000' }),
    jwks: signer.jwks,
    supabaseAdmin: auth,
    storage,
    db,
    privilegedDb: new PrivilegedDatabase(PRIVILEGED_URL),
    memberships: new PrismaMemberships(db),
  });
});

afterAll(async () => {
  await app.close();
  await admin.end();
  await service.end();
});

const as = async (userId: string) => {
  const token = await signer.sign({ sub: userId });
  const http = () => request(app.getHttpServer());
  const authed = <T extends request.Test>(r: T) => r.set('authorization', `Bearer ${token}`);
  return {
    get: (path: string) => authed(http().get(path)),
    post: (path: string, body: object) => authed(http().post(path).send(body)),
    patch: (path: string, body: object) => authed(http().patch(path).send(body)),
    del: (path: string) => authed(http().delete(path)),
  };
};

const profile = async (id: string, name: string, phone: string | null) => {
  await admin.query('insert into profiles (id, name, phone) values ($1, $2, $3)', [id, name, phone]);
  return (await admin.query<{ referral_code: string }>('select referral_code from profiles where id = $1', [id])).rows[0]?.referral_code ?? '';
};

const count = async (sql: string, params: unknown[] = []): Promise<number> =>
  (await admin.query<{ n: number }>(`select count(*)::int as n from ${sql}`, params)).rows[0]?.n ?? -1;

beforeEach(async () => {
  await truncateAll();
  auth.deleted.length = 0;
  storage.removed.length = 0;
  storage.failing = false;
});

describe('hồ sơ', () => {
  it('xem, sửa tên / tên đăng nhập / email khôi phục; tên đăng nhập trùng → 422; chưa có hồ sơ → 404', async () => {
    const me = newId();
    const other = newId();
    await profile(me, 'Anh Hùng', '+84905112233');
    await profile(other, 'Chị Lan', null);
    await admin.query(`update profiles set username = 'chilan' where id = $1`, [other]);
    const api = await as(me);

    const before = MeProfile.parse((await api.get('/v1/me/profile').expect(200)).body);
    expect(before).toMatchObject({ name: 'Anh Hùng', phone: '+84905112233', username: null, referred: false });
    expect(before.referralCode).toMatch(/^[2-9A-Z]{6}$/);

    const after = MeProfile.parse(
      (await api.patch('/v1/me/profile', { name: 'Hùng Tư', username: 'VuaTuHung', recoveryEmail: 'hung@example.com' }).expect(200)).body,
    );
    expect(after).toMatchObject({ name: 'Hùng Tư', username: 'vuatuhung', recoveryEmail: 'hung@example.com', phone: '+84905112233' });

    const taken = await api.patch('/v1/me/profile', { username: 'ChiLan' }).expect(422);
    expect(ErrorBody.parse(taken.body).error.details).toMatchObject({ fields: { username: expect.any(String) } });
    await api.patch('/v1/me/profile', { phone: '+84900000000' }).expect(422);
    await (await as(newId())).get('/v1/me/profile').expect(404);
  });
});

describe('mã giới thiệu', () => {
  it('ghi nhận đúng một lần; mã của chính mình, mã lạ → false; luôn 200', async () => {
    const inviter = newId();
    const me = newId();
    const code = await profile(inviter, 'Anh Tư', '+84901000001');
    const mine = await profile(me, 'Chị Ba', '+84901000002');
    const api = await as(me);

    expect(ReferralClaimResult.parse((await api.post('/v1/referrals/claim', { code: 'KHONGCO' }).expect(200)).body)).toEqual({ claimed: false });
    expect(ReferralClaimResult.parse((await api.post('/v1/referrals/claim', { code: mine }).expect(200)).body)).toEqual({ claimed: false });
    expect(ReferralClaimResult.parse((await api.post('/v1/referrals/claim', { code: code.toLowerCase() }).expect(200)).body)).toEqual({
      claimed: true,
    });
    const other = await profile(newId(), 'Người khác', '+84901000003');
    expect(ReferralClaimResult.parse((await api.post('/v1/referrals/claim', { code: other }).expect(200)).body)).toEqual({ claimed: false });
    const { rows } = await admin.query('select referred_by from profiles where id = $1', [me]);
    expect(rows[0]?.referred_by).toBe(inviter);
  });
});

describe('xoá tài khoản', () => {
  /** Vựa có đủ thứ: sổ, lần trả, đơn và kết nối với một nông dân, gói, ý định thanh toán, thông báo. */
  const fullTrader = async () => {
    const owner = newId();
    await profile(owner, 'Anh Hùng', '+84905112233');
    auth.emails.set(owner, '84905112233@id.thumua365.vn');
    const vua = await createOrg('trader', owner, 'Vựa Tư Hùng');
    await admin.query(`insert into subscriptions (organization_id, status, trial_ends_at) values ($1, 'trialing', now() + interval '30 days')`, [vua]);
    const mai = newId();
    const farm = await createOrg('farmer', mai, 'Hộ cô Mai');
    const supplier = await createSupplier(vua, '0912 345 678', 'Cô Mai');
    await admin.query(
      `insert into partner_links (owner_org_id, partner_kind, partner_id, linked_org_id, invited_phone, status)
       values ($1, 'supplier', $2, $3, '+84912345678', 'active')`,
      [vua, supplier, farm],
    );
    const order = newId();
    await admin.query(
      `insert into orders (id, seller_org_id, buyer_org_id, created_by_org_id, created_by, est_quantity) values ($1, $2, $3, $2, $4, 100)`,
      [order, farm, vua, mai],
    );
    await admin.query(`insert into order_events (order_id, to_status, actor_user_id) values ($1, 'submitted', $2)`, [order, mai]);
    const tx = newId();
    await admin.query(
      `insert into transactions (id, organization_id, created_by, date, kind, counterparty_id, supplier_name, lines, order_id)
       values ($1, $2, $3, $4, 'purchase', $5, 'Cô Mai', $6, $7)`,
      [tx, vua, owner, NOW, supplier, JSON.stringify([rubberLine()]), order],
    );
    await admin.query(`insert into payments (id, organization_id, transaction_id, created_by, date, amount) values ($1, $2, $3, $4, now(), 500000)`, [
      newId(),
      vua,
      tx,
      owner,
    ]);
    await admin.query(`insert into notifications (organization_id, kind) values ($1, 'order.submitted'), ($2, 'order.accepted')`, [vua, farm]);
    await admin.query(
      `insert into payment_intents (organization_id, created_by, amount, status, provider, provider_ref) values ($1, $2, 149000, 'paid', 'vietqr', 'K7M2P9')`,
      [vua, owner],
    );
    await admin.query(`insert into bank_transactions (bank_tx_id, organization_id, amount, source) values ('FT-CU', $1, 149000, 'webhook')`, [vua]);
    return { owner, vua, mai, farm };
  };

  it('chủ duy nhất: ảnh → dữ liệu → tài khoản; tổ chức và mọi thứ của nó mất hẳn; sổ đối soát và nhật ký còn', async () => {
    const { owner, vua, mai, farm } = await fullTrader();
    const res = AccountDeleteResult.parse((await (await as(owner)).del('/v1/me').expect(200)).body);
    expect(res).toEqual({ deletedOrganizations: [vua], leftOrganizations: [] });

    expect(storage.removed).toEqual([`attachments/${vua}`]);
    expect(auth.deleted).toEqual([owner]);
    for (const table of ['transactions', 'payments', 'suppliers', 'subscriptions', 'payment_intents', 'memberships', 'notifications']) {
      expect(await count(`${table} where organization_id = $1`, [vua]), table).toBe(0);
    }
    expect(await count('organizations where id = $1', [vua])).toBe(0);
    expect(await count('profiles where id = $1', [owner])).toBe(0);
    expect(await count('orders')).toBe(0);
    expect(await count('order_events')).toBe(0);
    expect(await count('partner_links')).toBe(0);
    // Giữ lại: sổ đối soát ngân hàng, nhật ký xoá tài khoản.
    expect(await count(`bank_transactions where bank_tx_id = 'FT-CU'`)).toBe(1);
    expect(await count(`audit_log where action = 'account.deleted' and actor_user_id = $1`, [owner])).toBe(1);
    // Bên kia vẫn nguyên: tổ chức, thông báo của chính họ.
    expect(await count('organizations where id = $1', [farm])).toBe(1);
    expect(await count('memberships where user_id = $1', [mai])).toBe(1);
    expect(await count('notifications where organization_id = $1', [farm])).toBe(1);
  });

  it('chủ còn người làm → 422 ORG_HAS_MEMBERS, không xoá gì, không chạm Storage', async () => {
    const { owner, vua } = await fullTrader();
    await addMember(vua, newId(), 'staff');
    const res = await (await as(owner)).del('/v1/me').expect(422);
    expect(ErrorBody.parse(res.body).error.details).toMatchObject({ reason: 'ORG_HAS_MEMBERS', organizations: [vua] });
    expect(storage.removed).toEqual([]);
    expect(auth.deleted).toEqual([]);
    expect(await count('transactions where organization_id = $1', [vua])).toBe(1);
  });

  it('người làm thuê xoá tài khoản: chỉ rời tổ chức, sổ của chủ còn nguyên', async () => {
    const { owner, vua } = await fullTrader();
    const staff = newId();
    await addMember(vua, staff, 'staff');
    await profile(staff, 'Người cân', '+84907777777');
    const res = AccountDeleteResult.parse((await (await as(staff)).del('/v1/me').expect(200)).body);
    expect(res).toEqual({ deletedOrganizations: [], leftOrganizations: [vua] });
    expect(storage.removed).toEqual([]);
    expect(auth.deleted).toEqual([staff]);
    expect(await count(`memberships where user_id = $1 and status = 'removed'`, [staff])).toBe(1);
    expect(await count('transactions where organization_id = $1', [vua])).toBe(1);
    expect(await count('profiles where id = $1', [owner])).toBe(1);
  });

  it('🔴 Storage hỏng → dừng trước khi xoá dữ liệu hay tài khoản', async () => {
    const { owner, vua } = await fullTrader();
    storage.failing = true;
    await (await as(owner)).del('/v1/me').expect(500);
    expect(auth.deleted).toEqual([]);
    expect(await count('organizations where id = $1', [vua])).toBe(1);
    expect(await count('profiles where id = $1', [owner])).toBe(1);
  });
});
