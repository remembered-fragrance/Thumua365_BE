/**
 * BE6 trên Postgres thật — VAN_HANH §7.3 "Nghiệm thu luồng tiền" chạy trên API thay Edge Function:
 *   #1 tự đi hết: thấy giá → định chuyển khoản → tiền vào → gói tự mở, không ai can thiệp
 *   #2 webhook 3 lần cùng mã giao dịch → gia hạn MỘT lần (cả khi gọi song song)
 *   #3 không có / sai bí mật → 401, không đổi gì
 *   #4 chuyển thiếu → không mở gói, không ghi sổ đối soát (để đường thủ công)
 *   #5 sai nội dung → quản trị viên mở bằng tay; chạy lần hai → "đã xử lý rồi"
 *   #7 hết gói → không đẩy sổ lên được; trả tiền xong → đẩy được
 *   #8 API thường (api_service) không tự mở gói, không tự đánh dấu "đã trả" — database chặn
 * (#6 hoàn tiền, #9 đọc khi hết gói, #10 kiểm RLS: ngoài API / đã có ở sync và rls.db.test.)
 * Chỉ Supabase Auth Admin là giả.
 */

import {
  AdminActivatePlanResult,
  BankWebhookResult,
  ErrorBody,
  PaymentIntentsList,
  PaymentIntentView,
  SubscriptionView,
  SyncPushResult,
} from '@mambo/contracts';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaMemberships } from '../../src/auth/prisma-memberships';
import { Database } from '../../src/db/database';
import { PrivilegedDatabase } from '../../src/db/privileged-database';
import { FakeSupabaseAdmin, buildTestApp, makeSigner, testEnv } from '../helpers';
import { SERVICE_URL, admin, createOrg, newId, service, serviceError, truncateAll } from './db';
import { addMember, opMaker, txData } from './sync-fixture';

const PRIVILEGED_URL =
  process.env.TEST_DATABASE_PRIVILEGED_URL ?? 'postgresql://api_privileged:api_privileged_dev@localhost:54329/thumua365';
const SECRET = 'bi-mat-webhook-dai-it-nhat-24-ky-tu';
const ADMIN_ID = '3f9b8c7d-6e5a-4b3c-9d2e-1f0a9b8c7d6e';

let app: INestApplication;
let auth: FakeSupabaseAdmin;
let signer: Awaited<ReturnType<typeof makeSigner>>;
let privilegedDb: PrivilegedDatabase;

let vua: string;
let vuaOwner: string;

beforeAll(async () => {
  signer = await makeSigner();
  auth = new FakeSupabaseAdmin();
  const db = new Database(SERVICE_URL);
  privilegedDb = new PrivilegedDatabase(PRIVILEGED_URL);
  app = await buildTestApp({
    env: testEnv({
      DATABASE_URL: SERVICE_URL,
      PRIVILEGED_DATABASE_URL: PRIVILEGED_URL,
      BANK_WEBHOOK_SECRET: SECRET,
      ADMIN_USER_IDS: ADMIN_ID,
      RATE_LIMIT_PER_MINUTE: '10000',
    }),
    jwks: signer.jwks,
    supabaseAdmin: auth,
    db,
    privilegedDb,
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
    push: (ops: unknown[]) => withAuth(http().post('/v1/sync/push').send({ deviceId: newId(), ops })),
  };
};

/** Casso gửi `{ data: [...] }` kèm header `secure-token`. */
const casso = (tx: { tid: string; amount: number; description: string }, token: string | null = SECRET) => {
  const req = request(app.getHttpServer()).post('/v1/webhooks/bank');
  return (token === null ? req : req.set('secure-token', token)).send({ error: 0, data: [{ id: 1, when: '2026-10-03 10:00:00', ...tx }] });
};

const planOf = async (orgId: string) =>
  (await admin.query<{ status: string; current_period_end: Date | null; branch_limit: number | null }>(
    'select status, current_period_end, branch_limit from subscriptions where organization_id = $1',
    [orgId],
  )).rows[0];

const daysFromNow = (d: Date | null | undefined): number => Math.round(((d?.getTime() ?? 0) - Date.now()) / 86_400_000);

beforeEach(async () => {
  await truncateAll();
  vuaOwner = newId();
  vua = await createOrg('trader', vuaOwner, 'Vựa Tư Hùng');
  // Dùng thử đã hết hạn: vựa đang bị chặn ghi sổ.
  await admin.query(`insert into subscriptions (organization_id, status, trial_ends_at) values ($1, 'trialing', now() - interval '40 days')`, [vua]);
});

describe('#1 + #7 — tự đi hết, không ai can thiệp', () => {
  it('hết gói → không đẩy sổ được → thấy giá → định chuyển khoản → tiền vào → gói mở → đẩy được', async () => {
    const owner = await as(vuaOwner, vua);
    const blocked = await owner.push([opMaker()('transaction', 'insert', newId(), txData())]).expect(402);
    expect(ErrorBody.parse(blocked.body).error.code).toBe('PLAN_EXPIRED');

    const view = SubscriptionView.parse((await owner.get('/v1/me/subscription').expect(200)).body);
    expect(view).toMatchObject({ selfServe: true, plan: { tier: 'free' } });
    expect(view.prices).toEqual([
      { months: 1, amount: 149_000 },
      { months: 12, amount: 1_490_000 },
    ]);

    const intent = PaymentIntentView.parse((await owner.post('/v1/billing/intents', { months: 1 }).expect(200)).body);
    expect(intent).toMatchObject({ amount: 149_000, months: 1, status: 'pending' });
    expect(intent.transferContent).toBe(`TM365 ${intent.code}`);
    // Bấm lại trong ngày → cùng mã, không sinh mã mới.
    const again = PaymentIntentView.parse((await owner.post('/v1/billing/intents', { months: 1 }).expect(200)).body);
    expect(again.id).toBe(intent.id);

    // Người dùng gõ nội dung kiểu ngân hàng hay làm: chữ thường, thêm chữ, mất dấu cách.
    const res = BankWebhookResult.parse(
      (await casso({ tid: 'FT26276001', amount: 149_000, description: `chuyen tien tm365${intent.code.toLowerCase()} cam on` }).expect(200)).body,
    );
    expect(res).toEqual({ handled: ['FT26276001'], skipped: [] });

    const plan = await planOf(vua);
    expect(plan?.status).toBe('active');
    expect(daysFromNow(plan?.current_period_end)).toBeGreaterThanOrEqual(28);
    expect(daysFromNow(plan?.current_period_end)).toBeLessThanOrEqual(31);
    const list = PaymentIntentsList.parse((await owner.get('/v1/billing/intents').expect(200)).body);
    expect(list.intents[0]?.status).toBe('paid');
    const { rows: noti } = await admin.query(`select kind from notifications where organization_id = $1`, [vua]);
    expect(noti.map((n) => n.kind)).toEqual(['plan.activated']);

    const pushed = SyncPushResult.parse((await owner.push([opMaker()('transaction', 'insert', newId(), txData())]).expect(200)).body);
    expect(pushed.results[0]?.status).toBe('applied');
  });

  it('gói năm: cộng 12 tháng NỐI TIẾP kỳ đang còn', async () => {
    await admin.query(`update subscriptions set status = 'active', current_period_end = now() + interval '10 days' where organization_id = $1`, [vua]);
    const intent = PaymentIntentView.parse((await (await as(vuaOwner, vua)).post('/v1/billing/intents', { months: 12 }).expect(200)).body);
    await casso({ tid: 'FT-NAM', amount: 1_490_000, description: intent.transferContent }).expect(200);
    const days = daysFromNow((await planOf(vua))?.current_period_end);
    expect(days).toBeGreaterThanOrEqual(365 + 10 - 2);
    expect(days).toBeLessThanOrEqual(366 + 10 + 1);
  });
});

describe('#2 #3 #4 — ba chốt của webhook', () => {
  const intent = async () => PaymentIntentView.parse((await (await as(vuaOwner, vua)).post('/v1/billing/intents', { months: 1 }).expect(200)).body);

  it('#2 gọi 3 lần (cả song song) cùng một mã giao dịch → gia hạn đúng một lần', async () => {
    const i = await intent();
    const body = { tid: 'FT-TRUNG', amount: 149_000, description: i.transferContent };
    const results = await Promise.all([casso(body), casso(body), casso(body)]);
    const handled = results.flatMap((r) => BankWebhookResult.parse(r.body).handled);
    expect(handled).toEqual(['FT-TRUNG']);
    await casso(body).expect(200);
    const { rows } = await admin.query(`select count(*)::int as n from bank_transactions where bank_tx_id = 'FT-TRUNG'`);
    expect(rows[0]?.n).toBe(1);
    expect(daysFromNow((await planOf(vua))?.current_period_end)).toBeLessThanOrEqual(31);
  });

  it('#3 không có bí mật, sai bí mật, bí mật SePay sai → 401, không đổi gì', async () => {
    const i = await intent();
    const body = { tid: 'FT-GIA', amount: 149_000, description: i.transferContent };
    await casso(body, null).expect(401);
    await casso(body, 'sai').expect(401);
    await casso(body, `${SECRET}x`).expect(401);
    await request(app.getHttpServer()).post('/v1/webhooks/bank').set('authorization', 'Apikey sai-bi-mat').send({ id: 9 }).expect(401);
    expect((await planOf(vua))?.status).toBe('trialing');
    const { rows } = await admin.query('select count(*)::int as n from bank_transactions');
    expect(rows[0]?.n).toBe(0);
  });

  it('SePay: header Apikey, giao dịch phẳng; tiền RA bị bỏ qua', async () => {
    const i = await intent();
    const sepay = (body: object) =>
      request(app.getHttpServer()).post('/v1/webhooks/bank').set('authorization', `Apikey ${SECRET}`).send(body);
    const out = BankWebhookResult.parse(
      (await sepay({ id: 77, transferType: 'out', transferAmount: 149_000, content: i.transferContent, referenceCode: 'OUT1' }).expect(200)).body,
    );
    expect(out).toEqual({ handled: [], skipped: [] });
    const ok = BankWebhookResult.parse(
      (await sepay({ id: 78, transferType: 'in', transferAmount: 149_000, content: i.transferContent, referenceCode: 'IN1' }).expect(200)).body,
    );
    expect(ok.handled).toEqual(['78']);
  });

  it('#4 chuyển thiếu → không mở gói, không ghi sổ đối soát; không có mã → bỏ qua', async () => {
    const i = await intent();
    const res = BankWebhookResult.parse(
      (await casso({ tid: 'FT-THIEU', amount: 100_000, description: i.transferContent }).expect(200)).body,
    );
    expect(res).toEqual({ handled: [], skipped: ['FT-THIEU'] });
    await casso({ tid: 'FT-KHONGMA', amount: 149_000, description: 'chuyen tien mua goi' }).expect(200);
    expect((await planOf(vua))?.status).toBe('trialing');
    const { rows } = await admin.query('select count(*)::int as n from bank_transactions');
    expect(rows[0]?.n).toBe(0);
  });
});

describe('#5 — quản trị viên mở gói bằng tay', () => {
  it('sai nội dung → quản trị viên mở theo số chủ; chạy lần hai → đã xử lý rồi; webhook về sau cùng mã → không cộng thêm', async () => {
    await admin.query(`insert into profiles (id, name, phone) values ($1, 'Anh Hùng', '+84905112233')`, [vuaOwner]);
    const adminApi = await as(ADMIN_ID);
    const input = { ownerPhone: '0905 112 233', months: 1, amount: 149_000, bankTxId: 'FT-SAINOIDUNG', approvedBy: 'Tài', reason: 'Gõ sai nội dung' };
    const first = AdminActivatePlanResult.parse((await adminApi.post('/v1/admin/plans/activate', input).expect(200)).body);
    expect(first).toMatchObject({ alreadyProcessed: false, organization: { id: vua, type: 'trader' }, plan: { tier: 'premium', status: 'active' } });
    const second = AdminActivatePlanResult.parse((await adminApi.post('/v1/admin/plans/activate', input).expect(200)).body);
    expect(second.alreadyProcessed).toBe(true);
    expect(second.plan.periodEnd).toBe(first.plan.periodEnd);

    const { rows: log } = await admin.query<{ action: string; operator: string }>('select action, operator from admin_access_log');
    expect(log).toHaveLength(2);
    expect(log[0]).toMatchObject({ action: 'activate-plan', operator: `Tài · qua ${ADMIN_ID}` });
    const { rows: ledger } = await admin.query(`select source from bank_transactions where bank_tx_id = 'FT-SAINOIDUNG'`);
    expect(ledger.map((r) => r.source)).toEqual(['admin']);
  });

  it('gói doanh nghiệp: theo id, kèm giới hạn chi nhánh; người không phải quản trị viên → 403', async () => {
    const dnOwner = newId();
    const dn = await createOrg('enterprise', dnOwner, 'Công ty Bình Long');
    const res = AdminActivatePlanResult.parse(
      (
        await (await as(ADMIN_ID))
          .post('/v1/admin/plans/activate', { organizationId: dn, months: 12, amount: 24_000_000, bankTxId: 'UNC-001', branchLimit: 3, approvedBy: 'Nguyên' })
          .expect(200)
      ).body,
    );
    expect(res.plan).toMatchObject({ tier: 'premium', branchLimit: 3 });
    expect((await planOf(dn))?.branch_limit).toBe(3);

    // Chủ doanh nghiệp tự gọi → 403; không tự mua qua chuyển khoản được.
    const self = await (await as(dnOwner)).post('/v1/admin/plans/activate', { organizationId: dn, months: 12, amount: 1, bankTxId: 'X-1', approvedBy: 'Tôi' });
    expect(self.status).toBe(403);
    await (await as(dnOwner, dn)).post('/v1/billing/intents', { months: 1 }).expect(403);
  });

  it('nông dân không có gói; số không có ai → 404; gửi cả hai cách chọn tổ chức → 422', async () => {
    const mai = newId();
    const farm = await createOrg('farmer', mai, 'Hộ cô Mai');
    const adminApi = await as(ADMIN_ID);
    const base = { months: 1, amount: 149_000, approvedBy: 'Tài' };
    await adminApi.post('/v1/admin/plans/activate', { ...base, organizationId: farm, bankTxId: 'BT-1' }).expect(422);
    await adminApi.post('/v1/admin/plans/activate', { ...base, ownerPhone: '0901 234 567', bankTxId: 'BT-2' }).expect(404);
    await adminApi.post('/v1/admin/plans/activate', { ...base, organizationId: farm, ownerPhone: '0905112233', bankTxId: 'BT-3' }).expect(422);
  });
});

describe('đặt lại mật khẩu', () => {
  it('chỉ cho người không có email khôi phục; ghi nhật ký; số lạ → 404', async () => {
    const userId = newId();
    auth.emails.set(userId, '84907000111@id.thumua365.vn');
    await admin.query(`insert into profiles (id, name, phone) values ($1, 'Chị Lan', '+84907000111')`, [userId]);
    const adminApi = await as(ADMIN_ID);
    await adminApi.post('/v1/admin/users/reset-password', { phone: '0907 000 111', newPassword: 'mat-khau-moi', approvedBy: 'Tài', reason: 'Gọi Zalo, đối chiếu phiếu' }).expect(200);
    expect(auth.passwords.get(userId)).toBe('mat-khau-moi');
    const { rows } = await admin.query('select action, user_id from admin_access_log');
    expect(rows).toEqual([{ action: 'reset-password', user_id: userId }]);

    await admin.query(`update profiles set recovery_email = 'lan@example.com' where id = $1`, [userId]);
    const own = await adminApi.post('/v1/admin/users/reset-password', { phone: '0907000111', newPassword: 'khac-nua-1', approvedBy: 'Tài' }).expect(422);
    expect(ErrorBody.parse(own.body).error.details).toMatchObject({ reason: 'HAS_RECOVERY_EMAIL' });
    await adminApi.post('/v1/admin/users/reset-password', { phone: '0901 234 567', newPassword: 'khac-nua-1', approvedBy: 'Tài' }).expect(404);
  });
});

describe('ai mua gói được', () => {
  it('nông dân, người cân không mua được; xem gói cần billing:manage', async () => {
    const mai = newId();
    const farm = await createOrg('farmer', mai, 'Hộ cô Mai');
    await (await as(mai, farm)).post('/v1/billing/intents', { months: 1 }).expect(403);
    const farmView = SubscriptionView.parse((await (await as(mai, farm)).get('/v1/me/subscription').expect(200)).body);
    expect(farmView).toMatchObject({ plan: null, selfServe: false, prices: [] });

    const staff = newId();
    await addMember(vua, staff, 'staff');
    await (await as(staff, vua)).get('/v1/me/subscription').expect(403);
    await (await as(staff, vua)).post('/v1/billing/intents', { months: 1 }).expect(403);
    await (await as(vuaOwner, vua)).post('/v1/billing/intents', { months: 6 }).expect(422);
  });
});

describe('#8 — luật ở database', () => {
  it('🔴 api_service không tự mở / gia hạn gói, không tự đánh dấu "đã trả", không sửa số tiền', async () => {
    const asOwner = { userId: vuaOwner, orgId: vua };
    expect(await serviceError(asOwner, `update subscriptions set status = 'active', current_period_end = now() + interval '1 year'`)).toMatch(
      /webhook/,
    );
    expect(await serviceError(asOwner, `update subscriptions set branch_limit = 99`)).toMatch(/webhook/);
    expect(
      await serviceError(asOwner, `insert into subscriptions (organization_id, status, current_period_end) values ($1, 'active', now() + interval '1 year')`, [
        vua,
      ]),
    ).toMatch(/dùng thử/);

    const intent = PaymentIntentView.parse((await (await as(vuaOwner, vua)).post('/v1/billing/intents', { months: 1 }).expect(200)).body);
    expect(await serviceError(asOwner, `update payment_intents set status = 'paid' where id = $1`, [intent.id])).toMatch(/đã trả/);
    expect(await serviceError(asOwner, `update payment_intents set amount = 1000 where id = $1`, [intent.id])).toMatch(/số tiền/);
    expect(await serviceError(asOwner, `insert into bank_transactions (bank_tx_id, amount) values ('X', 1)`)).toMatch(/permission denied/);
  });
});
