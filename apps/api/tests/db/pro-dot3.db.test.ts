/**
 * Đợt 3 của KE_HOACH_GOI_PRO trên Postgres thật:
 *   V9  — giá thu mua trên điểm bản đồ: khai giá cần `map:prices`; chủ hết gói thì giá không hiện với ai
 *   V15 — hợp đồng mùa vụ đi qua đẩy / kéo sổ như mọi bảng sổ; người cân không tạo được
 *   V24 — mặt hàng cà phê tươi mang tỷ lệ tươi / nhân; dòng phiếu giữ tỷ lệ, tiền theo `lossPercent`
 * Chỉ Supabase Auth Admin là giả.
 */

import { ErrorBody, Place, PlacesList, SyncPullResult, SyncPushResult } from '@mambo/contracts';
import { lossFromGreenRatio } from '@mambo/core/calc';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaMemberships } from '../../src/auth/prisma-memberships';
import { Database } from '../../src/db/database';
import { FakeSupabaseAdmin, buildTestApp, makeSigner, testEnv } from '../helpers';
import { SERVICE_URL, admin, createOrg, newId, service, truncateAll } from './db';
import { addMember, giveTrial, opMaker, txData } from './sync-fixture';

let app: INestApplication;
let signer: Awaited<ReturnType<typeof makeSigner>>;

let vua: string;
let vuaOwner: string;
let staff: string;
let farm: string;
let farmer: string;

beforeAll(async () => {
  signer = await makeSigner();
  const db = new Database(SERVICE_URL);
  app = await buildTestApp({
    env: testEnv({ DATABASE_URL: SERVICE_URL, RATE_LIMIT_PER_MINUTE: '10000' }),
    jwks: signer.jwks,
    supabaseAdmin: new FakeSupabaseAdmin(),
    db,
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
    patch: (path: string, body: object) => withAuth(http().patch(path).send(body)),
    push: async (ops: unknown[]) =>
      SyncPushResult.parse((await withAuth(http().post('/v1/sync/push').send({ deviceId: newId(), ops })).expect(200)).body).results,
    pull: async () => SyncPullResult.parse((await withAuth(http().get('/v1/sync/pull')).expect(200)).body),
  };
};

const expire = (orgId: string) =>
  admin.query(`update subscriptions set trial_ends_at = now() - interval '30 day' where organization_id = $1`, [orgId]);
const errorOf = (res: request.Response) => ErrorBody.parse(res.body).error;

const BBOX = '102,7,118,24';
const PEPPER = [{ product: 'Tiêu', price: 142_000, unit: 'kg' }];

beforeEach(async () => {
  await truncateAll();
  vuaOwner = newId();
  staff = newId();
  farmer = newId();
  vua = await createOrg('trader', vuaOwner, 'Vựa Tư Hùng');
  await giveTrial(vua);
  await addMember(vua, staff, 'staff');
  farm = await createOrg('farmer', farmer, 'Hộ cô Mai');
});

describe('V9 — giá thu mua trên bản đồ', () => {
  it('vựa còn gói khai giá; nông dân thấy giá và lúc khai', async () => {
    const owner = await as(vuaOwner, vua);
    const created = Place.parse(
      (await owner.post('/v1/org/places', { name: 'Vựa Tư Hùng', lat: 11.95, lng: 106.85, prices: PEPPER }).expect(200)).body,
    );
    expect(created.prices).toEqual(PEPPER);
    expect(created.pricesUpdatedAt).not.toBeNull();

    const seen = PlacesList.parse((await (await as(farmer, farm)).get(`/v1/places?bbox=${BBOX}`).expect(200)).body);
    expect(seen.items[0]?.prices).toEqual(PEPPER);
  });

  it('hết gói: khai giá → 402 PLAN_REQUIRED; giá đã khai không hiện với ai; gỡ giá và sửa tên vẫn được', async () => {
    const owner = await as(vuaOwner, vua);
    const { id } = Place.parse((await owner.post('/v1/org/places', { name: 'Vựa', lat: 11.95, lng: 106.85, prices: PEPPER }).expect(200)).body);
    await expire(vua);

    const res = await owner.patch(`/v1/org/places/${id}`, { prices: PEPPER }).expect(402);
    expect(errorOf(res)).toMatchObject({ code: 'PLAN_REQUIRED', details: { entitlement: 'map:prices' } });
    await owner.post('/v1/org/places', { name: 'Điểm 2', lat: 11.9, lng: 106.8, prices: PEPPER }).expect(402);

    const seen = PlacesList.parse((await (await as(farmer, farm)).get(`/v1/places?bbox=${BBOX}`).expect(200)).body);
    expect(seen.items.map((p) => [p.prices, p.pricesUpdatedAt])).toEqual([[[], null]]);

    const renamed = Place.parse((await owner.patch(`/v1/org/places/${id}`, { name: 'Vựa mới', prices: null }).expect(200)).body);
    expect(renamed.name).toBe('Vựa mới');
    const { rows } = await admin.query(`select prices, prices_updated_at from places where id = $1`, [id]);
    expect(rows[0]).toEqual({ prices: null, prices_updated_at: null });
  });

  it('gia hạn lại thì giá cũ hiện lại, không phải khai lại', async () => {
    const owner = await as(vuaOwner, vua);
    await owner.post('/v1/org/places', { name: 'Vựa', lat: 11.95, lng: 106.85, prices: PEPPER }).expect(200);
    await expire(vua);
    await admin.query(`update subscriptions set trial_ends_at = now() + interval '30 day' where organization_id = $1`, [vua]);
    const seen = PlacesList.parse((await (await as(farmer, farm)).get(`/v1/places?bbox=${BBOX}`).expect(200)).body);
    expect(seen.items[0]?.prices).toEqual(PEPPER);
  });
});

describe('V15 — hợp đồng mùa vụ', () => {
  const contract = (over: Record<string, unknown> = {}) => ({
    kind: 'purchase',
    counterpartyName: 'Cô Mai',
    productName: 'Cà phê nhân',
    quantity: 10_000,
    pricePerUnit: 98_000,
    startDate: '2026-11-01T00:00:00.000Z',
    endDate: '2027-01-31T00:00:00.000Z',
    ...over,
  });

  it('chủ tạo, sửa, đóng; kéo về đủ trường, mặc định server điền', async () => {
    const owner = await as(vuaOwner, vua);
    const id = newId();
    const op = opMaker();
    expect((await owner.push([op('seasonContract', 'insert', id, contract())])).map((r) => r.status)).toEqual(['applied']);
    expect((await owner.push([op('seasonContract', 'update', id, { closed: true })])).map((r) => r.status)).toEqual(['applied']);

    const { changes } = await owner.pull();
    expect(changes.seasonContracts).toHaveLength(1);
    expect(changes.seasonContracts[0]).toMatchObject({
      id,
      kind: 'purchase',
      counterpartyId: null,
      productId: null,
      unit: 'kg',
      quantity: 10_000,
      pricePerUnit: 98_000,
      note: null,
      closed: true,
      createdBy: vuaOwner,
    });
  });

  it('người cân không tạo được (`partner:manage`); ngày kết thúc trước ngày bắt đầu bị từ chối', async () => {
    const [byStaff] = await (await as(staff, vua)).push([opMaker()('seasonContract', 'insert', newId(), contract())]);
    expect(byStaff).toMatchObject({ status: 'rejected', error: { code: 'FORBIDDEN' } });

    const [backwards] = await (await as(vuaOwner, vua)).push([
      opMaker()('seasonContract', 'insert', newId(), contract({ endDate: '2026-10-01T00:00:00.000Z' })),
    ]);
    expect(backwards).toMatchObject({ status: 'rejected', error: { code: 'VALIDATION_FAILED' } });
  });

  it('sửa mỗi một ngày, vượt qua ngày đã lưu → VALIDATION_FAILED (không thử lại), không phải INTERNAL', async () => {
    const owner = await as(vuaOwner, vua);
    const id = newId();
    const op = opMaker();
    await owner.push([op('seasonContract', 'insert', id, contract())]);

    const [endEarly] = await owner.push([op('seasonContract', 'update', id, { endDate: '2026-10-01T00:00:00.000Z' })]);
    expect(endEarly).toMatchObject({ status: 'rejected', error: { code: 'VALIDATION_FAILED' } });
    const [startLate] = await owner.push([op('seasonContract', 'update', id, { startDate: '2027-02-01T00:00:00.000Z' })]);
    expect(startLate).toMatchObject({ status: 'rejected', error: { code: 'VALIDATION_FAILED' } });

    const [ok] = await owner.push([op('seasonContract', 'update', id, { endDate: '2026-12-31T00:00:00.000Z' })]);
    expect(ok?.status).toBe('applied');
  });

  it('ngày khác múi giờ so theo thời điểm, không theo chuỗi', async () => {
    // 06:00 +07:00 ngày 1/11 = 23:00Z ngày 31/10 — trước 00:00Z ngày 1/11, dù chuỗi "lớn hơn".
    const [res] = await (await as(vuaOwner, vua)).push([
      opMaker()('seasonContract', 'insert', newId(), contract({ startDate: '2026-11-01T06:00:00+07:00', endDate: '2026-11-01T00:00:00.000Z' })),
    ]);
    expect(res?.status).toBe('applied');
  });

  it('RLS: tổ chức khác không kéo được hợp đồng', async () => {
    const owner = await as(vuaOwner, vua);
    await owner.push([opMaker()('seasonContract', 'insert', newId(), contract())]);
    const otherOwner = newId();
    const other = await createOrg('trader', otherOwner, 'Vựa khác');
    await giveTrial(other);
    expect((await (await as(otherOwner, other)).pull()).changes.seasonContracts).toEqual([]);
  });
});

describe('V24 — quy đổi cà phê tươi → nhân', () => {
  it('mặt hàng giữ tỷ lệ; dòng phiếu giữ tỷ lệ, tiền theo lossPercent', async () => {
    const owner = await as(vuaOwner, vua);
    const op = opMaker();
    const productId = newId();
    const txId = newId();
    const line = {
      id: 'l1',
      productId,
      productName: 'Cà phê tươi',
      unit: 'kg',
      formulaType: 'lossPercent',
      grossWeight: 450,
      lossPercent: lossFromGreenRatio(4.5),
      greenRatio: 4.5,
      pricePerUnit: 120_000,
      rawTotal: 12_000_000,
      roundedTotal: 12_000_000,
    };
    const results = await owner.push([
      op('product', 'insert', productId, { name: 'Cà phê tươi', formulaType: 'lossPercent', greenRatio: 4.5 }),
      op('transaction', 'insert', txId, txData({ lines: [line] })),
    ]);
    expect(results.map((r) => r.status)).toEqual(['applied', 'applied']);

    const { changes } = await owner.pull();
    expect(changes.products.find((p) => p.id === productId)?.greenRatio).toBe(4.5);
    expect(changes.transactions[0]?.lines[0]).toMatchObject({ greenRatio: 4.5, roundedTotal: 12_000_000 });

    const [bad] = await owner.push([op('product', 'update', productId, { greenRatio: 1 })]);
    expect(bad).toMatchObject({ status: 'rejected', error: { code: 'VALIDATION_FAILED' } });
  });
});
