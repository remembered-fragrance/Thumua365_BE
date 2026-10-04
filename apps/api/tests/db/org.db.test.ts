/**
 * BE7 trên Postgres thật — đúng "Xong khi" của KH: doanh nghiệp hai chi nhánh, mỗi nơi một người cân
 * (chủ tạo tài khoản) — mỗi người chỉ thấy phiếu chi nhánh mình; chủ thấy tổng khớp hai chi nhánh
 * cộng lại; tạo chi nhánh thứ N+1 → BRANCH_LIMIT. Cộng: ai sửa / gỡ được ai, gỡ là mất quyền ngay,
 * thêm lại người cũ, số đã có tài khoản, báo cáo của nông dân, luật `owner` ở database.
 * Chỉ Supabase Auth Admin là giả (tạo tài khoản).
 */

import {
  ErrorBody,
  OrgBranch,
  OrgBranchesList,
  OrgMember,
  OrgMembersList,
  ReportSummary,
  SyncPullResult,
  SyncPushResult,
} from '@mambo/contracts';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaMemberships } from '../../src/auth/prisma-memberships';
import { Database } from '../../src/db/database';
import { FakeSupabaseAdmin, buildTestApp, makeSigner, testEnv } from '../helpers';
import { SERVICE_URL, admin, asService, createOrg, createSupplier, newId, service, serviceError, truncateAll } from './db';
import { NOW, opMaker, paymentData, rubberLine, txData } from './sync-fixture';

let app: INestApplication;
let auth: FakeSupabaseAdmin;
let signer: Awaited<ReturnType<typeof makeSigner>>;

let dn: string;
let dnOwner: string;
let vua: string;
let vuaOwner: string;

beforeAll(async () => {
  signer = await makeSigner();
  auth = new FakeSupabaseAdmin();
  const db = new Database(SERVICE_URL);
  app = await buildTestApp({
    env: testEnv({ DATABASE_URL: SERVICE_URL, RATE_LIMIT_PER_MINUTE: '10000' }),
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
  const withAuth = <T extends request.Test>(r: T) => r.set('authorization', `Bearer ${token}`).set('x-organization-id', orgId);
  const http = () => request(app.getHttpServer());
  return {
    get: (path: string, query: Record<string, string | number> = {}) => withAuth(http().get(path).query(query)),
    post: (path: string, body: object = {}) => withAuth(http().post(path).send(body)),
    patch: (path: string, body: object) => withAuth(http().patch(path).send(body)),
    del: (path: string) => withAuth(http().delete(path)),
    push: (ops: unknown[]) => withAuth(http().post('/v1/sync/push').send({ deviceId: newId(), ops })),
    pull: () => withAuth(http().get('/v1/sync/pull')),
  };
};

/** Gói doanh nghiệp đang dùng thử, tối đa `limit` chi nhánh. */
const givePlan = async (orgId: string, limit: number | null) => {
  await admin.query(
    `insert into subscriptions (organization_id, status, trial_ends_at, branch_limit) values ($1, 'trialing', now() + interval '30 days', $2)`,
    [orgId, limit],
  );
};

const RANGE = { from: '2026-09-01T00:00:00+07:00', to: '2026-10-01T00:00:00+07:00' };

beforeEach(async () => {
  await truncateAll();
  auth.emails.clear();
  dnOwner = newId();
  vuaOwner = newId();
  dn = await createOrg('enterprise', dnOwner, 'Công ty Cao su Bình Long');
  await givePlan(dn, 2);
  vua = await createOrg('trader', vuaOwner, 'Vựa Tư Hùng');
  await givePlan(vua, null);
});

describe('luồng nghiệm thu BE7', () => {
  it('hai chi nhánh, mỗi nơi một người cân → mỗi người chỉ thấy phiếu chi nhánh mình; chủ thấy tổng khớp; chi nhánh thứ 3 → BRANCH_LIMIT', async () => {
    const owner = await as(dnOwner, dn);

    // 1. Hai chi nhánh — vừa đủ gói; cái thứ ba bị chặn.
    const a = OrgBranch.parse((await owner.post('/v1/org/branches', { name: 'Trạm Lộc Ninh' }).expect(200)).body);
    const b = OrgBranch.parse((await owner.post('/v1/org/branches', { name: 'Trạm Bù Đốp', address: 'Ấp 3' }).expect(200)).body);
    const third = await owner.post('/v1/org/branches', { name: 'Trạm Hớn Quản' }).expect(402);
    expect(ErrorBody.parse(third.body).error).toMatchObject({ code: 'BRANCH_LIMIT', details: { limit: 2 } });

    // 2. Chủ tạo tài khoản cho hai người cân.
    const an = OrgMember.parse(
      (await owner.post('/v1/org/members', { name: 'Anh An', phone: '0901 111 111', password: 'matkhau-an', role: 'staff', branchId: a.id }).expect(200)).body,
    );
    const binh = OrgMember.parse(
      (await owner.post('/v1/org/members', { name: 'Chị Bình', phone: '0902 222 222', password: 'matkhau-binh', role: 'staff', branchId: b.id }).expect(200))
        .body,
    );
    expect(an).toMatchObject({ name: 'Anh An', phone: '+84901111111', role: 'staff', status: 'active', branch: { id: a.id, name: 'Trạm Lộc Ninh' } });
    expect(auth.emails.get(an.userId)).toBe('84901111111@id.thumua365.vn');
    expect(auth.passwords.get(an.userId)).toBe('matkhau-an');

    const branches = OrgBranchesList.parse((await owner.get('/v1/org/branches').expect(200)).body);
    expect(branches).toMatchObject({ limit: 2, used: 2 });
    expect(branches.branches.map((x) => x.memberCount)).toEqual([1, 1]);

    // 3. Mỗi người cân ghi phiếu — chi nhánh do server điền theo người ghi.
    const anApi = await as(an.userId, dn);
    const binhApi = await as(binh.userId, dn);
    const anTx = newId();
    const binhTx = newId();
    const opA = opMaker();
    const opB = opMaker();
    await anApi.push([opA('transaction', 'insert', anTx, txData()), opA('payment', 'insert', newId(), paymentData(anTx, 400_000))]).expect(200);
    const binhLine = rubberLine({ grossWeight: 200 }); // 200kg × 30% × 47.940 = 2.876.400 → 2.876.000
    const pushedB = SyncPushResult.parse((await binhApi.push([opB('transaction', 'insert', binhTx, txData({ lines: [binhLine] }))]).expect(200)).body);
    expect(pushedB.results[0]?.status).toBe('applied');

    // 4. Mỗi người chỉ thấy phiếu chi nhánh mình.
    const pulledA = SyncPullResult.parse((await anApi.pull().expect(200)).body);
    const pulledB = SyncPullResult.parse((await binhApi.pull().expect(200)).body);
    expect(pulledA.changes.transactions.map((t) => t.id)).toEqual([anTx]);
    expect(pulledB.changes.transactions.map((t) => t.id)).toEqual([binhTx]);

    // 5. Chủ thấy tổng khớp hai chi nhánh cộng lại.
    const report = ReportSummary.parse((await owner.get('/v1/reports/summary', RANGE).expect(200)).body);
    expect(report.totals.purchase).toEqual({ count: 2, netWeight: 90, amount: 1_438_000 + 2_876_000, paid: 400_000, debt: 1_038_000 + 2_876_000 });
    expect(report.branches.map((x) => [x.branch?.name, x.figures.purchase.amount])).toEqual([
      ['Trạm Bù Đốp', 2_876_000],
      ['Trạm Lộc Ninh', 1_438_000],
    ]);
    const sum = report.branches.reduce((s, x) => s + x.figures.purchase.amount, 0);
    expect(sum).toBe(report.totals.purchase.amount);

    const onlyA = ReportSummary.parse((await owner.get('/v1/reports/summary', { ...RANGE, branchId: a.id }).expect(200)).body);
    expect(onlyA.totals.purchase.amount).toBe(1_438_000);

    // Người cân của DN không có quyền xem báo cáo.
    await anApi.get('/v1/reports/summary', RANGE).expect(403);
  });
});

describe('quản lý gắn chi nhánh', () => {
  it('chỉ thấy báo cáo chi nhánh mình; xin chi nhánh khác → 403', async () => {
    const owner = await as(dnOwner, dn);
    const a = OrgBranch.parse((await owner.post('/v1/org/branches', { name: 'A' }).expect(200)).body);
    const b = OrgBranch.parse((await owner.post('/v1/org/branches', { name: 'B' }).expect(200)).body);
    const manager = OrgMember.parse(
      (await owner.post('/v1/org/members', { name: 'Quản lý A', phone: '0903 333 333', password: 'matkhau-ql', role: 'manager', branchId: a.id }).expect(200))
        .body,
    );
    await admin.query(
      `insert into transactions (id, organization_id, branch_id, created_by, date, kind, supplier_name, lines)
       values ($1, $2, $3, $4, $5, 'purchase', 'x', $6), ($7, $2, $8, $4, $5, 'purchase', 'y', $6)`,
      [newId(), dn, a.id, dnOwner, NOW, JSON.stringify([rubberLine()]), newId(), b.id],
    );
    const mApi = await as(manager.userId, dn);
    const mine = ReportSummary.parse((await mApi.get('/v1/reports/summary', RANGE).expect(200)).body);
    expect(mine.totals.purchase.count).toBe(1);
    expect(mine.branches.map((x) => x.branch?.id)).toEqual([a.id]);
    await mApi.get('/v1/reports/summary', { ...RANGE, branchId: b.id }).expect(403);
    // Quản lý không quản lý người, không tạo chi nhánh.
    await mApi.get('/v1/org/members').expect(403);
    await mApi.post('/v1/org/branches', { name: 'C' }).expect(403);
  });
});

describe('người trong tổ chức', () => {
  it('đổi vai trò / chi nhánh; không sửa được chủ hay chính mình; gỡ là mất quyền ngay; thêm lại giữ tài khoản cũ', async () => {
    const owner = await as(dnOwner, dn);
    const a = OrgBranch.parse((await owner.post('/v1/org/branches', { name: 'A' }).expect(200)).body);
    const staff = OrgMember.parse(
      (await owner.post('/v1/org/members', { name: 'Anh An', phone: '0901 111 111', password: 'matkhau-an', role: 'staff' }).expect(200)).body,
    );
    expect(staff.branch).toBeNull();

    const moved = OrgMember.parse((await owner.patch(`/v1/org/members/${staff.id}`, { role: 'manager', branchId: a.id }).expect(200)).body);
    expect(moved).toMatchObject({ role: 'manager', branch: { id: a.id } });

    const list = OrgMembersList.parse((await owner.get('/v1/org/members').expect(200)).body);
    const me = list.members.find((x) => x.isMe);
    expect(me).toMatchObject({ role: 'owner', userId: dnOwner });
    expect((await owner.patch(`/v1/org/members/${me?.id}`, { role: 'staff' }).expect(403)).body.error.code).toBe('FORBIDDEN');
    await owner.del(`/v1/org/members/${me?.id}`).expect(403);

    // Gỡ: người đó mất quyền ngay ở mọi endpoint của tổ chức.
    const staffApi = await as(staff.userId, dn);
    await staffApi.get('/v1/orders').expect(200);
    const removed = OrgMember.parse((await owner.del(`/v1/org/members/${staff.id}`).expect(200)).body);
    expect(removed.status).toBe('removed');
    expect(ErrorBody.parse((await staffApi.get('/v1/orders').expect(403)).body).error.code).toBe('NOT_A_MEMBER');
    await owner.del(`/v1/org/members/${staff.id}`).expect(200); // gọi lại an toàn
    await owner.patch(`/v1/org/members/${staff.id}`, { role: 'staff' }).expect(422);

    // Thêm lại cùng số: bật lại tài khoản cũ, không tạo tài khoản mới, không đổi mật khẩu.
    const created = auth.passwords.size;
    const back = OrgMember.parse(
      (await owner.post('/v1/org/members', { name: 'Anh An', phone: '0901111111', password: 'matkhau-moi', role: 'staff' }).expect(200)).body,
    );
    expect(back).toMatchObject({ id: staff.id, userId: staff.userId, status: 'active', role: 'staff', branch: null });
    expect(auth.passwords.size).toBe(created);
    expect(auth.passwords.get(staff.userId)).toBe('matkhau-an');
    const again = await owner.post('/v1/org/members', { name: 'Anh An', phone: '0901111111', password: 'matkhau-moi', role: 'staff' }).expect(422);
    expect(ErrorBody.parse(again.body).error.details).toMatchObject({ reason: 'ALREADY_MEMBER' });

    const { rows } = await admin.query(`select action from audit_log where organization_id = $1 and entity = 'membership' order by created_at`, [dn]);
    expect(rows.map((r) => r.action)).toEqual(['member.added', 'member.role_changed', 'member.removed', 'member.added']);
  });

  it('số đã có tài khoản ở nơi khác → ACCOUNT_EXISTS; vai trò không có ở loại tổ chức → 422; số sai → 422', async () => {
    const mai = newId();
    await createOrg('farmer', mai, 'Hộ cô Mai');
    await admin.query(`insert into profiles (id, name, phone) values ($1, 'Cô Mai', '+84912345678')`, [mai]);

    const vuaApi = await as(vuaOwner, vua);
    const taken = await vuaApi.post('/v1/org/members', { name: 'Cô Mai', phone: '0912345678', password: 'matkhau-12', role: 'staff' }).expect(422);
    expect(ErrorBody.parse(taken.body).error.details).toMatchObject({ reason: 'ACCOUNT_EXISTS' });
    await vuaApi.post('/v1/org/members', { name: 'X', phone: '0901 444 444', password: 'matkhau-12', role: 'manager' }).expect(422);
    await vuaApi.post('/v1/org/members', { name: 'X', phone: 'so-khong-hop-le', password: 'matkhau-12', role: 'staff' }).expect(422);
    await vuaApi.post('/v1/org/members', { name: 'X', phone: '0901 444 444', password: 'ngan', role: 'staff' }).expect(422);
    const ok = OrgMember.parse(
      (await vuaApi.post('/v1/org/members', { name: 'Người cân', phone: '0901 444 444', password: 'matkhau-12', role: 'staff' }).expect(200)).body,
    );
    // Người cân của vựa ghi được phiếu (cùng quyền như ma trận).
    const pushed = SyncPushResult.parse(
      (await (await as(ok.userId, vua)).push([opMaker()('transaction', 'insert', newId(), txData())]).expect(200)).body,
    );
    expect(pushed.results[0]?.status).toBe('applied');
  });

  it('🔴 bước database hỏng sau khi đã tạo tài khoản → tài khoản vừa tạo bị xoá', async () => {
    // Hồ sơ đã xoá mềm vẫn giữ số (UNIQUE) nhưng find_login_user bỏ qua → tạo tài khoản được, ghi hồ sơ vỡ.
    await admin.query(`insert into profiles (id, name, phone, deleted_at) values ($1, 'Cũ', '+84905555555', now())`, [newId()]);
    const owner = await as(dnOwner, dn);
    await owner.post('/v1/org/members', { name: 'Mới', phone: '0905 555 555', password: 'matkhau-12', role: 'staff' }).expect(500);
    expect(auth.deleted).toHaveLength(1);
    const { rows } = await admin.query(`select count(*)::int as n from memberships where organization_id = $1`, [dn]);
    expect(rows[0]?.n).toBe(1); // chỉ còn chủ
  });
});

describe('chi nhánh', () => {
  it('lưu trữ khi không còn ai gắn; dùng lại trong giới hạn của gói', async () => {
    const owner = await as(dnOwner, dn);
    const a = OrgBranch.parse((await owner.post('/v1/org/branches', { name: 'A' }).expect(200)).body);
    const staff = OrgMember.parse(
      (await owner.post('/v1/org/members', { name: 'An', phone: '0901 111 111', password: 'matkhau-12', role: 'staff', branchId: a.id }).expect(200)).body,
    );
    await owner.patch(`/v1/org/branches/${a.id}`, { archived: true }).expect(422);
    await owner.patch(`/v1/org/members/${staff.id}`, { branchId: null }).expect(200);
    const archived = OrgBranch.parse((await owner.patch(`/v1/org/branches/${a.id}`, { archived: true, name: 'A cũ' }).expect(200)).body);
    expect(archived).toMatchObject({ archived: true, name: 'A cũ', memberCount: 0 });
    // Không gắn được người vào chi nhánh đã lưu trữ.
    await owner.patch(`/v1/org/members/${staff.id}`, { branchId: a.id }).expect(422);

    await owner.post('/v1/org/branches', { name: 'B' }).expect(200);
    await owner.post('/v1/org/branches', { name: 'C' }).expect(200);
    const blocked = await owner.patch(`/v1/org/branches/${a.id}`, { archived: false }).expect(402);
    expect(ErrorBody.parse(blocked.body).error.code).toBe('BRANCH_LIMIT');
    expect(OrgBranchesList.parse((await owner.get('/v1/org/branches').expect(200)).body)).toMatchObject({ used: 2, limit: 2 });
  });

  it('hai người tạo cùng lúc không vượt được giới hạn', async () => {
    const owner = await as(dnOwner, dn);
    const results = await Promise.all([1, 2, 3, 4].map((i) => owner.post('/v1/org/branches', { name: `Trạm ${i}` })));
    expect(results.map((r) => r.status).sort()).toEqual([200, 200, 402, 402]);
  });
});

describe('báo cáo của nông dân', () => {
  it('phiếu vựa ghi về mình, lật chiều: vựa mua của mình = mình bán', async () => {
    const mai = newId();
    const farm = await createOrg('farmer', mai, 'Hộ cô Mai');
    const supplier = await createSupplier(vua, '0912 345 678', 'Cô Mai');
    await admin.query(
      `insert into partner_links (owner_org_id, partner_kind, partner_id, linked_org_id, invited_phone, status)
       values ($1, 'supplier', $2, $3, '+84912345678', 'active')`,
      [vua, supplier, farm],
    );
    const txId = newId();
    await admin.query(
      `insert into transactions (id, organization_id, created_by, date, kind, counterparty_id, supplier_name, lines)
       values ($1, $2, $3, $4, 'purchase', $5, 'Cô Mai', $6)`,
      [txId, vua, vuaOwner, NOW, supplier, JSON.stringify([rubberLine()])],
    );
    await admin.query(
      `insert into payments (id, organization_id, transaction_id, created_by, date, amount) values ($1, $2, $3, $4, now(), 438000)`,
      [newId(), vua, txId, vuaOwner],
    );
    const report = ReportSummary.parse((await (await as(mai, farm)).get('/v1/reports/summary', RANGE).expect(200)).body);
    expect(report.totals.sale).toEqual({ count: 1, netWeight: 30, amount: 1_438_000, paid: 438_000, debt: 1_000_000 });
    expect(report.totals.purchase.count).toBe(0);
    expect(report.branches).toEqual([]);
  });

  it('khoảng thời gian sai → 422', async () => {
    const owner = await as(dnOwner, dn);
    await owner.get('/v1/reports/summary', { from: RANGE.to, to: RANGE.from }).expect(422);
    await owner.get('/v1/reports/summary', { from: '2025-01-01T00:00:00Z', to: '2026-10-01T00:00:00Z' }).expect(422);
  });
});

describe('luật ở database', () => {
  it('🔴 api_service không nâng ai lên chủ, không đổi / gỡ chủ, không thêm chủ thứ hai', async () => {
    const staffId = newId();
    await admin.query(`insert into memberships (user_id, organization_id, role) values ($1, $2, 'staff')`, [staffId, dn]);
    const asOwner = { userId: dnOwner, orgId: dn };
    expect(await serviceError(asOwner, `update memberships set role = 'owner' where user_id = $1`, [staffId])).toMatch(/làm chủ/);
    expect(await serviceError(asOwner, `update memberships set role = 'manager' where user_id = $1`, [dnOwner])).toMatch(/chủ tổ chức/);
    expect(await serviceError(asOwner, `update memberships set status = 'removed' where user_id = $1`, [dnOwner])).toMatch(/chủ tổ chức/);
    expect(
      await serviceError(asOwner, `insert into memberships (user_id, organization_id, role) values ($1, $2, 'owner')`, [newId(), dn]),
    ).toMatch(/không thêm chủ/);
  });

  it('org_members() không trả gì cho người không thuộc tổ chức; create_member_profile chỉ chủ gọi được', async () => {
    const stranger = await asService({ userId: vuaOwner, orgId: dn }, (c) => c.query('select * from public.org_members()'));
    expect(stranger.rows).toEqual([]);
    const staffId = newId();
    await admin.query(`insert into memberships (user_id, organization_id, role) values ($1, $2, 'staff')`, [staffId, dn]);
    expect(
      await serviceError({ userId: staffId, orgId: dn }, `select public.create_member_profile($1, 'x', '0901111111')`, [newId()]),
    ).toMatch(/Chỉ chủ/);
  });
});
