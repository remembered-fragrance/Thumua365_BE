/**
 * API chạy trên Postgres thật, bằng đúng role api_service và đúng PrismaMemberships
 * mà production dùng. Chỉ Supabase Auth là giả.
 */

import { ErrorBody, Me, type RouteDef } from '@mambo/contracts';
import { Controller, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { PrismaMemberships } from '../../src/auth/prisma-memberships';
import { Endpoint } from '../../src/common/endpoint';
import { Database } from '../../src/db/database';
import { FakeSupabaseAdmin, FakeSupabaseUsers, USER_ID, buildTestApp, makeSigner, testEnv } from '../helpers';
import { SERVICE_URL, admin, createOrg, createSupplier, newId, service, truncateAll } from './db';

/** Route giả `auth: 'org'` để thử OrgContextGuard với membership thật trong DB. */
const orgPing = {
  method: 'GET',
  path: '/v1/test/org-ping',
  summary: 'test',
  auth: 'org',
  permission: 'book:sync',
  response: z.object({ ok: z.literal(true) }),
} as const satisfies RouteDef;

@Controller()
class OrgPingController {
  @Endpoint(orgPing)
  ping() {
    return { ok: true };
  }
}

let signer: Awaited<ReturnType<typeof makeSigner>>;
let db: Database;
let users: FakeSupabaseUsers;
let supabaseAdmin: FakeSupabaseAdmin;
let app: INestApplication;
let token: string;

beforeAll(async () => {
  signer = await makeSigner();
  token = await signer.sign();
  db = new Database(SERVICE_URL);
  users = new FakeSupabaseUsers();
  supabaseAdmin = new FakeSupabaseAdmin();
  app = await buildTestApp({
    env: testEnv({ DATABASE_URL: SERVICE_URL, RATE_LIMIT_PER_MINUTE: '1000' }),
    jwks: signer.jwks,
    supabaseUsers: users,
    supabaseAdmin,
    db,
    memberships: new PrismaMemberships(db),
    extraControllers: [OrgPingController],
  });
});

afterAll(async () => {
  await app.close(); // đóng luôn pool của `db` (DatabaseShutdown)
  await admin.end();
  await service.end();
});

beforeEach(async () => {
  await truncateAll();
  users.account = {
    id: USER_ID,
    email: '84912345678@id.thumua365.vn',
    phone: '84912345678',
    phone_confirmed_at: '2026-09-21T03:00:00Z',
    user_metadata: { name: 'Tư Hùng' },
  };
  users.failWith = null;
});

const http = () => request(app.getHttpServer());
const bootstrap = (body: Record<string, unknown>) =>
  http().post('/v1/me/bootstrap').set('authorization', `Bearer ${token}`).send(body);

describe('POST /v1/me/bootstrap', () => {
  it('vựa: tổ chức + chủ + gói dùng thử 30 ngày, đúng ma trận quyền', async () => {
    const res = await bootstrap({ orgType: 'trader', orgName: 'Vựa Tư Hùng', name: 'Tư Hùng' }).expect(200);
    const me = Me.parse(res.body);

    expect(me.memberships).toHaveLength(1);
    const [m] = me.memberships;
    expect(m?.organization).toMatchObject({ type: 'trader', name: 'Vựa Tư Hùng' });
    expect(m?.role).toBe('owner');
    expect(m?.permissions).toContain('receipt:delete');
    expect(m?.plan).toMatchObject({ tier: 'trial', status: 'trialing', branchLimit: null });
    const days = (new Date(m?.plan?.periodEnd ?? 0).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThanOrEqual(30);
  });

  it('nông dân: không có gói, quyền của nông dân', async () => {
    const res = await bootstrap({ orgType: 'farmer', orgName: 'Hộ cô Mai', name: 'Mai' }).expect(200);
    const [m] = Me.parse(res.body).memberships;
    expect(m?.plan).toBeNull();
    expect(m?.permissions).not.toContain('book:sync');
    const { rows } = await admin.query('select id from subscriptions');
    expect(rows).toEqual([]);
  });

  it('idempotent: gọi lại (kể cả cùng lúc) không tạo tổ chức thứ hai', async () => {
    const body = { orgType: 'trader', orgName: 'Vựa Tư Hùng', name: 'Tư Hùng' };
    await Promise.all([bootstrap(body), bootstrap(body), bootstrap(body)]);
    await bootstrap({ ...body, orgType: 'enterprise', orgName: 'Tên khác' }).expect(200);

    const { rows } = await admin.query<{ type: string; name: string }>('select type, name from organizations');
    expect(rows).toEqual([{ type: 'trader', name: 'Vựa Tư Hùng' }]);
    const subs = await admin.query('select id from subscriptions');
    expect(subs.rowCount).toBe(1);
  });

  it('hồ sơ lấy số điện thoại từ email đăng nhập, BỎ QUA số client khai', async () => {
    await bootstrap({ orgType: 'farmer', orgName: 'Hộ', name: 'Mai', phone: '0987654321' }).expect(200);
    const { rows } = await admin.query<{ phone: string }>('select phone from profiles where id = $1', [USER_ID]);
    expect(rows[0]?.phone).toBe('+84912345678');
  });

  it('đăng ký bằng email thật thì dùng số khai, chuẩn hoá về +84', async () => {
    users.account = { ...users.account, email: 'hung@gmail.com', phone: null, phone_confirmed_at: null };
    await bootstrap({ orgType: 'trader', orgName: 'Vựa', name: 'Hùng', phone: '0987 654 321' }).expect(200);
    const { rows } = await admin.query<{ phone: string }>('select phone from profiles where id = $1', [USER_ID]);
    expect(rows[0]?.phone).toBe('+84987654321');
  });

  it('tên đăng nhập đã có người dùng → 422 chỉ đúng trường, không tạo gì', async () => {
    await admin.query(`insert into profiles (id, name, username) values ($1, 'Người khác', 'vuatuhung')`, [newId()]);
    const res = await bootstrap({ orgType: 'trader', orgName: 'Vựa', name: 'Hùng', username: 'VuaTuHung' }).expect(422);
    expect(ErrorBody.parse(res.body).error.details).toEqual({ fields: { username: 'Tên đăng nhập đã có người dùng' } });
    const orgs = await admin.query('select id from organizations');
    expect(orgs.rowCount).toBe(0);
  });

  it('thân request sai → 422 với danh sách trường; trường lạ bị từ chối', async () => {
    const res = await bootstrap({ orgType: 'admin', orgName: '', name: 'x', role: 'owner' }).expect(422);
    const fields = ErrorBody.parse(res.body).error.details?.fields as Record<string, string>;
    expect(Object.keys(fields).sort()).toEqual(['(body)', 'orgName', 'orgType'].sort());
  });

  it('ghi nhật ký audit trong cùng transaction', async () => {
    const res = await bootstrap({ orgType: 'trader', orgName: 'Vựa', name: 'Hùng' }).expect(200);
    const orgId = Me.parse(res.body).memberships[0]?.organization.id;
    const { rows } = await admin.query<{ action: string; actor_user_id: string; request_id: string }>(
      'select action, actor_user_id, request_id from audit_log where organization_id = $1',
      [orgId],
    );
    expect(rows).toEqual([
      { action: 'organization.bootstrapped', actor_user_id: USER_ID, request_id: res.headers['x-request-id'] },
    ]);
  });

  it('phiên đã bị thu hồi → 401, không ghi gì', async () => {
    const { ApiException } = await import('../../src/common/api-exception');
    users.failWith = new ApiException('UNAUTHENTICATED', 'Phiên đăng nhập không còn hiệu lực');
    await bootstrap({ orgType: 'trader', orgName: 'Vựa', name: 'Hùng' }).expect(401);
    expect((await admin.query('select id from organizations')).rowCount).toBe(0);
  });
});

describe('GET /v1/me và OrgContextGuard với membership thật', () => {
  it('/v1/me liệt kê mọi tổ chức của người dùng, kèm lời mời chờ', async () => {
    const vua = await createOrg('trader', USER_ID, 'Vựa của tôi');
    const ho = await createOrg('farmer', USER_ID, 'Hộ của tôi');
    await createOrg('trader', newId(), 'Vựa người khác');
    const supplierInOtherBook = await createSupplier(await createOrg('trader', newId(), 'Vựa X'), '0912345678');
    await admin.query(
      `insert into partner_links (owner_org_id, partner_kind, partner_id, linked_org_id, status)
       select organization_id, 'supplier', id, $1, 'pending' from suppliers where id = $2`,
      [ho, supplierInOtherBook],
    );

    const res = await http().get('/v1/me').set('authorization', `Bearer ${token}`).expect(200);
    const me = Me.parse(res.body);
    expect(me.memberships.map((m) => m.organization.id).sort()).toEqual([vua, ho].sort());
    expect(me.pendingLinks).toBe(1);
  });

  it('thành viên → qua; tổ chức người khác → 403 NOT_A_MEMBER; nông dân không có book:sync → 403', async () => {
    const mine = await createOrg('trader', USER_ID);
    const farm = await createOrg('farmer', USER_ID);
    const theirs = await createOrg('trader', newId());
    const ping = (org: string) =>
      http().get('/v1/test/org-ping').set('authorization', `Bearer ${token}`).set('x-organization-id', org);

    await ping(mine).expect(200);
    expect(ErrorBody.parse((await ping(theirs).expect(403)).body).error.code).toBe('NOT_A_MEMBER');
    expect(ErrorBody.parse((await ping(farm).expect(403)).body).error.code).toBe('FORBIDDEN');
  });

  it('membership bị gỡ hoặc tổ chức đã xoá → NOT_A_MEMBER', async () => {
    const removed = await createOrg('trader', USER_ID);
    await admin.query(`update memberships set status = 'removed' where organization_id = $1`, [removed]);
    const deleted = await createOrg('trader', USER_ID);
    await admin.query('update organizations set deleted_at = now() where id = $1', [deleted]);

    for (const org of [removed, deleted]) {
      await http()
        .get('/v1/test/org-ping')
        .set('authorization', `Bearer ${token}`)
        .set('x-organization-id', org)
        .expect(403);
    }
  });
});

describe('POST /v1/auth/resolve-identifier', () => {
  const resolve = (identifier: string) => http().post('/v1/auth/resolve-identifier').send({ identifier });

  beforeEach(async () => {
    const hung = newId();
    await admin.query(
      `insert into profiles (id, name, username, phone, recovery_email) values ($1, 'Hùng', 'vuatuhung', '+84912345678', 'hung@gmail.com')`,
      [hung],
    );
    supabaseAdmin.emails.set(hung, 'hung-login@gmail.com');
  });

  it('tìm thấy theo tên / SĐT / email khôi phục → email đăng nhập thật', async () => {
    for (const id of ['VuaTuHung', '0912 345 678', 'hung@gmail.com']) {
      expect((await resolve(id).expect(200)).body, id).toEqual({ email: 'hung-login@gmail.com' });
    }
  });

  it('không có tài khoản → vẫn 200 với email cùng hình dạng, không lộ gì', async () => {
    expect((await resolve('0987 654 321').expect(200)).body).toEqual({ email: '84987654321@id.thumua365.vn' });
    expect((await resolve('lan@gmail.com').expect(200)).body).toEqual({ email: 'lan@gmail.com' });
    expect((await resolve('khongcoai').expect(200)).body.email).toMatch(/^849\d{8}@id\.thumua365\.vn$/);
  });

  it('không cần đăng nhập; thân sai → 422', async () => {
    await http().post('/v1/auth/resolve-identifier').send({}).expect(422);
  });
});

describe('POST /v1/links/discover', () => {
  let farmOrg: string;
  const discover = () =>
    http().post('/v1/links/discover').set('authorization', `Bearer ${token}`).set('x-organization-id', farmOrg);

  beforeEach(async () => {
    farmOrg = await createOrg('farmer', USER_ID, 'Hộ cô Mai');
    await createSupplier(await createOrg('trader', newId(), 'Vựa A'), '0912 345 678');
    await createSupplier(await createOrg('trader', newId(), 'Vựa B'), '+84 912 345 678');
  });

  it('🔴 số chưa xác thực OTP → 403 PHONE_NOT_VERIFIED, không tạo lời mời nào', async () => {
    users.account = { ...users.account, phone_confirmed_at: null };
    const res = await discover().expect(403);
    expect(ErrorBody.parse(res.body).error.code).toBe('PHONE_NOT_VERIFIED');
    expect((await admin.query('select id from partner_links')).rowCount).toBe(0);
  });

  it('số đã xác thực → lời mời từ mọi vựa có số đó; gọi lại không tạo trùng', async () => {
    expect((await discover().expect(200)).body).toEqual({ created: 2, pending: 2 });
    expect((await discover().expect(200)).body).toEqual({ created: 0, pending: 2 });
  });

  it('không có tổ chức / không phải thành viên → chặn trước khi dò', async () => {
    await http().post('/v1/links/discover').set('authorization', `Bearer ${token}`).expect(422);
    await http()
      .post('/v1/links/discover')
      .set('authorization', `Bearer ${token}`)
      .set('x-organization-id', await createOrg('farmer', newId()))
      .expect(403);
    expect((await admin.query('select id from partner_links')).rowCount).toBe(0);
  });
});
