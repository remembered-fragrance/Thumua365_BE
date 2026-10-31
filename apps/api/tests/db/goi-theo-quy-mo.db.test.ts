/**
 * Gói theo quy mô (0.28.0) trên Postgres thật — TODO_DASHBOARD_VA_4_GOI §3a:
 *   - webhook mở đúng gói / số tháng / số người cân đọc TỪ Ý ĐỊNH; ý định cũ 149k / 1.490k vẫn mở gói Vựa
 *   - đổi gói giữa kỳ: Thương lái → Vựa quy đổi ngày còn lại; hạ Vựa → Thương lái chỉ khi hết hạn
 *   - người cân: Vựa 3 + mua thêm (tối đa 5), mua giữa kỳ theo ngày còn lại, gia hạn chọn lại số người
 *   - gói Thương lái (kể cả dùng thử) không thêm người, không xem nhật ký — câu báo mời lên gói Vựa
 * Chỉ Supabase Auth Admin là giả.
 */

import { extendPeriod } from '@mambo/core/subscription';
import { newTransferCode } from '@mambo/core/transferCode';
import { ErrorBody, Me, PaymentIntentsList, PaymentIntentView, SubscriptionView } from '@mambo/contracts';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaMemberships } from '../../src/auth/prisma-memberships';
import { Database } from '../../src/db/database';
import { PrivilegedDatabase } from '../../src/db/privileged-database';
import { FakeSupabaseAdmin, buildTestApp, makeSigner, testEnv } from '../helpers';
import { SERVICE_URL, admin, createOrg, newId, service, truncateAll } from './db';
import { addMember } from './sync-fixture';

const PRIVILEGED_URL =
  process.env.TEST_DATABASE_PRIVILEGED_URL ?? 'postgresql://api_privileged:api_privileged_dev@localhost:54329/thumua365';
const SECRET = 'bi-mat-webhook-dai-it-nhat-24-ky-tu';
const DAY_MS = 86_400_000;

let app: INestApplication;
let signer: Awaited<ReturnType<typeof makeSigner>>;
// Tạo người giới hạn 20 lần/phút mỗi IP — mỗi test một IP, như plan-walls.db.test.
let clientIp = 0;

let vua: string;
let owner: string;

beforeAll(async () => {
  signer = await makeSigner();
  const db = new Database(SERVICE_URL);
  app = await buildTestApp({
    env: testEnv({
      DATABASE_URL: SERVICE_URL,
      PRIVILEGED_DATABASE_URL: PRIVILEGED_URL,
      BANK_WEBHOOK_SECRET: SECRET,
      RATE_LIMIT_PER_MINUTE: '10000',
      CLIENT_IP_HEADER: 'cf-connecting-ip',
    }),
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

const as = async (userId: string, orgId: string) => {
  const token = await signer.sign({ sub: userId });
  const ip = `10.0.1.${clientIp}`;
  const authed = <T extends request.Test>(r: T) =>
    r.set('authorization', `Bearer ${token}`).set('x-organization-id', orgId).set('cf-connecting-ip', ip);
  const http = () => request(app.getHttpServer());
  return {
    get: (path: string) => authed(http().get(path)),
    post: (path: string, body: object) => authed(http().post(path).send(body)),
  };
};

const errorOf = (res: request.Response) => ErrorBody.parse(res.body).error;

let tid = 0;
/** Tiền vào đúng số, đúng nội dung của ý định. */
const pay = (intent: { amount: number; transferContent: string }) =>
  request(app.getHttpServer())
    .post('/v1/webhooks/bank')
    .set('secure-token', SECRET)
    .send({ error: 0, data: [{ id: 1, tid: `FT-${++tid}`, amount: intent.amount, description: intent.transferContent }] })
    .expect(200);

const buy = async (body: object, status: number, orgId = vua, userId = owner) =>
  (await as(userId, orgId)).post('/v1/billing/intents', body).expect(status);
const intentOf = (res: request.Response) => PaymentIntentView.parse(res.body);
const offer = async (orgId = vua, userId = owner) => SubscriptionView.parse((await (await as(userId, orgId)).get('/v1/me/subscription').expect(200)).body);

const subOf = async (orgId = vua) =>
  (
    await admin.query<{ status: string; plan: string | null; extra_staff: number; billing_months: number | null; current_period_end: Date | null }>(
      'select status, plan, extra_staff, billing_months, current_period_end from subscriptions where organization_id = $1',
      [orgId],
    )
  ).rows[0];

/** Đặt gói bằng tay (role postgres): `paidDays` > 0 còn hạn, < 0 đã hết; null = đang dùng thử còn 30 ngày. */
const setPlan = async (plan: 'thuong_lai' | 'vua', paidDays: number | null, extraStaff = 0, billingMonths: 1 | 12 = 1) => {
  if (paidDays === null) {
    await admin.query(
      `update subscriptions set status = 'trialing', trial_ends_at = now() + interval '30 days', current_period_end = null,
         plan = $2, extra_staff = 0, billing_months = null where organization_id = $1`,
      [vua, plan],
    );
    return;
  }
  await admin.query(
    `update subscriptions set status = 'active', trial_ends_at = null, current_period_end = now() + make_interval(days => $2),
       plan = $3, extra_staff = $4, billing_months = $5 where organization_id = $1`,
    [vua, paidDays, plan, extraStaff, billingMonths],
  );
};

const addStaff = async (n: number) => {
  for (let i = 0; i < n; i++) await addMember(vua, newId(), 'staff');
};

/** Hạn mới so với mốc mong đợi — lệch vài giây do thời gian chạy request. */
const closeTo = (actual: Date | null | undefined, expected: Date) =>
  expect(Math.abs((actual?.getTime() ?? 0) - expected.getTime())).toBeLessThan(60_000);

let phoneSeq = 0;
const staffInput = () => ({ name: `Người cân ${++phoneSeq}`, phone: `0904 ${String(100_000 + phoneSeq)}`, password: 'matkhau-12', role: 'staff' });

beforeEach(async () => {
  await truncateAll();
  clientIp += 1;
  owner = newId();
  vua = await createOrg('trader', owner, 'Vựa Tư Hùng');
  // Dùng thử đã hết; trigger điền gói Vựa như mọi tài khoản vựa cũ.
  await admin.query(`insert into subscriptions (organization_id, status, trial_ends_at) values ($1, 'trialing', now() - interval '40 days')`, [vua]);
});

describe('webhook mở đúng gói từ ý định', () => {
  const cases = [
    { plan: 'thuong_lai', months: 1, amount: 199_000 },
    { plan: 'thuong_lai', months: 12, amount: 1_990_000 },
    { plan: 'vua', months: 1, amount: 449_000 },
    { plan: 'vua', months: 12, amount: 4_490_000 },
  ] as const;

  for (const c of cases) {
    it(`${c.plan} ${c.months} tháng = ${c.amount}đ → gói, kỳ ghi vào gói`, async () => {
      const intent = intentOf(await buy({ kind: 'plan', plan: c.plan, months: c.months }, 200));
      expect(intent).toMatchObject({ amount: c.amount, kind: 'plan', plan: c.plan, months: c.months, extraStaff: 0 });
      await pay(intent);

      const sub = await subOf();
      expect(sub).toMatchObject({ status: 'active', plan: c.plan, extra_staff: 0, billing_months: c.months });
      closeTo(sub?.current_period_end, new Date(extendPeriod(undefined, new Date(), c.months)));
    });
  }

  it('ý định tạo trước 0.28.0 (149.000đ / 1.490.000đ, không có cột gói) vẫn mở được — thành gói Vựa', async () => {
    await setPlan('thuong_lai', -40);
    const legacy = async (amount: number) => {
      const code = newTransferCode();
      const id = newId();
      await admin.query(
        `insert into payment_intents (id, organization_id, created_by, amount, status, provider, provider_ref)
         values ($1, $2, $3, $4, 'pending', 'vietqr', $5)`,
        [id, vua, owner, amount, code],
      );
      return { id, amount, transferContent: `TM365 ${code}` };
    };

    const month = await legacy(149_000);
    await pay(month);
    let sub = await subOf();
    expect(sub).toMatchObject({ status: 'active', plan: 'vua', billing_months: 1 });
    closeTo(sub?.current_period_end, new Date(extendPeriod(undefined, new Date(), 1)));

    const year = await legacy(1_490_000);
    const before = sub?.current_period_end;
    await pay(year);
    sub = await subOf();
    expect(sub).toMatchObject({ plan: 'vua', billing_months: 12 });
    closeTo(sub?.current_period_end, new Date(extendPeriod(before?.toISOString(), new Date(), 12)));

    const { intents } = PaymentIntentsList.parse((await (await as(owner, vua)).get('/v1/billing/intents').expect(200)).body);
    expect(intents.map((i) => [i.amount, i.kind, i.plan, i.months, i.status])).toEqual([
      [1_490_000, 'plan', 'vua', 12, 'paid'],
      [149_000, 'plan', 'vua', 1, 'paid'],
    ]);
  });

  it('doanh nghiệp vẫn không tự mua — gói lẫn người cân', async () => {
    const dnOwner = newId();
    const dn = await createOrg('enterprise', dnOwner);
    await buy({ kind: 'plan', plan: 'vua', months: 1 }, 403, dn, dnOwner);
    await buy({ kind: 'staff', extraStaff: 1 }, 403, dn, dnOwner);
  });
});

describe('đổi gói', () => {
  it('Thương lái còn 21 ngày → mua Vựa 1 tháng: ⌈21 × 199/449⌉ = 10 ngày Vựa + 1 tháng', async () => {
    await setPlan('thuong_lai', 21);
    const intent = intentOf(await buy({ kind: 'plan', plan: 'vua', months: 1 }, 200));
    expect(intent.amount).toBe(449_000);
    await pay(intent);

    const sub = await subOf();
    expect(sub).toMatchObject({ plan: 'vua', billing_months: 1 });
    const now = Date.now();
    closeTo(sub?.current_period_end, new Date(extendPeriod(new Date(now + 10 * DAY_MS).toISOString(), new Date(now), 1)));
  });

  it('Thương lái đang dùng thử → mua Vựa: không có ngày đã trả để quy đổi, hạn = hôm nay + số tháng', async () => {
    await setPlan('thuong_lai', null);
    await pay(intentOf(await buy({ kind: 'plan', plan: 'vua', months: 1 }, 200)));
    const sub = await subOf();
    expect(sub?.plan).toBe('vua');
    closeTo(sub?.current_period_end, new Date(extendPeriod(undefined, new Date(), 1)));
  });

  it('Vựa còn hạn → không mua được Thương lái; hết hạn (ân hạn) thì mua được, không quy đổi ngày', async () => {
    await setPlan('vua', 10);
    const locked = await buy({ kind: 'plan', plan: 'thuong_lai', months: 1 }, 422);
    expect(errorOf(locked).details).toMatchObject({ reason: 'DOWNGRADE_LOCKED' });

    await setPlan('vua', -2, 2);
    const intent = intentOf(await buy({ kind: 'plan', plan: 'thuong_lai', months: 1 }, 200));
    expect(intent.amount).toBe(199_000);
    await pay(intent);
    const sub = await subOf();
    expect(sub).toMatchObject({ plan: 'thuong_lai', extra_staff: 0 });
    closeTo(sub?.current_period_end, new Date(extendPeriod(undefined, new Date(), 1)));
  });

  it('hạ xuống Thương lái lúc hết hạn mà còn người cân → khoá bớt người cân trước', async () => {
    await setPlan('vua', -2);
    await addStaff(1);
    const res = await buy({ kind: 'plan', plan: 'thuong_lai', months: 1 }, 422);
    expect(errorOf(res)).toMatchObject({ details: { reason: 'STAFF_IN_USE', used: 1, limit: 0 } });
  });
});

describe('người cân', () => {
  it('Vựa đủ 3 người → người thứ 4 MEMBER_LIMIT; mua thêm 1 người → hạn không đổi, thêm được', async () => {
    await setPlan('vua', 30);
    await addStaff(3);
    const api = await as(owner, vua);
    const fourth = await api.post('/v1/org/members', staffInput()).expect(402);
    expect(errorOf(fourth)).toMatchObject({ code: 'MEMBER_LIMIT', details: { limit: 3 } });
    expect(errorOf(fourth).message).toContain('mua thêm người cân');

    const before = (await subOf())?.current_period_end;
    const intent = intentOf(await buy({ kind: 'staff', extraStaff: 1 }, 200));
    expect(intent).toMatchObject({ kind: 'staff', plan: null, months: 1, extraStaff: 1, amount: 79_000 });
    await pay(intent);

    const sub = await subOf();
    expect(sub).toMatchObject({ plan: 'vua', extra_staff: 1 });
    expect(sub?.current_period_end?.getTime()).toBe(before?.getTime());
    await api.post('/v1/org/members', staffInput()).expect(200);

    const me = Me.parse((await api.get('/v1/me').expect(200)).body);
    expect(me.memberships[0]?.plan).toMatchObject({ plan: 'vua', extraStaff: 1, staffLimit: 4 });
  });

  it('mua giữa kỳ còn 20 ngày (kỳ tháng), 2 người → 105.000đ; giá báo trước khớp giá ý định', async () => {
    await setPlan('vua', 20);
    const { staffTopUps } = await offer();
    expect(staffTopUps).toEqual([
      { extraStaff: 1, amount: 52_000 },
      { extraStaff: 2, amount: 105_000 },
      { extraStaff: 3, amount: 158_000 },
      { extraStaff: 4, amount: 210_000 },
      { extraStaff: 5, amount: 263_000 },
    ]);
    expect(intentOf(await buy({ kind: 'staff', extraStaff: 2 }, 200)).amount).toBe(105_000);
  });

  it('kỳ năm tính đơn giá ngày theo giá năm: còn 100 ngày, 1 người → ⌊790.000 × 100/365⌋ = 216.000đ', async () => {
    await setPlan('vua', 100, 0, 12);
    expect(intentOf(await buy({ kind: 'staff', extraStaff: 1 }, 200)).amount).toBe(216_000);
  });

  it('quá 5 người thêm → 422; đang có 5 thì không còn giá mua thêm', async () => {
    await setPlan('vua', 20, 4);
    expect((await offer()).staffTopUps.map((t) => t.extraStaff)).toEqual([1]);
    const res = await buy({ kind: 'staff', extraStaff: 2 }, 422);
    expect(errorOf(res).details).toMatchObject({ reason: 'EXTRA_STAFF_MAX', extraStaff: 4 });

    await setPlan('vua', 20, 5);
    expect((await offer()).staffTopUps).toEqual([]);
  });

  it('Thương lái, Vựa đang dùng thử, Vựa ân hạn → không mua người cân', async () => {
    for (const [plan, days] of [
      ['thuong_lai', 20],
      ['vua', null],
      ['vua', -2],
    ] as const) {
      await setPlan(plan, days);
      expect((await offer()).staffTopUps, `${plan} ${days}`).toEqual([]);
      const res = await buy({ kind: 'staff', extraStaff: 1 }, 422);
      expect(errorOf(res).details, `${plan} ${days}`).toMatchObject({ reason: 'STAFF_NOT_AVAILABLE' });
    }
  });

  it('gia hạn Vựa + 2 người = 607.000đ (năm 6.070.000đ) → ghi số người cân thêm', async () => {
    await setPlan('vua', 5);
    const month = intentOf(await buy({ kind: 'plan', plan: 'vua', months: 1, extraStaff: 2 }, 200));
    expect(month).toMatchObject({ amount: 607_000, extraStaff: 2 });
    expect(intentOf(await buy({ kind: 'plan', plan: 'vua', months: 12, extraStaff: 2 }, 200)).amount).toBe(6_070_000);

    await pay(month);
    expect(await subOf()).toMatchObject({ plan: 'vua', extra_staff: 2, billing_months: 1 });
  });

  it('gia hạn bớt chỗ dưới số người đang làm → 422; đủ chỗ thì được', async () => {
    await setPlan('vua', 5, 2);
    await addStaff(5);
    const res = await buy({ kind: 'plan', plan: 'vua', months: 1, extraStaff: 1 }, 422);
    expect(errorOf(res)).toMatchObject({ details: { reason: 'STAFF_IN_USE', used: 5, limit: 4 } });
    await buy({ kind: 'plan', plan: 'vua', months: 1, extraStaff: 2 }, 200);
  });

  it('bấm lại cùng nội dung → cùng ý định; khác số người → ý định mới', async () => {
    await setPlan('vua', 20);
    const a = intentOf(await buy({ kind: 'staff', extraStaff: 2 }, 200));
    expect(intentOf(await buy({ kind: 'staff', extraStaff: 2 }, 200)).id).toBe(a.id);
    expect(intentOf(await buy({ kind: 'staff', extraStaff: 1 }, 200)).id).not.toBe(a.id);
    const plan = intentOf(await buy({ kind: 'plan', plan: 'vua', months: 1 }, 200));
    expect(intentOf(await buy({ months: 1 }, 200)).id).toBe(plan.id);
  });
});

describe('gói Thương lái — quyền lợi', () => {
  it('đang dùng thử Thương lái: không thêm người, không xem nhật ký — câu báo mời lên Vựa', async () => {
    await setPlan('thuong_lai', null);
    const api = await as(owner, vua);
    const add = await api.post('/v1/org/members', staffInput()).expect(402);
    expect(errorOf(add)).toMatchObject({ code: 'PLAN_REQUIRED', details: { entitlement: 'members:add', requiredPlan: 'vua' } });
    expect(errorOf(add).message).toContain('gói Vựa');
    const audit = await api.get('/v1/audit').expect(402);
    expect(errorOf(audit)).toMatchObject({ code: 'PLAN_REQUIRED', details: { entitlement: 'audit:view', requiredPlan: 'vua' } });
  });

  it('Vựa hết hạn: vẫn là câu "hết hạn", không mời đổi gói', async () => {
    await setPlan('vua', -40);
    const add = await (await as(owner, vua)).post('/v1/org/members', staffInput()).expect(402);
    expect(errorOf(add).details).toEqual({ entitlement: 'members:add' });
  });
});
