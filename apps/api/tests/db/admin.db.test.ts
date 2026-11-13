/**
 * Trang quản trị đầy đủ (0.32.0) trên Postgres thật: tổng quan, tổ chức, cờ tính năng, mã sáng lập, người dùng,
 * phản hồi, nhật ký. Mọi route chỉ quản trị viên gọi được; xem dữ liệu của ai / đổi gì đều vào `admin_access_log`.
 */

import {
  AdminAccessLog,
  AdminFeatures,
  AdminFeedback,
  AdminFunnel,
  AdminOrganizationDetail,
  AdminOrganizations,
  AdminOverview,
  AdminPromoCodes,
  AdminPromoRow,
  AdminRenameResult,
  AdminUserDetail,
  AdminUsers,
  ErrorBody,
} from '@mambo/contracts';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaMemberships } from '../../src/auth/prisma-memberships';
import { Database } from '../../src/db/database';
import { PrivilegedDatabase } from '../../src/db/privileged-database';
import { FakeSupabaseAdmin, buildTestApp, makeSigner, testEnv } from '../helpers';
import { SERVICE_URL, admin, createOrg, createSupplier, newId, service, truncateAll } from './db';

const PRIVILEGED_URL =
  process.env.TEST_DATABASE_PRIVILEGED_URL ?? 'postgresql://api_privileged:api_privileged_dev@localhost:54329/thumua365';
const ADMIN_ID = '3f9b8c7d-6e5a-4b3c-9d2e-1f0a9b8c7d6e';

let app: INestApplication;
const fakeAuth = new FakeSupabaseAdmin();
let signer: Awaited<ReturnType<typeof makeSigner>>;

beforeAll(async () => {
  signer = await makeSigner();
  const db = new Database(SERVICE_URL);
  app = await buildTestApp({
    env: testEnv({ DATABASE_URL: SERVICE_URL, PRIVILEGED_DATABASE_URL: PRIVILEGED_URL, ADMIN_USER_IDS: ADMIN_ID, RATE_LIMIT_PER_MINUTE: '10000' }),
    jwks: signer.jwks,
    supabaseAdmin: fakeAuth,
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
    get: (path: string, query: object = {}) => authed(http().get(path).query(query)),
    post: (path: string, body: object = {}) => authed(http().post(path).send(body)),
    patch: (path: string, body: object = {}) => authed(http().patch(path).send(body)),
    delete: (path: string, query: object = {}) => authed(http().delete(path).query(query)),
  };
};

const logActions = async () =>
  (await admin.query<{ action: string; organization_id: string | null }>('select action, organization_id from admin_access_log order by created_at')).rows;

let vua: string;
let vuaOwner: string;
let farm: string;
let farmer: string;
let dn: string;

beforeEach(async () => {
  await truncateAll();
  vuaOwner = newId();
  farmer = newId();
  vua = await createOrg('trader', vuaOwner, 'Vựa Tư Hùng');
  farm = await createOrg('farmer', farmer, 'Hộ cô Mai');
  dn = await createOrg('enterprise', newId(), 'Công ty Bình Long');
  await admin.query(`insert into profiles (id, name, phone, username) values ($1, 'Anh Hùng', '+84905112233', 'tuhung'), ($2, 'Cô Mai', '+84907000111', null)`, [
    vuaOwner,
    farmer,
  ]);
  // Vựa đang trả tiền (gói Vựa còn 20 ngày); doanh nghiệp dùng thử còn 3 ngày.
  await admin.query(
    `insert into subscriptions (organization_id, status, current_period_end, plan) values ($1, 'active', now() + interval '20 days', 'vua')`,
    [vua],
  );
  await admin.query(`insert into subscriptions (organization_id, status, trial_ends_at) values ($1, 'trialing', now() + interval '3 days')`, [dn]);
});

describe('chỉ quản trị viên', () => {
  it('người thường (kể cả chủ tổ chức) → 403 ở mọi route mới; không ghi nhật ký', async () => {
    const owner = await as(vuaOwner);
    await owner.get('/v1/admin/overview').expect(403);
    await owner.get('/v1/admin/organizations').expect(403);
    await owner.get(`/v1/admin/organizations/${vua}`).expect(403);
    await owner.patch(`/v1/admin/organizations/${vua}/features`, { feature: 'orders', enabled: false, approvedBy: 'Tôi' }).expect(403);
    await owner.get('/v1/admin/promo-codes').expect(403);
    await owner.get('/v1/admin/users', { q: 'Hùng' }).expect(403);
    await owner.get(`/v1/admin/users/${vuaOwner}`).expect(403);
    await owner.patch(`/v1/admin/users/${vuaOwner}`, { name: 'X', approvedBy: 'Tôi' }).expect(403);
    await owner.patch(`/v1/admin/organizations/${vua}`, { name: 'X', approvedBy: 'Tôi' }).expect(403);
    await owner.get('/v1/admin/access-log').expect(403);
    expect(await logActions()).toEqual([]);
  });
});

describe('tổng quan', () => {
  it('đếm tổ chức theo loại, bậc gói, doanh thu đã mở gói, tiền kẹt, phản hồi', async () => {
    await admin.query(
      `insert into bank_transactions (bank_tx_id, organization_id, amount, source, outcome, created_at)
       values ('FT-1', $1, 449000, 'webhook', 'applied', now() - interval '2 days'),
              ('FT-2', $1, 199000, 'admin', 'applied', now() - interval '60 days'),
              ('FT-3', $1, 100000, 'webhook', 'underpaid', now())`,
      [vua],
    );
    await admin.query(`insert into feedback (organization_id, user_id, rating, platform) values ($1, $2, 5, 'web'), ($1, $2, 4, 'pwa')`, [vua, vuaOwner]);

    // Tài khoản quản trị cũng có một tổ chức (để qua cổng của app) — không phải khách, không tính.
    await createOrg('farmer', ADMIN_ID, 'Hộ Admin');
    await admin.query(`insert into profiles (id, name, phone) values ($1, 'Admin', '+84868512408')`, [ADMIN_ID]);

    const o = AdminOverview.parse((await (await as(ADMIN_ID)).get('/v1/admin/overview').expect(200)).body);
    expect(o.organizations).toEqual({ total: 3, farmer: 1, trader: 1, enterprise: 1 });
    expect(o.newOrganizations).toEqual({ last7Days: 3, last30Days: 3 });
    expect(o.signupsByDay).toHaveLength(30);
    expect(o.signupsByDay.at(-1)?.count).toBe(3);
    expect(o.users).toBe(2);
    expect(o.plans).toEqual({ trial: 1, premium: 1, grace: 0, free: 0 });
    expect(o.premiumByPlan).toEqual({ thuong_lai: 0, vua: 1, enterprise: 0 });
    expect(o.expiringSoon).toBe(1);
    expect(o.revenue.total).toBe(648_000);
    expect(o.revenue.last30Days).toBe(449_000);
    expect(o.revenue.byMonth.reduce((s, m) => s + m.count, 0)).toBe(2);
    expect(o.payments).toEqual({ needsReview: 1, pendingIntents: 0 });
    expect(o.feedback).toEqual({ count: 2, averageRating: 4.5 });
    // Chỉ số đếm — không ghi nhật ký.
    expect(await logActions()).toEqual([]);
  });
});

describe('phễu', () => {
  it('0.33.1: sự kiện của tổ chức quản trị không tính; sự kiện chưa đăng nhập vẫn tính', async () => {
    const adminOrg = await createOrg('farmer', ADMIN_ID, 'Hộ Admin');
    await admin.query(
      `insert into analytics_events (organization_id, org_type, anon_id, name, props, platform)
       values ($1, 'farmer', 'may-admin', 'app_opened', '{}', 'web'),
              ($2, 'trader', 'may-vua', 'app_opened', '{}', 'web'),
              (null, null, 'may-la', 'app_opened', '{}', 'web')`,
      [adminOrg, vua],
    );
    const range = { from: '2026-01-01T00:00:00Z', to: new Date(Date.now() + 60_000).toISOString() };
    const funnel = AdminFunnel.parse((await (await as(ADMIN_ID)).get('/v1/admin/funnel', range).expect(200)).body);
    expect(funnel.rows.map((r) => `${r.orgType}:${r.name}:${r.events}`).sort()).toEqual(['null:app_opened:1', 'trader:app_opened:1']);
  });
});

describe('tổ chức', () => {
  it('danh sách: mới trước, kèm chủ, số người, gói, cờ; tìm theo tên / số của chủ; lọc loại; ghi nhật ký', async () => {
    await admin.query(`insert into organization_features (organization_id, feature) values ($1, 'orders'), ($1, 'links')`, [vua]);
    const api = await as(ADMIN_ID);
    const all = AdminOrganizations.parse((await api.get('/v1/admin/organizations').expect(200)).body);
    expect(all.rows.map((r) => r.name)).toEqual(['Công ty Bình Long', 'Hộ cô Mai', 'Vựa Tư Hùng']);
    const row = all.rows.find((r) => r.id === vua);
    expect(row).toMatchObject({
      type: 'trader',
      owner: { userId: vuaOwner, name: 'Anh Hùng', phone: '+84905112233' },
      members: 1,
      plan: { tier: 'premium', plan: 'vua' },
      features: ['links', 'orders'],
    });
    expect(all.rows.find((r) => r.id === farm)?.plan).toBeNull();

    const byPhone = AdminOrganizations.parse((await api.get('/v1/admin/organizations', { q: '0905 112' }).expect(200)).body);
    expect(byPhone.rows.map((r) => r.id)).toEqual([vua]);
    const byName = AdminOrganizations.parse((await api.get('/v1/admin/organizations', { q: 'bình long' }).expect(200)).body);
    expect(byName.rows.map((r) => r.id)).toEqual([dn]);
    const farmers = AdminOrganizations.parse((await api.get('/v1/admin/organizations', { type: 'farmer' }).expect(200)).body);
    expect(farmers.rows.map((r) => r.id)).toEqual([farm]);
    // `%` người dùng gõ là chữ, không phải ký tự đại diện.
    const literal = AdminOrganizations.parse((await api.get('/v1/admin/organizations', { q: '%' }).expect(200)).body);
    expect(literal.rows).toEqual([]);

    expect((await logActions()).map((l) => l.action)).toEqual(Array(5).fill('list-organizations'));
  });

  it('chi tiết: gói, thành viên, cờ, mã sáng lập, mức dùng sổ, giao dịch; không có → 404; ghi nhật ký', async () => {
    await admin.query(`insert into organization_features (organization_id, feature) values ($1, 'orders')`, [vua]);
    await admin.query(
      `insert into promo_codes (code, plan, monthly_amount, periods, periods_used, organization_id, redeemed_by, redeemed_at)
       values ('SANGLAP-01', 'thuong_lai', 149000, 12, 2, $1, $2, now())`,
      [vua, vuaOwner],
    );
    await admin.query(`insert into bank_transactions (bank_tx_id, organization_id, amount, source) values ('FT-9', $1, 449000, 'admin')`, [vua]);
    await createSupplier(vua, null, 'Nông hộ A');

    const api = await as(ADMIN_ID);
    const d = AdminOrganizationDetail.parse((await api.get(`/v1/admin/organizations/${vua}`).expect(200)).body);
    expect(d).toMatchObject({
      id: vua,
      name: 'Vựa Tư Hùng',
      type: 'trader',
      plan: { tier: 'premium', plan: 'vua' },
      subscription: { status: 'active', plan: 'vua', extraStaff: 0 },
      members: [{ userId: vuaOwner, name: 'Anh Hùng', phone: '+84905112233', username: 'tuhung', role: 'owner', status: 'active', branch: null }],
      features: ['orders'],
      promo: { code: 'SANGLAP-01', periodsUsed: 2, organization: { id: vua } },
      usage: { transactions: 0, suppliers: 1, buyers: 0, products: 0, orders: 0, lastActivityAt: null },
      payments: [{ bank: { bankTxId: 'FT-9', amount: 449_000, source: 'admin', outcome: 'applied' }, intent: null }],
    });

    const f = AdminOrganizationDetail.parse((await api.get(`/v1/admin/organizations/${farm}`).expect(200)).body);
    expect(f).toMatchObject({ type: 'farmer', plan: null, subscription: null, promo: null, payments: [] });

    await api.get(`/v1/admin/organizations/${newId()}`).expect(404);
    expect(await logActions()).toEqual([
      { action: 'view-organization', organization_id: vua },
      { action: 'view-organization', organization_id: farm },
    ]);
  });

  it('cờ tính năng: bật / tắt, gọi lại an toàn, cần người duyệt; tổ chức lạ → 404', async () => {
    const api = await as(ADMIN_ID);
    const path = `/v1/admin/organizations/${vua}/features`;
    const on = AdminFeatures.parse((await api.patch(path, { feature: 'orders', enabled: true, approvedBy: 'Tài' }).expect(200)).body);
    expect(on.features).toEqual(['orders']);
    const again = AdminFeatures.parse((await api.patch(path, { feature: 'orders', enabled: true, approvedBy: 'Tài' }).expect(200)).body);
    expect(again.features).toEqual(['orders']);
    const off = AdminFeatures.parse((await api.patch(path, { feature: 'orders', enabled: false, approvedBy: 'Tài', reason: 'Thử tắt' }).expect(200)).body);
    expect(off.features).toEqual([]);

    await api.patch(path, { feature: 'orders', enabled: true }).expect(422);
    await api.patch(path, { feature: 'bay-bong', enabled: true, approvedBy: 'Tài' }).expect(422);
    await api.patch(`/v1/admin/organizations/${newId()}/features`, { feature: 'orders', enabled: true, approvedBy: 'Tài' }).expect(404);

    const { rows } = await admin.query<{ reason: string; operator: string }>(
      `select reason, operator from admin_access_log where action = 'set-feature' order by created_at`,
    );
    expect(rows).toEqual([
      { reason: 'orders bật', operator: `Tài · qua ${ADMIN_ID}` },
      { reason: 'orders bật', operator: `Tài · qua ${ADMIN_ID}` },
      { reason: 'orders tắt · Thử tắt', operator: `Tài · qua ${ADMIN_ID}` },
    ]);
  });
});

describe('mã sáng lập', () => {
  it('thêm (viết hoa), trùng → PROMO_EXISTS; xoá mã chưa dùng; mã đã dùng → PROMO_REDEEMED; mã lạ → 404', async () => {
    const api = await as(ADMIN_ID);
    const created = AdminPromoRow.parse(
      (
        await api
          .post('/v1/admin/promo-codes', { code: 'moi-01', plan: 'thuong_lai', monthlyAmount: 149_000, periods: 12, note: 'Hội chợ', approvedBy: 'Tài' })
          .expect(200)
      ).body,
    );
    expect(created).toMatchObject({ code: 'MOI-01', periodsUsed: 0, organization: null, note: 'Hội chợ' });

    const dup = await api.post('/v1/admin/promo-codes', { code: 'MOI-01', plan: 'vua', monthlyAmount: 1, periods: 1, approvedBy: 'Tài' }).expect(422);
    expect(ErrorBody.parse(dup.body).error.details).toMatchObject({ reason: 'PROMO_EXISTS' });

    await admin.query(
      `insert into promo_codes (code, plan, monthly_amount, periods, organization_id, redeemed_by, redeemed_at)
       values ('DA-DUNG', 'thuong_lai', 149000, 12, $1, $2, now())`,
      [vua, vuaOwner],
    );
    const list = AdminPromoCodes.parse((await api.get('/v1/admin/promo-codes').expect(200)).body);
    expect(list.rows.map((r) => [r.code, r.organization?.name ?? null])).toEqual(
      expect.arrayContaining([
        ['MOI-01', null],
        ['DA-DUNG', 'Vựa Tư Hùng'],
      ]),
    );

    const used = await api.delete('/v1/admin/promo-codes/DA-DUNG', { approvedBy: 'Tài' }).expect(422);
    expect(ErrorBody.parse(used.body).error.details).toMatchObject({ reason: 'PROMO_REDEEMED' });
    const after = AdminPromoCodes.parse((await api.delete('/v1/admin/promo-codes/MOI-01', { approvedBy: 'Tài', reason: 'Gõ sai' }).expect(200)).body);
    expect(after.rows.map((r) => r.code)).toEqual(['DA-DUNG']);
    await api.delete('/v1/admin/promo-codes/KHONG-CO', { approvedBy: 'Tài' }).expect(404);
    await api.delete('/v1/admin/promo-codes/DA-DUNG').expect(422);

    expect((await logActions()).map((l) => l.action)).toEqual(['create-promo', 'delete-promo']);
  });
});

describe('người dùng', () => {
  it('tìm theo số (gõ kiểu nào cũng được), tên đăng nhập, tên; kèm tổ chức và email khôi phục đã xác nhận; ghi nhật ký', async () => {
    // Đổi email thì trigger xoá dấu xác nhận — đặt email trước, xác nhận sau.
    await admin.query(`update profiles set recovery_email = 'mai@example.com' where id = $1`, [farmer]);
    await admin.query(`update profiles set recovery_email_verified_at = now() where id = $1`, [farmer]);
    const api = await as(ADMIN_ID);
    const byPhone = AdminUsers.parse((await api.get('/v1/admin/users', { q: '0907 000 111' }).expect(200)).body);
    expect(byPhone.rows).toMatchObject([
      { id: farmer, name: 'Cô Mai', hasVerifiedRecoveryEmail: true, memberships: [{ organization: { id: farm, type: 'farmer' }, role: 'owner', status: 'active' }] },
    ]);
    const byUsername = AdminUsers.parse((await api.get('/v1/admin/users', { q: 'TuHung' }).expect(200)).body);
    expect(byUsername.rows).toMatchObject([{ id: vuaOwner, hasVerifiedRecoveryEmail: false, memberships: [{ organization: { id: vua } }] }]);
    const byName = AdminUsers.parse((await api.get('/v1/admin/users', { q: 'cô m' }).expect(200)).body);
    expect(byName.rows.map((r) => r.id)).toEqual([farmer]);
    await api.get('/v1/admin/users', { q: 'a' }).expect(422);

    const { rows } = await admin.query(`select reason from admin_access_log where action = 'search-users' order by created_at`);
    expect(rows.map((r) => r.reason)).toEqual(['0907 000 111', 'TuHung', 'cô m']);
  });

  it('0.34.0: không có q → mọi tài khoản, mới tạo trước, từng trang 50 theo cursor; cursor hỏng → 422; ghi list-users', async () => {
    // 60 tài khoản cùng một thời điểm (cùng micro giây) — cursor phải tách được bằng id.
    await admin.query(
      `insert into profiles (id, name, created_at) select gen_random_uuid(), 'Người ' || g, '2026-11-01T00:00:00Z' from generate_series(1, 60) g`,
    );
    const api = await as(ADMIN_ID);
    const first = AdminUsers.parse((await api.get('/v1/admin/users').expect(200)).body);
    expect(first.rows).toHaveLength(50);
    // Hai hồ sơ của beforeEach tạo lúc now() → đứng đầu.
    expect(first.rows.slice(0, 2).map((r) => r.id).sort()).toEqual([vuaOwner, farmer].sort());
    expect(first.cursor).toBeTruthy();
    const second = AdminUsers.parse((await api.get('/v1/admin/users', { cursor: first.cursor }).expect(200)).body);
    expect(second.rows).toHaveLength(12);
    expect(second.cursor).toBeNull();
    const all = [...first.rows, ...second.rows].map((r) => r.id);
    expect(new Set(all).size).toBe(62);

    await api.get('/v1/admin/users', { cursor: 'rác' }).expect(422);
    const { rows } = await admin.query(`select action, reason from admin_access_log where action = 'list-users'`);
    expect(rows).toEqual([
      { action: 'list-users', reason: null },
      { action: 'list-users', reason: null },
    ]);
  });

  it('0.34.0: chi tiết — tổ chức kèm mức làm việc, nhật ký gộp mới trước; không có → 404; ghi view-user', async () => {
    await admin.query(`update profiles set created_at = '2026-11-01T00:00:00Z' where id = $1`, [vuaOwner]);
    await admin.query(`update memberships set created_at = '2026-11-01T00:05:00Z' where user_id = $1`, [vuaOwner]);
    const api = await as(ADMIN_ID);
    // Anh Hùng: lập 2 phiếu + ghi 1 lần trả hôm 10/11, 1 phiếu đã xoá (không tính); xoá một phiếu (audit).
    const tx1 = newId();
    await admin.query(
      `insert into transactions (id, organization_id, created_by, date, kind, supplier_name, lines, created_at, deleted_at) values
         ($1, $2, $3, now(), 'purchase', 'Khách lẻ', '[]', '2026-11-10T02:00:00Z', null),
         ($4, $2, $3, now(), 'purchase', 'Khách lẻ', '[]', '2026-11-10T03:00:00Z', null),
         ($5, $2, $3, now(), 'purchase', 'Khách lẻ', '[]', '2026-11-10T04:00:00Z', now())`,
      [tx1, vua, vuaOwner, newId(), newId()],
    );
    await admin.query(
      `insert into payments (id, organization_id, transaction_id, created_by, date, amount, created_at)
       values ($1, $2, $3, $4, now(), 500000, '2026-11-10T05:00:00Z')`,
      [newId(), vua, tx1, vuaOwner],
    );
    await admin.query(
      `insert into audit_log (organization_id, actor_user_id, action, entity, entity_id, before, created_at)
       values ($1, $2, 'receipt.deleted', 'transaction', $3, '{"total": 1000}', '2026-11-11T01:00:00Z')`,
      [vua, vuaOwner, newId()],
    );
    // Người khác (chủ khác) đổi quyền của anh Hùng ở vựa — dòng của chỗ anh Hùng trong tổ chức.
    const { rows: ms } = await admin.query<{ id: string }>(`select id from memberships where user_id = $1`, [vuaOwner]);
    await admin.query(
      `insert into audit_log (organization_id, actor_user_id, action, entity, entity_id, after, created_at)
       values ($1, $2, 'member.role_changed', 'membership', $3, '{"role": "manager"}', '2026-11-12T01:00:00Z')`,
      [vua, farmer, ms[0]?.id],
    );
    await admin.query(
      `insert into admin_access_log (user_id, action, operator, reason, created_at)
       values ($1, 'reset-password', 'Linh (admin)', 'Khách gọi', '2026-11-12T02:00:00Z')`,
      [vuaOwner],
    );

    const d = AdminUserDetail.parse((await api.get(`/v1/admin/users/${vuaOwner}`).expect(200)).body);
    expect(d).toMatchObject({ id: vuaOwner, name: 'Anh Hùng', username: 'tuhung', phone: '+84905112233', timelineTruncated: false });
    expect(d.memberships).toMatchObject([
      { organization: { id: vua, name: 'Vựa Tư Hùng', type: 'trader' }, role: 'owner', status: 'active', receipts: 2, payments: 1 },
    ]);
    expect(d.memberships[0]?.lastActivityAt).toBe('2026-11-10T05:00:00.000Z');

    expect(d.timeline.map((e) => [e.kind, e.action, e.actor])).toEqual([
      ['admin', 'reset-password', 'Linh (admin)'],
      ['organization', 'member.role_changed', 'Cô Mai'],
      ['work', 'receipt.deleted', null],
      ['work', 'work.day', null],
      ['organization', 'membership.joined', null],
      ['account', 'account.created', null],
    ]);
    expect(d.timeline[0]?.after).toEqual({ reason: 'Khách gọi' });
    expect(d.timeline[3]).toMatchObject({ at: '2026-11-10T05:00:00.000Z', organization: { id: vua }, after: { receipts: 2, payments: 1 } });
    expect(d.timeline[4]).toMatchObject({ organization: { id: vua }, after: { role: 'owner' } });
    await api.get(`/v1/admin/users/${newId()}`).expect(404);
    // Lần xem trước không hiện lại trong nhật ký của tài khoản.
    const again = AdminUserDetail.parse((await api.get(`/v1/admin/users/${vuaOwner}`).expect(200)).body);
    expect(again.timeline.filter((e) => e.kind === 'admin')).toHaveLength(1);
    const { rows } = await admin.query(`select user_id from admin_access_log where action = 'view-user'`);
    expect(rows.map((r) => r.user_id)).toEqual([vuaOwner, vuaOwner]);
  });
});

describe('sửa tên (0.34.0)', () => {
  it('tài khoản: hồ sơ + Supabase Auth đổi cùng nhau, cần người duyệt, ghi rename-user (cũ → mới · lý do); không có → 404', async () => {
    const api = await as(ADMIN_ID);
    await api.patch(`/v1/admin/users/${vuaOwner}`, { name: 'Anh Hùng Mới' }).expect(422);
    await api.patch(`/v1/admin/users/${vuaOwner}`, { name: '  ', approvedBy: 'Linh' }).expect(422);
    const r = AdminRenameResult.parse(
      (await api.patch(`/v1/admin/users/${vuaOwner}`, { name: '  Anh Hùng Mới ', approvedBy: 'Linh', reason: 'Khách nhờ' }).expect(200)).body,
    );
    expect(r).toEqual({ id: vuaOwner, name: 'Anh Hùng Mới', previousName: 'Anh Hùng' });
    expect(fakeAuth.names.get(vuaOwner)).toBe('Anh Hùng Mới');
    const { rows } = await admin.query(`select name from profiles where id = $1`, [vuaOwner]);
    expect(rows[0]?.name).toBe('Anh Hùng Mới');
    const log = await admin.query(`select user_id, operator, reason from admin_access_log where action = 'rename-user'`);
    expect(log.rows).toEqual([{ user_id: vuaOwner, operator: `Linh · qua ${ADMIN_ID}`, reason: '"Anh Hùng" → "Anh Hùng Mới" · Khách nhờ' }]);
    // Hiện trong nhật ký của tài khoản, nhóm quản trị viên.
    const d = AdminUserDetail.parse((await api.get(`/v1/admin/users/${vuaOwner}`).expect(200)).body);
    expect(d.timeline[0]).toMatchObject({ kind: 'admin', action: 'rename-user', actor: `Linh · qua ${ADMIN_ID}` });

    await api.patch(`/v1/admin/users/${newId()}`, { name: 'Ai đó', approvedBy: 'Linh' }).expect(404);
  });

  it('tài khoản: Supabase Auth hỏng → hồ sơ và nhật ký quản trị rollback', async () => {
    const api = await as(ADMIN_ID);
    fakeAuth.failNames = true;
    try {
      await api.patch(`/v1/admin/users/${farmer}`, { name: 'Cô Mai Mới', approvedBy: 'Linh' }).expect(500);
    } finally {
      fakeAuth.failNames = false;
    }
    const { rows } = await admin.query(`select name from profiles where id = $1`, [farmer]);
    expect(rows[0]?.name).toBe('Cô Mai');
    expect((await admin.query(`select 1 from admin_access_log where action = 'rename-user'`)).rows).toHaveLength(0);
  });

  it('tổ chức: đổi tên, ghi rename-organization và organization.updated vào nhật ký của tổ chức (người làm = quản trị viên)', async () => {
    const api = await as(ADMIN_ID);
    const r = AdminRenameResult.parse((await api.patch(`/v1/admin/organizations/${vua}`, { name: 'Vựa Tư Hùng 2', approvedBy: 'Linh' }).expect(200)).body);
    expect(r).toEqual({ id: vua, name: 'Vựa Tư Hùng 2', previousName: 'Vựa Tư Hùng' });
    expect((await admin.query(`select name from organizations where id = $1`, [vua])).rows[0]?.name).toBe('Vựa Tư Hùng 2');
    const audit = await admin.query(`select actor_user_id, before, after from audit_log where organization_id = $1 and action = 'organization.updated'`, [vua]);
    expect(audit.rows).toEqual([{ actor_user_id: ADMIN_ID, before: { name: 'Vựa Tư Hùng' }, after: { name: 'Vựa Tư Hùng 2' } }]);
    const log = await admin.query(`select organization_id, reason from admin_access_log where action = 'rename-organization'`);
    expect(log.rows).toEqual([{ organization_id: vua, reason: '"Vựa Tư Hùng" → "Vựa Tư Hùng 2"' }]);
    await api.patch(`/v1/admin/organizations/${vua}`, { name: 'x'.repeat(121), approvedBy: 'Linh' }).expect(422);
    await api.patch(`/v1/admin/organizations/${newId()}`, { name: 'Ai đó', approvedBy: 'Linh' }).expect(404);
  });
});

describe('phản hồi và nhật ký', () => {
  it('phản hồi trong khoảng, mới trước, kèm tổ chức và người gửi; nhật ký đọc được, mới trước, không tự ghi thêm', async () => {
    await admin.query(
      `insert into feedback (organization_id, user_id, rating, comment, app_version, platform, created_at)
       values ($1, $2, 5, 'Dễ dùng', '0.30.0', 'twa', now() - interval '1 day'),
              ($1, $2, 2, 'Chậm', '0.30.0', 'web', now() - interval '40 days')`,
      [vua, vuaOwner],
    );
    const api = await as(ADMIN_ID);
    const range = { from: new Date(Date.now() - 7 * 86_400_000).toISOString(), to: new Date(Date.now() + 60_000).toISOString() };
    const fb = AdminFeedback.parse((await api.get('/v1/admin/feedback', range).expect(200)).body);
    expect(fb.rows).toMatchObject([
      { rating: 5, comment: 'Dễ dùng', platform: 'twa', organization: { id: vua, name: 'Vựa Tư Hùng' }, user: { name: 'Anh Hùng', phone: '+84905112233' } },
    ]);

    await api.get(`/v1/admin/organizations/${vua}`).expect(200);
    const log = AdminAccessLog.parse((await api.get('/v1/admin/access-log').expect(200)).body);
    expect(log.rows.map((r) => [r.action, r.organization?.name ?? null, r.operator])).toEqual([
      ['view-organization', 'Vựa Tư Hùng', ADMIN_ID],
      ['list-feedback', null, ADMIN_ID],
    ]);
  });
});
