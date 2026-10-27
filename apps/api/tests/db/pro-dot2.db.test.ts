/**
 * Đợt 2 của KE_HOACH_GOI_PRO trên Postgres thật:
 *   V6/D4 — sửa phiếu ghi nhật ký ở mọi bậc gói; đọc `GET /v1/audit` cần `staff:manage` + `audit:view`
 *   D3   — báo cáo tổng của vựa / doanh nghiệp cần `reports:org`; nông dân vẫn xem phiếu đã kết nối
 *   V13  — lần trả mang hình thức (`method`) qua đẩy / kéo sổ
 *   Thưởng giới thiệu — lần trả đầu cộng 1 tháng cho cả hai bên, đúng một lần
 *   C2 (phương án C) — gói mới ít chi nhánh hơn số đang dùng: vẫn mở, ghi `branch.over_limit`
 * Chỉ Supabase Auth Admin là giả.
 */

import { AuditResult, ErrorBody, SyncPullResult, SyncPushResult } from '@mambo/contracts';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaMemberships } from '../../src/auth/prisma-memberships';
import { Database } from '../../src/db/database';
import { PrivilegedDatabase } from '../../src/db/privileged-database';
import { FakeSupabaseAdmin, buildTestApp, makeSigner, testEnv } from '../helpers';
import { SERVICE_URL, admin, createOrg, newId, service, truncateAll } from './db';
import { addMember, createBranch, giveTrial, opMaker, paymentData, txData } from './sync-fixture';

const PRIVILEGED_URL =
  process.env.TEST_DATABASE_PRIVILEGED_URL ?? 'postgresql://api_privileged:api_privileged_dev@localhost:54329/thumua365';
const ADMIN_ID = '3f9b8c7d-6e5a-4b3c-9d2e-1f0a9b8c7d6e';

let app: INestApplication;
let signer: Awaited<ReturnType<typeof makeSigner>>;

let vua: string;
let vuaOwner: string;
let staff: string;

beforeAll(async () => {
  signer = await makeSigner();
  const db = new Database(SERVICE_URL);
  app = await buildTestApp({
    env: testEnv({ DATABASE_URL: SERVICE_URL, PRIVILEGED_DATABASE_URL: PRIVILEGED_URL, ADMIN_USER_IDS: ADMIN_ID, RATE_LIMIT_PER_MINUTE: '10000' }),
    jwks: signer.jwks,
    supabaseAdmin: new FakeSupabaseAdmin(),
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
  const withAuth = <T extends request.Test>(r: T) => {
    const authed = r.set('authorization', `Bearer ${token}`);
    return orgId ? authed.set('x-organization-id', orgId) : authed;
  };
  const http = () => request(app.getHttpServer());
  return {
    get: (path: string) => withAuth(http().get(path)),
    post: (path: string, body: object = {}) => withAuth(http().post(path).send(body)),
    push: async (ops: unknown[]) => {
      const { results } = SyncPushResult.parse((await withAuth(http().post('/v1/sync/push').send({ deviceId: newId(), ops })).expect(200)).body);
      expect(results.map((r) => r.status)).toEqual(ops.map(() => 'applied'));
    },
  };
};
type Api = Awaited<ReturnType<typeof as>>;

const profile = (id: string, name: string, phone: string) =>
  admin.query(`insert into profiles (id, name, phone) values ($1, $2, $3)`, [id, name, phone]);
const expire = (orgId: string) =>
  admin.query(`update subscriptions set trial_ends_at = now() - interval '1 day' where organization_id = $1`, [orgId]);
const errorOf = (res: request.Response) => ErrorBody.parse(res.body).error;
const audit = async (api: Api, query = ''): Promise<AuditResult> =>
  AuditResult.parse((await api.get(`/v1/audit${query}`).expect(200)).body);

beforeEach(async () => {
  await truncateAll();
  vuaOwner = newId();
  staff = newId();
  vua = await createOrg('trader', vuaOwner, 'Vựa Tư Hùng');
  await giveTrial(vua);
  await addMember(vua, staff, 'staff');
  await profile(vuaOwner, 'Anh Hùng', '+84905112233');
  await profile(staff, 'Bé Ba', '+84905112244');
});

describe('V6 — nhật ký thao tác', () => {
  it('sửa ghi chú phiếu, huỷ lần trả → có dòng nhật ký kèm tên người làm; sửa mà không đổi gì → không ghi', async () => {
    const owner = await as(vuaOwner, vua);
    const staffApi = await as(staff, vua);
    const op = opMaker();
    const txId = newId();
    const payId = newId();
    await staffApi.push([op('transaction', 'insert', txId, txData()), op('payment', 'insert', payId, paymentData(txId, 500_000))]);
    await staffApi.push([op('transaction', 'update', txId, { note: 'Cân lại bao thứ 3' })]);
    await staffApi.push([op('transaction', 'update', txId, { note: 'Cân lại bao thứ 3' })]);
    await owner.push([opMaker()('payment', 'softDelete', payId)]);

    const { entries, cursor } = await audit(owner);
    expect(cursor).toBeNull();
    expect(entries.map((e) => e.action)).toEqual(['payment.voided', 'receipt.updated']);
    expect(entries[0]).toMatchObject({ actor: { id: vuaOwner, name: 'Anh Hùng' }, entityId: payId, before: { amount: 500_000 } });
    expect(entries[1]).toMatchObject({
      actor: { id: staff, name: 'Bé Ba' },
      entity: 'transaction',
      entityId: txId,
      before: { note: null, photos: 0 },
      after: { note: 'Cân lại bao thứ 3', photos: 0 },
    });

    expect((await audit(owner, `?actor=${staff}`)).entries.map((e) => e.action)).toEqual(['receipt.updated']);
  });

  it('thay ảnh phiếu mà số ảnh giữ nguyên vẫn ghi nhật ký, kèm số ảnh cũ bị gỡ; đổi thứ tự thì không ghi', async () => {
    const owner = await as(vuaOwner, vua);
    const op = opMaker();
    const txId = newId();
    const [a, b, c] = [newId(), newId(), newId()];
    await owner.push([op('transaction', 'insert', txId, txData({ attachmentIds: [a, b] }))]);
    await owner.push([op('transaction', 'update', txId, { attachmentIds: [b, a] })]);
    await owner.push([op('transaction', 'update', txId, { attachmentIds: [b, c] })]);

    const { entries } = await audit(owner);
    expect(entries.map((e) => e.action)).toEqual(['receipt.updated']);
    expect(entries[0]).toMatchObject({ before: { photos: 2 }, after: { photos: 2, photosRemoved: 1 } });
  });

  it('phân trang không sót dòng ghi trong cùng một transaction (cùng now())', async () => {
    const owner = await as(vuaOwner, vua);
    const op = opMaker();
    const ids = [newId(), newId(), newId()];
    await owner.push(ids.map((id) => op('transaction', 'insert', id, txData())));
    await owner.push(ids.map((id) => op('transaction', 'softDelete', id)));

    const all = (await audit(owner)).entries.map((e) => e.id);
    expect(all).toHaveLength(3);
    const walked: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await audit(owner, `?limit=1${cursor ? `&cursor=${cursor}` : ''}`);
      walked.push(...page.entries.map((e) => e.id));
      cursor = page.cursor;
    } while (cursor);
    expect(walked).toEqual(all);
  });

  it('người cân không xem được (403); hết gói thì chủ không xem được (402)', async () => {
    expect(errorOf(await (await as(staff, vua)).get('/v1/audit').expect(403)).code).toBe('FORBIDDEN');
    await expire(vua);
    const res = await (await as(vuaOwner, vua)).get('/v1/audit').expect(402);
    expect(errorOf(res)).toMatchObject({ code: 'PLAN_REQUIRED', details: { entitlement: 'audit:view' } });
  });
});

describe('D3 — báo cáo tổng theo gói', () => {
  const range = `from=${encodeURIComponent('2026-09-01T00:00:00+07:00')}&to=${encodeURIComponent('2026-10-01T00:00:00+07:00')}`;

  it('vựa còn gói → 200; hết gói: summary và members → 402 reports:org', async () => {
    const owner = await as(vuaOwner, vua);
    await owner.get(`/v1/reports/summary?${range}`).expect(200);
    await owner.get(`/v1/reports/members?${range}`).expect(200);
    await expire(vua);
    for (const path of ['summary', 'members']) {
      const res = await owner.get(`/v1/reports/${path}?${range}`).expect(402);
      expect(errorOf(res)).toMatchObject({ code: 'PLAN_REQUIRED', details: { entitlement: 'reports:org' } });
    }
  });

  it('nông dân (không có gói) vẫn xem summary phiếu đã kết nối', async () => {
    const farmerOwner = newId();
    const farmer = await createOrg('farmer', farmerOwner, 'Nhà chú Tư');
    await (await as(farmerOwner, farmer)).get(`/v1/reports/summary?${range}`).expect(200);
  });
});

describe('V13 — hình thức trả', () => {
  it('lần trả gửi `method` thì kéo về đúng; không gửi (app cũ) thì null', async () => {
    const owner = await as(vuaOwner, vua);
    const op = opMaker();
    const txId = newId();
    const transfer = newId();
    const legacy = newId();
    await owner.push([
      op('transaction', 'insert', txId, txData()),
      op('payment', 'insert', transfer, { ...paymentData(txId, 300_000), method: 'transfer' }),
      op('payment', 'insert', legacy, paymentData(txId, 200_000)),
    ]);
    const pulled = SyncPullResult.parse((await owner.get('/v1/sync/pull').expect(200)).body);
    const methods = Object.fromEntries(pulled.changes.payments.map((p) => [p.id, p.method]));
    expect(methods).toEqual({ [transfer]: 'transfer', [legacy]: null });
  });
});

describe('mở gói — thưởng giới thiệu và vượt chi nhánh', () => {
  const activate = async (body: object) =>
    (await (await as(ADMIN_ID)).post('/v1/admin/plans/activate', { months: 1, amount: 149_000, approvedBy: 'Tài', ...body }).expect(200)).body;
  const periodEnd = async (orgId: string) =>
    (
      await admin.query<{ current_period_end: Date | null }>('select current_period_end from subscriptions where organization_id = $1', [orgId])
    ).rows[0]?.current_period_end;
  const days = (d: Date | null | undefined) => Math.round(((d?.getTime() ?? 0) - Date.now()) / 86_400_000);
  const actions = async (orgId: string) =>
    (
      await admin.query<{ action: string }>('select action from audit_log where organization_id = $1 order by created_at, action', [orgId])
    ).rows.map((r) => r.action);

  it('lần trả đầu của người được giới thiệu: cả hai bên +1 tháng, đúng một lần', async () => {
    // Người mời: chủ vựa Tư Hùng, còn 10 ngày dùng thử.
    await admin.query(`update subscriptions set trial_ends_at = now() + interval '10 days' where organization_id = $1`, [vua]);
    const invitee = newId();
    const moi = await createOrg('trader', invitee, 'Vựa Năm Lành');
    await profile(invitee, 'Chị Lành', '+84905112255');
    await admin.query('update profiles set referred_by = $1 where id = $2', [vuaOwner, invitee]);

    await activate({ organizationId: moi, bankTxId: 'FT-DAU' });
    expect(days(await periodEnd(moi))).toBeGreaterThanOrEqual(59); // 1 tháng trả + 1 tháng thưởng
    expect(days(await periodEnd(vua))).toBeGreaterThanOrEqual(38); // 10 ngày thử còn lại + 1 tháng thưởng
    expect(await actions(moi)).toEqual(['plan.activated', 'plan.referral_bonus']);
    expect(await actions(vua)).toEqual(['plan.referral_bonus']);

    const inviterEnd = await periodEnd(vua);
    await activate({ organizationId: moi, bankTxId: 'FT-SAU' });
    expect(await periodEnd(vua)).toEqual(inviterEnd);
    expect((await actions(moi)).filter((a) => a === 'plan.referral_bonus')).toHaveLength(1);
  });

  it('người mời đang trả 12 tháng đúng lúc được thưởng: không lần nào ghi đè lần kia', async () => {
    const invitee = newId();
    const moi = await createOrg('trader', invitee, 'Vựa Năm Lành');
    await profile(invitee, 'Chị Lành', '+84905112255');
    await admin.query('update profiles set referred_by = $1 where id = $2', [vuaOwner, invitee]);

    // Lần trả 12 tháng của người mời đang giữ dòng gói, chưa commit; thưởng phải chờ rồi cộng lên ngày mới.
    const paying = await admin.connect();
    try {
      await paying.query('begin');
      await paying.query('select 1 from subscriptions where organization_id = $1 for update', [vua]);
      await paying.query(`update subscriptions set current_period_end = now() + interval '365 days' where organization_id = $1`, [vua]);
      const bonus = activate({ organizationId: moi, bankTxId: 'FT-DAU' });
      await new Promise((r) => setTimeout(r, 500));
      await paying.query('commit');
      await bonus;
    } finally {
      paying.release();
    }
    expect(days(await periodEnd(vua))).toBeGreaterThanOrEqual(365 + 28); // 12 tháng trả + 1 tháng thưởng
  });

  it('đã trả trước khi nhập mã mời → không thưởng; người mời chỉ là nông dân → chỉ bên trả nhận', async () => {
    await activate({ organizationId: vua, bankTxId: 'FT-1' });
    const farmerOwner = newId();
    await createOrg('farmer', farmerOwner, 'Nhà chú Tư');
    await admin.query('update profiles set referred_by = $1 where id = $2', [farmerOwner, vuaOwner]);
    await activate({ organizationId: vua, bankTxId: 'FT-2' });
    expect(await actions(vua)).toEqual(['plan.activated', 'plan.activated']);

    const invitee = newId();
    const moi = await createOrg('trader', invitee, 'Vựa Năm Lành');
    await profile(invitee, 'Chị Lành', '+84905112255');
    await admin.query('update profiles set referred_by = $1 where id = $2', [farmerOwner, invitee]);
    await activate({ organizationId: moi, bankTxId: 'FT-3' });
    expect(await actions(moi)).toEqual(['plan.activated', 'plan.referral_bonus']);
    expect(days(await periodEnd(moi))).toBeGreaterThanOrEqual(59);
  });

  it('doanh nghiệp đang 5 chi nhánh mua gói 3: vẫn mở, ghi branch.over_limit; tạo thêm → BRANCH_LIMIT', async () => {
    const dnOwner = newId();
    const dn = await createOrg('enterprise', dnOwner, 'Công ty Bình Long');
    await giveTrial(dn);
    for (let i = 1; i <= 5; i++) await createBranch(dn, `Trạm ${i}`);
    await activate({ organizationId: dn, bankTxId: 'UNC-1', months: 12, amount: 24_000_000, branchLimit: 3 });

    const { rows } = await admin.query<{ after: unknown }>(
      `select after from audit_log where organization_id = $1 and action = 'branch.over_limit'`,
      [dn],
    );
    expect(rows.map((r) => r.after)).toEqual([{ used: 5, limit: 3 }]);
    const res = await (await as(dnOwner, dn)).post('/v1/org/branches', { name: 'Trạm 6' }).expect(402);
    expect(errorOf(res)).toMatchObject({ code: 'BRANCH_LIMIT', details: { limit: 3 } });
  });
});
