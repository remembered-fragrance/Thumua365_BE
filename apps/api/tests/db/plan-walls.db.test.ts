/**
 * Đợt 1 của KE_HOACH_GOI_PRO trên Postgres thật — bức tường theo gói ở máy chủ:
 * hết gói không thêm người, không tải ảnh mới, không tạo / dùng lại chi nhánh (402 PLAN_REQUIRED);
 * vựa có gói tối đa 3 người cân (402 MEMBER_LIMIT). Và những gì KHÔNG được chặn (N2, N3, N7):
 * kéo sổ, xem ảnh cũ, đổi tên chi nhánh, người đang có giữ nguyên. Auth Admin và Storage là giả.
 */

import { ErrorBody, OrgBranch, OrgMember } from '@mambo/contracts';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaMemberships } from '../../src/auth/prisma-memberships';
import { Database } from '../../src/db/database';
import { FakeSupabaseAdmin, buildTestApp, makeSigner, testEnv } from '../helpers';
import { SERVICE_URL, admin, createOrg, newId, service, truncateAll } from './db';
import { addMember, createBranch, giveTrial } from './sync-fixture';

let app: INestApplication;
let auth: FakeSupabaseAdmin;
let signer: Awaited<ReturnType<typeof makeSigner>>;
// Tạo người giới hạn 20 lần/phút mỗi IP — mỗi test một IP, như account.db.test.
let clientIp = 0;

let vua: string;
let vuaOwner: string;
let dn: string;
let dnOwner: string;

beforeAll(async () => {
  signer = await makeSigner();
  auth = new FakeSupabaseAdmin();
  const db = new Database(SERVICE_URL);
  app = await buildTestApp({
    env: testEnv({ DATABASE_URL: SERVICE_URL, RATE_LIMIT_PER_MINUTE: '10000', CLIENT_IP_HEADER: 'cf-connecting-ip' }),
    jwks: signer.jwks,
    supabaseAdmin: auth,
    db,
    memberships: new PrismaMemberships(db),
  });
});

afterAll(async () => {
  await app.close();
  await admin.end();
  await service.end();
});

const as = async (userId: string, orgId: string) => {
  const token = await signer.sign({ sub: userId });
  const ip = `10.0.0.${clientIp}`;
  const authed = <T extends request.Test>(r: T) =>
    r.set('authorization', `Bearer ${token}`).set('x-organization-id', orgId).set('cf-connecting-ip', ip);
  const http = () => request(app.getHttpServer());
  return {
    get: (path: string) => authed(http().get(path)),
    post: (path: string, body: object) => authed(http().post(path).send(body)),
    patch: (path: string, body: object) => authed(http().patch(path).send(body)),
    del: (path: string) => authed(http().delete(path)),
  };
};

let phoneSeq = 0;
const staffInput = () => ({ name: `Người cân ${++phoneSeq}`, phone: `0903 ${String(100_000 + phoneSeq)}`, password: 'matkhau-12', role: 'staff' });
const photo = () => ({ attachmentId: newId(), contentType: 'image/jpeg', size: 480_000 });

/** Dùng thử đã hết: bậc `free`. */
const expire = (orgId: string) =>
  admin.query(`update subscriptions set trial_ends_at = now() - interval '1 day' where organization_id = $1`, [orgId]);

const errorOf = (res: request.Response) => ErrorBody.parse(res.body).error;

beforeEach(async () => {
  await truncateAll();
  clientIp += 1;
  auth.emails.clear();
  auth.passwords.clear();
  auth.deleted.length = 0;
  vuaOwner = newId();
  dnOwner = newId();
  vua = await createOrg('trader', vuaOwner, 'Vựa Tư Hùng');
  await giveTrial(vua);
  dn = await createOrg('enterprise', dnOwner, 'Công ty Cao su Bình Long');
  await giveTrial(dn);
});

describe('hết gói — chặn thêm mới ở máy chủ', () => {
  it('vựa hết gói: không thêm người cân, không xin URL tải ảnh; người cân đang có vẫn kéo sổ và xem ảnh cũ', async () => {
    const staff = newId();
    await addMember(vua, staff, 'staff');
    await expire(vua);
    const owner = await as(vuaOwner, vua);

    const add = await owner.post('/v1/org/members', staffInput()).expect(402);
    expect(errorOf(add)).toMatchObject({ code: 'PLAN_REQUIRED', details: { entitlement: 'members:add' } });
    expect(auth.passwords.size).toBe(0); // chặn trước khi tạo tài khoản

    const staffApi = await as(staff, vua);
    const upload = await staffApi.post('/v1/attachments/upload-url', photo()).expect(402);
    expect(errorOf(upload)).toMatchObject({ code: 'PLAN_REQUIRED', details: { entitlement: 'attachments' } });

    // N2: vẫn đọc sổ, vẫn xin URL xem ảnh (404 vì không phiếu nào nhắc tới — không phải 402).
    await staffApi.get('/v1/sync/pull').expect(200);
    expect(errorOf(await staffApi.get(`/v1/attachments/${newId()}/url`).expect(404)).code).toBe('NOT_FOUND');
    // N7: người đang có giữ nguyên.
    expect((await owner.get('/v1/org/members').expect(200)).body.members).toHaveLength(2);
  });

  it('doanh nghiệp hết gói: không tạo, không dùng lại chi nhánh; đổi tên và lưu trữ vẫn được', async () => {
    const owner = await as(dnOwner, dn);
    const kept = OrgBranch.parse((await owner.post('/v1/org/branches', { name: 'Trạm Lộc Ninh' }).expect(200)).body);
    const archived = OrgBranch.parse((await owner.post('/v1/org/branches', { name: 'Trạm Bù Đốp' }).expect(200)).body);
    await owner.patch(`/v1/org/branches/${archived.id}`, { archived: true }).expect(200);
    await expire(dn);

    const create = await owner.post('/v1/org/branches', { name: 'Trạm Hớn Quản' }).expect(402);
    expect(errorOf(create)).toMatchObject({ code: 'PLAN_REQUIRED', details: { entitlement: 'branches:add' } });
    const reopen = await owner.patch(`/v1/org/branches/${archived.id}`, { archived: false }).expect(402);
    expect(errorOf(reopen).code).toBe('PLAN_REQUIRED');

    const renamed = OrgBranch.parse((await owner.patch(`/v1/org/branches/${kept.id}`, { name: 'Trạm Lộc Ninh 2' }).expect(200)).body);
    expect(renamed.name).toBe('Trạm Lộc Ninh 2');
    await owner.patch(`/v1/org/branches/${kept.id}`, { archived: true }).expect(200);
  });

  it('doanh nghiệp hết gói: không thêm quản lý / nhân viên', async () => {
    await expire(dn);
    const res = await (await as(dnOwner, dn)).post('/v1/org/members', { ...staffInput(), role: 'manager' }).expect(402);
    expect(errorOf(res).code).toBe('PLAN_REQUIRED');
  });

  it('chưa có gói nào cũng là hết gói', async () => {
    await admin.query('delete from subscriptions where organization_id = $1', [vua]);
    expect(errorOf(await (await as(vuaOwner, vua)).post('/v1/org/members', staffInput()).expect(402)).code).toBe('PLAN_REQUIRED');
  });

  it('ân hạn vẫn thêm người được; trả tiền lại là mở ngay', async () => {
    await admin.query(
      `update subscriptions set status = 'active', trial_ends_at = null, current_period_end = now() - interval '1 day' where organization_id = $1`,
      [vua],
    );
    const owner = await as(vuaOwner, vua);
    await owner.post('/v1/org/members', staffInput()).expect(200);

    await admin.query(`update subscriptions set current_period_end = now() - interval '30 days' where organization_id = $1`, [vua]);
    await owner.post('/v1/org/members', staffInput()).expect(402);
    await admin.query(`update subscriptions set current_period_end = now() + interval '30 days' where organization_id = $1`, [vua]);
    await owner.post('/v1/org/members', staffInput()).expect(200);
  });
});

describe('vựa tối đa 3 người cân', () => {
  it('người thứ 4 → MEMBER_LIMIT, không còn tài khoản thừa; gỡ một người thì thêm được', async () => {
    const owner = await as(vuaOwner, vua);
    const added: OrgMember[] = [];
    for (let i = 0; i < 3; i++) added.push(OrgMember.parse((await owner.post('/v1/org/members', staffInput()).expect(200)).body));

    const fourth = await owner.post('/v1/org/members', staffInput()).expect(402);
    expect(errorOf(fourth)).toMatchObject({ code: 'MEMBER_LIMIT', details: { limit: 3 } });
    expect(auth.deleted).toHaveLength(1); // tài khoản Auth vừa tạo cho người thứ 4 đã bị xoá

    await owner.del(`/v1/org/members/${added[0]?.id}`).expect(200);
    await owner.post('/v1/org/members', staffInput()).expect(200);
  });

  it('bật lại người cũ khi đã đủ 3 → MEMBER_LIMIT', async () => {
    const owner = await as(vuaOwner, vua);
    const first = staffInput();
    const old = OrgMember.parse((await owner.post('/v1/org/members', first).expect(200)).body);
    await owner.del(`/v1/org/members/${old.id}`).expect(200);
    for (let i = 0; i < 3; i++) await owner.post('/v1/org/members', staffInput()).expect(200);

    const back = await owner.post('/v1/org/members', first).expect(402);
    expect(errorOf(back)).toMatchObject({ code: 'MEMBER_LIMIT', details: { limit: 3 } });
  });

  it('hai lần bấm "Thêm" cùng lúc khi còn một chỗ → chỉ một lần qua', async () => {
    const owner = await as(vuaOwner, vua);
    for (let i = 0; i < 2; i++) await owner.post('/v1/org/members', staffInput()).expect(200);
    const [a, b] = await Promise.all([owner.post('/v1/org/members', staffInput()), owner.post('/v1/org/members', staffInput())]);
    expect([a.status, b.status].sort()).toEqual([200, 402]);
    const { rows } = await admin.query(`select count(*)::int as n from memberships where organization_id = $1 and role <> 'owner' and status = 'active'`, [vua]);
    expect(rows[0]?.n).toBe(3);
  });

  it('doanh nghiệp không giới hạn số người theo gói', async () => {
    const owner = await as(dnOwner, dn);
    const branch = await createBranch(dn, 'Trạm Lộc Ninh');
    for (let i = 0; i < 4; i++) await owner.post('/v1/org/members', { ...staffInput(), branchId: branch }).expect(200);
  });
});
