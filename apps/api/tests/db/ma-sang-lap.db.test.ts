/**
 * Mã Khách hàng sáng lập (0.29.0) trên Postgres thật — TODO_KIEM_BANG_GIA_GD1 §C:
 *   - chủ tài khoản vựa nhập mã → gắn với tổ chức; mã sai / đã có người dùng cùng một câu báo
 *   - Thương lái tháng 149.000đ, năm 12 × 149.000 = 1.788.000đ (chỉ khi còn đủ 12 kỳ); Vựa giữ giá niêm yết
 *   - tiền vào mới trừ kỳ; hết 12 kỳ về 199.000đ
 *   - database chặn api_service tự gắn mã / dùng mã của tổ chức khác
 * Chỉ Supabase Auth Admin là giả.
 */

import { ErrorBody, PaymentIntentView, SubscriptionView } from '@mambo/contracts';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaMemberships } from '../../src/auth/prisma-memberships';
import { Database } from '../../src/db/database';
import { PrivilegedDatabase } from '../../src/db/privileged-database';
import { FakeSupabaseAdmin, buildTestApp, makeSigner, testEnv } from '../helpers';
import { SERVICE_URL, admin, asService, createOrg, newId, service, serviceError, truncateAll } from './db';
import { addMember } from './sync-fixture';

const PRIVILEGED_URL =
  process.env.TEST_DATABASE_PRIVILEGED_URL ?? 'postgresql://api_privileged:api_privileged_dev@localhost:54329/thumua365';
const SECRET = 'bi-mat-webhook-dai-it-nhat-24-ky-tu';
const CODE = 'SL149-TEST01';

let app: INestApplication;
let signer: Awaited<ReturnType<typeof makeSigner>>;
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
  const ip = `10.0.2.${clientIp}`;
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
const pay = (intent: { amount: number; transferContent: string }) =>
  request(app.getHttpServer())
    .post('/v1/webhooks/bank')
    .set('secure-token', SECRET)
    .send({ error: 0, data: [{ id: 1, tid: `FT-SL-${++tid}`, amount: intent.amount, description: intent.transferContent }] })
    .expect(200);

const redeem = async (code: string, status: number, orgId = vua, userId = owner) =>
  (await as(userId, orgId)).post('/v1/billing/promo-codes', { code }).expect(status);
const buy = async (body: object, orgId = vua, userId = owner) =>
  PaymentIntentView.parse((await (await as(userId, orgId)).post('/v1/billing/intents', body).expect(200)).body);
const offer = async (orgId = vua) => SubscriptionView.parse((await (await as(owner, orgId)).get('/v1/me/subscription').expect(200)).body);
const priceOf = (view: SubscriptionView, plan: string, months: number) =>
  view.prices.find((p) => p.plan === plan && p.months === months)?.amount;

const addCode = (code = CODE, monthlyAmount = 149_000, periods = 12) =>
  admin.query('insert into promo_codes (code, monthly_amount, periods) values ($1, $2, $3)', [code, monthlyAmount, periods]);
const codeRow = async (code = CODE) =>
  (
    await admin.query<{ organization_id: string | null; periods_used: number; redeemed_by: string | null }>(
      'select organization_id, periods_used, redeemed_by from promo_codes where code = $1',
      [code],
    )
  ).rows[0];

beforeEach(async () => {
  await truncateAll();
  clientIp += 1;
  owner = newId();
  vua = await createOrg('trader', owner, 'Vựa Sáng Lập');
  await admin.query(
    `insert into subscriptions (organization_id, status, trial_ends_at, plan) values ($1, 'trialing', now() + interval '30 days', 'thuong_lai')`,
    [vua],
  );
  await addCode();
});

describe('nhập mã', () => {
  it('chưa có mã: giá niêm yết, promo null', async () => {
    const view = await offer();
    expect(view.promo).toBeNull();
    expect(priceOf(view, 'thuong_lai', 1)).toBe(199_000);
    expect(priceOf(view, 'thuong_lai', 12)).toBe(2_030_400);
  });

  it('nhập mã (chữ thường, có khoảng trắng) → gắn với tổ chức, giá Thương lái sau mã, Vựa giữ nguyên', async () => {
    const view = SubscriptionView.parse((await redeem('  sl149-test01 ', 200)).body);
    expect(view.promo).toEqual({ code: CODE, plan: 'thuong_lai', monthlyAmount: 149_000, periods: 12, periodsLeft: 12 });
    expect(priceOf(view, 'thuong_lai', 1)).toBe(149_000);
    expect(priceOf(view, 'thuong_lai', 12)).toBe(1_788_000);
    expect(priceOf(view, 'vua', 1)).toBe(449_000);
    expect(await codeRow()).toMatchObject({ organization_id: vua, periods_used: 0, redeemed_by: owner });
  });

  it('mã sai và mã đã có tổ chức khác dùng → cùng câu báo PROMO_INVALID', async () => {
    const wrong = errorOf(await redeem('SL149-KHONGCO', 422));
    expect(wrong.details).toMatchObject({ reason: 'PROMO_INVALID' });

    await redeem(CODE, 200);
    const otherOwner = newId();
    const other = await createOrg('trader', otherOwner, 'Vựa Khác');
    const taken = errorOf(await redeem(CODE, 422, other, otherOwner));
    expect(taken.details).toMatchObject({ reason: 'PROMO_INVALID' });
    expect(taken.message).toBe(wrong.message);
  });

  it('tổ chức đã có mã → PROMO_ALREADY_APPLIED, mã thứ hai vẫn trống', async () => {
    await addCode('SL149-TEST02');
    await redeem(CODE, 200);
    const err = errorOf(await redeem('SL149-TEST02', 422));
    expect(err.details).toMatchObject({ reason: 'PROMO_ALREADY_APPLIED' });
    expect((await codeRow('SL149-TEST02'))?.organization_id).toBeNull();
  });

  it('gói Vựa đã trả còn hạn → PROMO_PLAN_LOCKED, mã vẫn trống; Vựa đang dùng thử / đã hết hạn thì nhập được', async () => {
    await admin.query(
      `update subscriptions set status = 'active', trial_ends_at = null, current_period_end = now() + interval '20 days', plan = 'vua'
       where organization_id = $1`,
      [vua],
    );
    const err = errorOf(await redeem(CODE, 422));
    expect(err.details).toMatchObject({ reason: 'PROMO_PLAN_LOCKED' });
    expect((await codeRow())?.organization_id).toBeNull();

    await admin.query(`update subscriptions set current_period_end = now() - interval '40 days' where organization_id = $1`, [vua]);
    await redeem(CODE, 200);

    const trialOwner = newId();
    const trialVua = await createOrg('trader', trialOwner, 'Vựa dùng thử');
    await admin.query(
      `insert into subscriptions (organization_id, status, trial_ends_at, plan) values ($1, 'trialing', now() + interval '30 days', 'vua')`,
      [trialVua],
    );
    await addCode('SL149-TEST03');
    await redeem('SL149-TEST03', 200, trialVua, trialOwner);
  });

  it('người cân không nhập được (không có billing:manage); doanh nghiệp → 403', async () => {
    await admin.query(`update subscriptions set plan = 'vua' where organization_id = $1`, [vua]);
    const staff = newId();
    await addMember(vua, staff, 'staff');
    await redeem(CODE, 403, vua, staff);

    const entOwner = newId();
    const ent = await createOrg('enterprise', entOwner, 'Công ty');
    await redeem(CODE, 403, ent, entOwner);
    expect((await codeRow())?.organization_id).toBeNull();
  });

  it('mã không đúng dạng → 400/422 từ kiểm đầu vào, không chạm database', async () => {
    const res = await (await as(owner, vua)).post('/v1/billing/promo-codes', { code: 'a b' });
    expect([400, 422]).toContain(res.status);
  });
});

describe('mua và trừ kỳ', () => {
  it('tháng 149.000đ: tạo ý định chưa trừ kỳ; tiền vào trừ 1; webhook gọi lại không trừ lần nữa', async () => {
    await redeem(CODE, 200);
    const intent = await buy({ kind: 'plan', plan: 'thuong_lai', months: 1 });
    expect(intent.amount).toBe(149_000);
    expect((await codeRow())?.periods_used).toBe(0);

    await pay(intent);
    expect((await codeRow())?.periods_used).toBe(1);
    await request(app.getHttpServer())
      .post('/v1/webhooks/bank')
      .set('secure-token', SECRET)
      .send({ error: 0, data: [{ id: 1, tid: `FT-SL-${tid}`, amount: intent.amount, description: intent.transferContent }] })
      .expect(200);
    expect((await codeRow())?.periods_used).toBe(1);
    expect((await offer()).promo?.periodsLeft).toBe(11);
  });

  it('năm 1.788.000đ trừ đủ 12 kỳ → sau đó về giá niêm yết', async () => {
    await redeem(CODE, 200);
    const intent = await buy({ kind: 'plan', plan: 'thuong_lai', months: 12 });
    expect(intent.amount).toBe(1_788_000);
    await pay(intent);
    expect((await codeRow())?.periods_used).toBe(12);

    const view = await offer();
    expect(view.promo?.periodsLeft).toBe(0);
    expect(priceOf(view, 'thuong_lai', 1)).toBe(199_000);
    expect((await buy({ kind: 'plan', plan: 'thuong_lai', months: 1 })).amount).toBe(199_000);
  });

  it('đã dùng 1 kỳ → năm về 2.030.400đ, tháng vẫn 149.000đ', async () => {
    await redeem(CODE, 200);
    await admin.query('update promo_codes set periods_used = 1 where code = $1', [CODE]);
    const view = await offer();
    expect(priceOf(view, 'thuong_lai', 12)).toBe(2_030_400);
    expect(priceOf(view, 'thuong_lai', 1)).toBe(149_000);
    expect((await buy({ kind: 'plan', plan: 'thuong_lai', months: 12 })).amount).toBe(2_030_400);
  });

  it('ý định năm tạo sẵn lúc còn 12 kỳ, trả sau khi đã dùng kỳ → không còn giá mã: 1.788.000đ là chuyển thiếu', async () => {
    await redeem(CODE, 200);
    const year = await buy({ kind: 'plan', plan: 'thuong_lai', months: 12 });
    expect(year.amount).toBe(1_788_000);
    await pay(await buy({ kind: 'plan', plan: 'thuong_lai', months: 1 }));
    expect((await codeRow())?.periods_used).toBe(1);

    const before = (await admin.query<{ current_period_end: Date }>('select current_period_end from subscriptions where organization_id = $1', [vua])).rows[0];
    await pay(year);
    const after = (await admin.query<{ current_period_end: Date; outcome: string }>(
      `select s.current_period_end, b.outcome from subscriptions s, bank_transactions b
       where s.organization_id = $1 and b.bank_tx_id = $2`,
      [vua, `FT-SL-${tid}`],
    )).rows[0];
    expect(after?.outcome).toBe('underpaid');
    expect(after?.current_period_end.getTime()).toBe(before?.current_period_end.getTime());
    expect((await codeRow())?.periods_used).toBe(1);
  });

  it('hết kỳ mà ý định giá mã còn chờ, khách chuyển đủ giá thường → mở gói, không trừ kỳ', async () => {
    await redeem(CODE, 200);
    const month = await buy({ kind: 'plan', plan: 'thuong_lai', months: 1 });
    await admin.query('update promo_codes set periods_used = 12 where code = $1', [CODE]);
    await pay({ ...month, amount: 199_000 });
    const intents = (await admin.query<{ status: string }>('select status from payment_intents where organization_id = $1', [vua])).rows;
    expect(intents.map((r) => r.status)).toEqual(['paid']);
    expect((await codeRow())?.periods_used).toBe(12);
  });

  it('6 tháng 6 × 149.000 = 894.000đ trừ 6 kỳ (0.30.0); hai lần 6 tháng hết 12 kỳ → về 1.074.600đ', async () => {
    await redeem(CODE, 200);
    expect(priceOf(await offer(), 'thuong_lai', 6)).toBe(894_000);
    const first = await buy({ kind: 'plan', plan: 'thuong_lai', months: 6 });
    expect(first.amount).toBe(894_000);
    await pay(first);
    expect((await codeRow())?.periods_used).toBe(6);

    const view = await offer();
    expect(priceOf(view, 'thuong_lai', 6)).toBe(894_000);
    expect(priceOf(view, 'thuong_lai', 12)).toBe(2_030_400);
    await pay(await buy({ kind: 'plan', plan: 'thuong_lai', months: 6 }));
    expect((await codeRow())?.periods_used).toBe(12);
    expect(priceOf(await offer(), 'thuong_lai', 6)).toBe(1_074_600);
  });

  it('còn 5 kỳ → 6 tháng giá thường 1.074.600đ; ý định 894.000đ tạo sẵn lúc còn 6 kỳ thành chuyển thiếu', async () => {
    await redeem(CODE, 200);
    await admin.query('update promo_codes set periods_used = 6 where code = $1', [CODE]);
    const half = await buy({ kind: 'plan', plan: 'thuong_lai', months: 6 });
    expect(half.amount).toBe(894_000);
    await pay(await buy({ kind: 'plan', plan: 'thuong_lai', months: 1 }));
    expect((await codeRow())?.periods_used).toBe(7);
    expect(priceOf(await offer(), 'thuong_lai', 6)).toBe(1_074_600);

    await pay(half);
    const outcome = (await admin.query<{ outcome: string }>('select outcome from bank_transactions where bank_tx_id = $1', [`FT-SL-${tid}`])).rows[0];
    expect(outcome?.outcome).toBe('underpaid');
    expect((await codeRow())?.periods_used).toBe(7);
  });

  it('mua gói Vựa khi có mã → giá Vựa thường, không trừ kỳ', async () => {
    await redeem(CODE, 200);
    const intent = await buy({ kind: 'plan', plan: 'vua', months: 1 });
    expect(intent.amount).toBe(449_000);
    await pay(intent);
    expect((await codeRow())?.periods_used).toBe(0);
  });

  it('ý định giá niêm yết tạo trước khi nhập mã không bị dùng lại cho giá mã', async () => {
    const before = await buy({ kind: 'plan', plan: 'thuong_lai', months: 1 });
    expect(before.amount).toBe(199_000);
    await redeem(CODE, 200);
    const after = await buy({ kind: 'plan', plan: 'thuong_lai', months: 1 });
    expect(after.amount).toBe(149_000);
    expect(after.code).not.toBe(before.code);
  });
});

describe('luật database', () => {
  it('api_service không thấy mã chưa gắn, không tự sửa mã', async () => {
    const seen = await asService({ userId: owner, orgId: vua }, async (c) => (await c.query('select code from promo_codes')).rowCount);
    expect(seen).toBe(0);
    expect(await serviceError({ userId: owner, orgId: vua }, 'update promo_codes set organization_id = $1 where code = $2', [vua, CODE])).toMatch(
      /permission denied/,
    );
  });

  it('api_service không tạo ý định bằng mã của tổ chức khác', async () => {
    const otherOwner = newId();
    const other = await createOrg('trader', otherOwner, 'Vựa Khác');
    await redeem(CODE, 200, other, otherOwner);
    const message = await serviceError(
      { userId: owner, orgId: vua },
      `insert into payment_intents (organization_id, created_by, amount, status, provider, provider_ref, kind, plan, months, promo_code, promo_periods)
       values ($1, $2, 149000, 'pending', 'vietqr', 'ABC123', 'plan', 'thuong_lai', 1, $3, 1)`,
      [vua, owner, CODE],
    );
    expect(message).toMatch(/Mã ưu đãi không thuộc tổ chức này/);
  });
});
