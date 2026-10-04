/**
 * BE9 trên Postgres thật — "Xong khi" của KH (R5): một vòng luồng R2 → phễu có đủ sự kiện, đúng thứ
 * tự, tách được theo `orgType`. Cộng: sự kiện ẩn danh trước khi đăng nhập, đăng nhập thì server gắn
 * tổ chức THẬT (không tin `orgType` app khai), sự kiện sai bỏ riêng, ba sự kiện server tự bắn.
 */

import { AdminFunnel, EventsTrackResult, OrderSummary } from '@mambo/contracts';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaMemberships } from '../../src/auth/prisma-memberships';
import { Database } from '../../src/db/database';
import { PrivilegedDatabase } from '../../src/db/privileged-database';
import { FakeSupabaseUsers, buildTestApp, makeSigner, testEnv } from '../helpers';
import { SERVICE_URL, admin, createOrg, createSupplier, newId, service, truncateAll } from './db';
import { giveTrial, opMaker, txData } from './sync-fixture';

const PRIVILEGED_URL =
  process.env.TEST_DATABASE_PRIVILEGED_URL ?? 'postgresql://api_privileged:api_privileged_dev@localhost:54329/thumua365';
const ADMIN_ID = '3f9b8c7d-6e5a-4b3c-9d2e-1f0a9b8c7d6e';

let app: INestApplication;
let users: FakeSupabaseUsers;
let signer: Awaited<ReturnType<typeof makeSigner>>;

beforeAll(async () => {
  signer = await makeSigner();
  users = new FakeSupabaseUsers();
  const db = new Database(SERVICE_URL);
  app = await buildTestApp({
    env: testEnv({ DATABASE_URL: SERVICE_URL, PRIVILEGED_DATABASE_URL: PRIVILEGED_URL, ADMIN_USER_IDS: ADMIN_ID, RATE_LIMIT_PER_MINUTE: '10000' }),
    jwks: signer.jwks,
    supabaseUsers: users,
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

const as = async (userId: string, orgId?: string) => {
  const token = await signer.sign({ sub: userId });
  const authed = <T extends request.Test>(r: T) => {
    const withToken = r.set('authorization', `Bearer ${token}`);
    return orgId ? withToken.set('x-organization-id', orgId) : withToken;
  };
  const http = () => request(app.getHttpServer());
  return {
    get: (path: string, query: Record<string, string> = {}) => authed(http().get(path).query(query)),
    post: (path: string, body: object = {}) => authed(http().post(path).send(body)),
    push: (ops: unknown[]) => authed(http().post('/v1/sync/push').send({ deviceId: newId(), ops })),
  };
};

const track = (events: object[], headers: Record<string, string> = {}) => {
  const req = request(app.getHttpServer()).post('/v1/events');
  for (const [k, v] of Object.entries(headers)) req.set(k, v);
  return req.send({ events });
};

const ev = (name: string, props: object = {}, extra: object = {}) => ({
  anonId: 'may-cua-co-mai',
  at: new Date().toISOString(),
  platform: 'pwa',
  name,
  props,
  ...extra,
});

const rowsOf = async (name: string) =>
  (await admin.query<{ organization_id: string | null; org_type: string | null; anon_id: string; props: object }>(
    'select organization_id, org_type, anon_id, props from analytics_events where name = $1 order by created_at',
    [name],
  )).rows;

/** Listener đo lường chạy sau commit, bất đồng bộ — đợi tới khi có. */
const waitFor = async (name: string) => {
  for (let i = 0; i < 50; i++) {
    const rows = await rowsOf(name);
    if (rows.length > 0) return rows;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`Không thấy sự kiện ${name}`);
};

let vua: string;
let vuaOwner: string;

beforeEach(async () => {
  await truncateAll();
  vuaOwner = newId();
  vua = await createOrg('trader', vuaOwner, 'Vựa Tư Hùng');
  await giveTrial(vua);
});

describe('nhận sự kiện từ app', () => {
  it('chưa đăng nhập: lưu ẩn danh; sự kiện sai (lộ số tiền, tên lạ, sự kiện của server) bị bỏ riêng, không 422 cả lô', async () => {
    const res = EventsTrackResult.parse(
      (
        await track([
          ev('app_opened'),
          ev('login_failed', { reason: 'wrong_credentials' }, { orgType: 'farmer' }),
          ev('receipt_created', { kind: 'purchase', lines: 1, offline: false, fromOrder: false, amount: 1_438_000 }),
          ev('plan_activated', { months: 12 }),
          { name: 'app_opened' },
        ]).expect(200)
      ).body,
    );
    expect(res).toEqual({ accepted: 2, dropped: 3 });
    expect(await rowsOf('app_opened')).toEqual([{ organization_id: null, org_type: null, anon_id: 'may-cua-co-mai', props: {} }]);
    expect((await rowsOf('login_failed'))[0]?.org_type).toBe('farmer');
    expect(await rowsOf('plan_activated')).toEqual([]);
  });

  it('đã đăng nhập: server gắn tổ chức và orgType THẬT — không tin orgType app khai; token sai → ẩn danh, vẫn 200', async () => {
    const token = await signer.sign({ sub: vuaOwner });
    await track([ev('receipt_created', { kind: 'purchase', lines: 2, offline: true, fromOrder: false }, { orgType: 'farmer' })], {
      authorization: `Bearer ${token}`,
      'x-organization-id': vua,
    }).expect(200);
    expect(await rowsOf('receipt_created')).toEqual([
      { organization_id: vua, org_type: 'trader', anon_id: 'may-cua-co-mai', props: { kind: 'purchase', lines: 2, offline: true, fromOrder: false } },
    ]);

    // Không thuộc tổ chức đó / token rác → vẫn nhận, nhưng ẩn danh.
    const stranger = await signer.sign({ sub: newId() });
    await track([ev('plans_viewed')], { authorization: `Bearer ${stranger}`, 'x-organization-id': vua }).expect(200);
    await track([ev('plans_viewed')], { authorization: 'Bearer rac', 'x-organization-id': vua }).expect(200);
    expect((await rowsOf('plans_viewed')).map((r) => r.organization_id)).toEqual([null, null]);
  });

  it('lô quá 50 → 422; giờ trên máy kẹp trong 30 ngày', async () => {
    await track(Array.from({ length: 51 }, () => ev('app_opened'))).expect(422);
    await track([ev('app_opened', {}, { at: '2020-01-01T00:00:00Z' })]).expect(200);
    const { rows } = await admin.query<{ age: number }>(`select extract(day from now() - created_at)::int as age from analytics_events`);
    expect(rows[0]?.age).toBeLessThanOrEqual(30);
  });
});

describe('phễu R2 — đủ sự kiện, đúng thứ tự, tách theo orgType', () => {
  it('kết nối được đồng ý → đơn → phiếu theo đơn → gói mở: ba sự kiện server tự bắn; phễu tách nông dân / vựa', async () => {
    const mai = newId();
    const farm = await createOrg('farmer', mai, 'Hộ cô Mai');
    const supplier = await createSupplier(vua, '0912 345 678', 'Cô Mai');
    const linkId = newId();
    await admin.query(
      `insert into partner_links (id, owner_org_id, partner_kind, partner_id, linked_org_id, invited_phone, status)
       values ($1, $2, 'supplier', $3, $4, '+84912345678', 'pending')`,
      [linkId, vua, supplier, farm],
    );
    const maiToken = await signer.sign({ sub: mai });
    const maiHeaders = { authorization: `Bearer ${maiToken}`, 'x-organization-id': farm };
    await track([ev('sign_up_completed', { orgType: 'farmer' })], maiHeaders).expect(200);

    // 1. Cô Mai (đã xác thực OTP) đồng ý kết nối → server bắn link_accepted.
    users.account = { id: mai, email: null, phone: '84912345678', phone_confirmed_at: '2026-10-03T03:00:00Z', user_metadata: {} };
    await (await as(mai, farm)).post(`/v1/links/${linkId}/accept`).expect(200);
    expect((await waitFor('link_accepted'))[0]).toMatchObject({ organization_id: farm, org_type: 'farmer', anon_id: 'server' });

    // 2. Đơn: cô Mai tạo, vựa nhận và hẹn (app báo order_created / order_accepted / order_scheduled).
    const order = OrderSummary.parse((await (await as(mai, farm)).post('/v1/orders', { role: 'seller', counterpartOrgId: vua, estQuantity: 500 }).expect(200)).body);
    await track([ev('order_created', { role: 'seller' })], maiHeaders).expect(200);
    const vuaApi = await as(vuaOwner, vua);
    await vuaApi.post(`/v1/orders/${order.id}/accept`, { version: 1 }).expect(200);
    const vuaHeaders = { authorization: `Bearer ${await signer.sign({ sub: vuaOwner })}`, 'x-organization-id': vua };
    await track([ev('order_accepted', {}, { anonId: 'may-cua-vua' })], vuaHeaders).expect(200);

    // 3. Vựa đẩy phiếu theo đơn → server bắn order_fulfilled cho vựa.
    await vuaApi.push([opMaker()('transaction', 'insert', newId(), txData({ counterpartyId: supplier, orderId: order.id }))]).expect(200);
    expect((await waitFor('order_fulfilled'))[0]).toMatchObject({ organization_id: vua, org_type: 'trader' });

    // 4. Gói mở bằng tay → server bắn plan_activated.
    await (await as(ADMIN_ID))
      .post('/v1/admin/plans/activate', { organizationId: vua, months: 1, amount: 149_000, bankTxId: 'FT-PHEU', approvedBy: 'Tài' })
      .expect(200);
    expect((await waitFor('plan_activated'))[0]).toMatchObject({ organization_id: vua, props: { months: 1, source: 'admin' } });

    // Phễu: đúng thứ tự xảy ra, tách theo loại tổ chức.
    const funnel = AdminFunnel.parse(
      (await (await as(ADMIN_ID)).get('/v1/admin/funnel', { from: '2026-01-01T00:00:00Z', to: new Date(Date.now() + 60_000).toISOString() }).expect(200))
        .body,
    );
    expect(funnel.rows.map((r) => `${r.orgType}:${r.name}`)).toEqual([
      'farmer:sign_up_completed',
      'farmer:link_accepted',
      'farmer:order_created',
      'trader:order_accepted',
      'trader:order_fulfilled',
      'trader:plan_activated',
    ]);
    expect(funnel.rows.every((r) => r.organizations === 1 && r.events === 1)).toBe(true);

    // Người không phải quản trị viên không đọc được phễu.
    await (await as(vuaOwner)).get('/v1/admin/funnel', { from: '2026-01-01T00:00:00Z', to: '2026-12-31T00:00:00Z' }).expect(403);
  });
});
