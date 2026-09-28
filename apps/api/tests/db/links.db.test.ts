/**
 * BE4 trên Postgres thật — đúng "Xong khi" của KH: vựa ghi phiếu có nợ → nông dân xác thực OTP,
 * đồng ý → thấy đúng phiếu, đúng số nợ; chưa OTP → PHONE_NOT_VERIFIED; huỷ kết nối → mất quyền
 * ngay. Cộng: chỉ trường in trên biên nhận, lời mời của vựa, vai trò, phân trang, nhật ký.
 * Chỉ Supabase Auth là giả (số điện thoại đã xác thực hay chưa).
 */

import {
  ErrorBody,
  LinkedBalance,
  LinkedReceiptsResult,
  LinksDiscoverResult,
  LinksList,
  LinkSummary,
} from '@mambo/contracts';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaMemberships } from '../../src/auth/prisma-memberships';
import { Database } from '../../src/db/database';
import { FakeSupabaseUsers, buildTestApp, makeSigner, testEnv } from '../helpers';
import { SERVICE_URL, admin, createOrg, createSupplier, newId, service, truncateAll } from './db';
import { addMember, rubberLine } from './sync-fixture';

const MAI_PHONE = '+84912345678';

let app: INestApplication;
let users: FakeSupabaseUsers;
let signer: Awaited<ReturnType<typeof makeSigner>>;

// Vựa Tư Hùng: chủ + người cân. Nông dân cô Mai. Người lạ có một hộ khác.
let vua: string;
let vuaOwner: string;
let vuaStaff: string;
let farm: string;
let mai: string;
let maiSupplier: string;

beforeAll(async () => {
  signer = await makeSigner();
  users = new FakeSupabaseUsers();
  const db = new Database(SERVICE_URL);
  app = await buildTestApp({
    env: testEnv({ DATABASE_URL: SERVICE_URL, RATE_LIMIT_PER_MINUTE: '10000' }),
    jwks: signer.jwks,
    supabaseUsers: users,
    db,
    memberships: new PrismaMemberships(db),
  });
});

afterAll(async () => {
  await app.close();
  await admin.end();
  await service.end();
});

/** Tài khoản Supabase của người đang gọi: số đã xác thực OTP hay chưa. */
const phoneOf = (userId: string, phone: string | null, verified = true) => {
  users.account = {
    id: userId,
    email: null,
    phone: phone?.replace('+', '') ?? null,
    phone_confirmed_at: verified && phone ? '2026-09-28T03:00:00Z' : null,
    user_metadata: {},
  };
};

const as = async (userId: string, orgId: string) => {
  const token = await signer.sign({ sub: userId });
  const withAuth = <T extends request.Test>(r: T) => r.set('authorization', `Bearer ${token}`).set('x-organization-id', orgId);
  const http = () => request(app.getHttpServer());
  return {
    get: (path: string, query: Record<string, string | number> = {}) => withAuth(http().get(path).query(query)),
    post: (path: string, body?: object) => withAuth(body ? http().post(path).send(body) : http().post(path)),
  };
};

/** Phiếu mua của vựa với một người bán: 100kg × 30% × 47.940đ = 1.438.000đ. */
const purchase = async (orgId: string, counterpartyId: string | null, opts: { paid?: number; deleted?: boolean; date?: string } = {}) => {
  const id = newId();
  await admin.query(
    `insert into transactions (id, organization_id, created_by, date, kind, counterparty_id, supplier_name, lines, note, deleted_at)
     values ($1, $2, $3, $4, 'purchase', $5, 'Cô Mai', $6, 'ghi chú nội bộ của vựa', $7)`,
    [id, orgId, vuaOwner, opts.date ?? '2026-09-28T03:00:00Z', counterpartyId, JSON.stringify([rubberLine()]), opts.deleted ? new Date() : null],
  );
  if (opts.paid) {
    await admin.query(
      `insert into payments (id, organization_id, transaction_id, created_by, date, amount) values ($1, $2, $3, $4, now(), $5)`,
      [newId(), orgId, id, vuaOwner, opts.paid],
    );
  }
  return id;
};

beforeEach(async () => {
  await truncateAll();
  vuaOwner = newId();
  vuaStaff = newId();
  mai = newId();
  vua = await createOrg('trader', vuaOwner, 'Vựa Tư Hùng');
  await addMember(vua, vuaStaff, 'staff');
  farm = await createOrg('farmer', mai, 'Hộ cô Mai');
  maiSupplier = await createSupplier(vua, '0912 345 678', 'Cô Mai');
});

/** Cô Mai xác thực số, dò, đồng ý. Trả id kết nối. */
const connectMai = async (): Promise<string> => {
  phoneOf(mai, MAI_PHONE);
  const maiApi = await as(mai, farm);
  LinksDiscoverResult.parse((await maiApi.post('/v1/links/discover').expect(200)).body);
  const { links } = LinksList.parse((await maiApi.get('/v1/links').expect(200)).body);
  const id = links[0]?.id ?? '';
  await maiApi.post(`/v1/links/${id}/accept`).expect(200);
  return id;
};

describe('luồng nghiệm thu BE4', () => {
  it('vựa ghi phiếu có nợ → cô Mai xác thực, đồng ý → thấy đúng phiếu, đúng số nợ → vựa huỷ → mất quyền ngay', async () => {
    await purchase(vua, maiSupplier, { paid: 500_000 });
    await purchase(vua, maiSupplier, { deleted: true }); // phiếu đã xoá: không hiện
    await purchase(vua, await createSupplier(vua, '0987654321', 'Người khác')); // phiếu người khác: không hiện
    await purchase(vua, null); // khách lẻ: không hiện

    phoneOf(mai, MAI_PHONE);
    const maiApi = await as(mai, farm);
    expect(LinksDiscoverResult.parse((await maiApi.post('/v1/links/discover').expect(200)).body)).toEqual({ created: 1, pending: 1 });

    const [pending] = LinksList.parse((await maiApi.get('/v1/links').expect(200)).body).links;
    expect(pending).toMatchObject({
      side: 'linked',
      status: 'pending',
      partner: { id: maiSupplier, name: 'Cô Mai' },
      counterpart: { id: vua, name: 'Vựa Tư Hùng', type: 'trader' },
      invitedPhone: MAI_PHONE,
    });

    // Chờ đồng ý: chưa xem được gì.
    const before = await maiApi.get('/v1/linked/receipts', { orgId: vua }).expect(403);
    expect(ErrorBody.parse(before.body).error.code).toBe('LINK_REQUIRED');

    const accepted = LinkSummary.parse((await maiApi.post(`/v1/links/${pending?.id}/accept`).expect(200)).body);
    expect(accepted.status).toBe('active');

    const { receipts, cursor } = LinkedReceiptsResult.parse((await maiApi.get('/v1/linked/receipts', { orgId: vua }).expect(200)).body);
    expect(cursor).toBeNull();
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({ kind: 'purchase', partyName: 'Cô Mai', total: 1_438_000, paid: 500_000, debt: 938_000, netWeight: 30 });
    expect(receipts[0]?.lines[0]).toEqual({
      productName: 'Cao su',
      unit: 'kg',
      formulaType: 'rubberLatex',
      grossWeight: 100,
      qualityPercent: 30,
      netWeight: 30,
      pricePerUnit: 47_940,
      total: 1_438_000,
    });
    // 🔴 Chỉ trường in trên biên nhận — không lọt ghi chú nội bộ, người lập phiếu, id mặt hàng.
    const raw = JSON.stringify(receipts);
    for (const leak of ['ghi chú nội bộ', vuaOwner, 'prod-', 'createdBy', 'note', 'branchId']) expect(raw).not.toContain(leak);

    expect(LinkedBalance.parse((await maiApi.get('/v1/linked/balance').expect(200)).body).items).toEqual([
      {
        organization: { id: vua, name: 'Vựa Tư Hùng', type: 'trader' },
        theyOwe: 938_000,
        youOwe: 0,
        receiptCount: 1,
        lastReceiptAt: receipts[0]?.date,
      },
    ]);

    // Vựa huỷ → cô Mai mất quyền NGAY, ở cả phiếu lẫn công nợ.
    const vuaApi = await as(vuaOwner, vua);
    expect(LinkSummary.parse((await vuaApi.post(`/v1/links/${pending?.id}/revoke`).expect(200)).body).status).toBe('revoked');
    await maiApi.get('/v1/linked/receipts', { orgId: vua }).expect(403);
    expect(LinkedBalance.parse((await maiApi.get('/v1/linked/balance').expect(200)).body).items).toEqual([]);

    // Huỷ là cuối: không đồng ý lại được, dò lại không tạo lại.
    await maiApi.post(`/v1/links/${pending?.id}/accept`).expect(404);
    expect(LinksDiscoverResult.parse((await maiApi.post('/v1/links/discover').expect(200)).body).created).toBe(0);

    const { rows } = await admin.query<{ action: string; organization_id: string }>(
      `select action, organization_id from audit_log where entity = 'partner_link' order by created_at`,
    );
    expect(rows).toEqual([
      { action: 'link.accepted', organization_id: farm },
      { action: 'link.revoked', organization_id: vua },
    ]);
  });

  it('chưa xác thực OTP → PHONE_NOT_VERIFIED, cả khi dò lẫn khi đồng ý', async () => {
    const id = await connectMaiPendingOnly();
    phoneOf(mai, MAI_PHONE, false);
    const maiApi = await as(mai, farm);
    for (const res of [await maiApi.post('/v1/links/discover').expect(403), await maiApi.post(`/v1/links/${id}/accept`).expect(403)]) {
      expect(ErrorBody.parse(res.body).error.code).toBe('PHONE_NOT_VERIFIED');
    }
  });

  it('🔴 số đã xác thực KHÁC số được mời → không đồng ý được', async () => {
    const id = await connectMaiPendingOnly();
    phoneOf(mai, '+84987654321');
    const res = await (await as(mai, farm)).post(`/v1/links/${id}/accept`).expect(403);
    expect(ErrorBody.parse(res.body).error.code).toBe('PHONE_NOT_VERIFIED');
  });
});

/** Dò nhưng chưa đồng ý. */
async function connectMaiPendingOnly(): Promise<string> {
  phoneOf(mai, MAI_PHONE);
  const maiApi = await as(mai, farm);
  await maiApi.post('/v1/links/discover').expect(200);
  return LinksList.parse((await maiApi.get('/v1/links').expect(200)).body).links[0]?.id ?? '';
}

describe('lời mời của vựa', () => {
  it('vựa mời trước → cô Mai dò là nhận được lời mời đó → đồng ý; mời lại trả đúng kết nối cũ', async () => {
    const vuaApi = await as(vuaOwner, vua);
    const invited = LinkSummary.parse((await vuaApi.post('/v1/links/invite', { partnerKind: 'supplier', partnerId: maiSupplier }).expect(200)).body);
    expect(invited).toMatchObject({ side: 'owner', status: 'pending', counterpart: null, invitedPhone: MAI_PHONE });
    const again = LinkSummary.parse((await vuaApi.post('/v1/links/invite', { partnerKind: 'supplier', partnerId: maiSupplier }).expect(200)).body);
    expect(again.id).toBe(invited.id);

    const id = await connectMai();
    expect(id).toBe(invited.id);
    const [mine] = LinksList.parse((await vuaApi.get('/v1/links').expect(200)).body).links;
    expect(mine).toMatchObject({ side: 'owner', status: 'active', counterpart: { id: farm, name: 'Hộ cô Mai', type: 'farmer' } });
  });

  it('dòng danh bạ không có số hợp lệ → 422; của sổ khác → 404; người cân không mời được → 403', async () => {
    const vuaApi = await as(vuaOwner, vua);
    const noPhone = await createSupplier(vua, null, 'Không số');
    await vuaApi.post('/v1/links/invite', { partnerKind: 'supplier', partnerId: noPhone }).expect(422);
    const other = await createOrg('trader', newId(), 'Vựa khác');
    const foreign = await createSupplier(other, '0911111111', 'Của vựa khác');
    await vuaApi.post('/v1/links/invite', { partnerKind: 'supplier', partnerId: foreign }).expect(404);
    await (await as(vuaStaff, vua)).post('/v1/links/invite', { partnerKind: 'supplier', partnerId: maiSupplier }).expect(403);
  });
});

describe('ai được làm gì', () => {
  it('chỉ bên được liên kết đồng ý — vựa tự đồng ý kết nối của mình → 404', async () => {
    const id = await connectMaiPendingOnly();
    await (await as(vuaOwner, vua)).post(`/v1/links/${id}/accept`).expect(404);
  });

  it('người cân của vựa không xem, không huỷ được kết nối', async () => {
    const id = await connectMai();
    const staffApi = await as(vuaStaff, vua);
    await staffApi.get('/v1/links').expect(403);
    await staffApi.post(`/v1/links/${id}/revoke`).expect(403);
  });

  it('bên được xem cũng huỷ được; tổ chức không liên quan không thấy gì', async () => {
    const id = await connectMai();
    const stranger = newId();
    const otherFarm = await createOrg('farmer', stranger, 'Hộ khác');
    const strangerApi = await as(stranger, otherFarm);
    await strangerApi.get('/v1/linked/receipts', { orgId: vua }).expect(403);
    await strangerApi.post(`/v1/links/${id}/revoke`).expect(404);
    expect(LinksList.parse((await strangerApi.get('/v1/links').expect(200)).body).links).toEqual([]);

    const res = await (await as(mai, farm)).post(`/v1/links/${id}/revoke`).expect(200);
    expect(LinkSummary.parse(res.body).status).toBe('revoked');
  });
});

describe('phần sổ cho xem', () => {
  it('phân trang mới nhất trước, cursor tới null', async () => {
    for (const date of ['2026-09-26T03:00:00Z', '2026-09-27T03:00:00Z', '2026-09-28T03:00:00Z']) {
      await purchase(vua, maiSupplier, { date });
    }
    await connectMai();
    const maiApi = await as(mai, farm);
    const first = LinkedReceiptsResult.parse((await maiApi.get('/v1/linked/receipts', { orgId: vua, limit: 2 }).expect(200)).body);
    expect(first.receipts.map((r) => r.date.slice(0, 10))).toEqual(['2026-09-28', '2026-09-27']);
    const second = LinkedReceiptsResult.parse(
      (await maiApi.get('/v1/linked/receipts', { orgId: vua, limit: 2, cursor: first.cursor ?? '' }).expect(200)).body,
    );
    expect(second.receipts.map((r) => r.date.slice(0, 10))).toEqual(['2026-09-26']);
    expect(second.cursor).toBeNull();
  });

  it('vựa ↔ doanh nghiệp: phiếu vựa BÁN cho DN → DN thấy "mình còn nợ"', async () => {
    const boss = newId();
    const dn = await createOrg('enterprise', boss, 'Công ty Đồng Phú');
    const buyer = newId();
    await admin.query(`insert into buyers (id, organization_id, created_by, name, phone) values ($1, $2, $3, 'Đồng Phú', '0933333333')`, [
      buyer,
      vua,
      vuaOwner,
    ]);
    await admin.query(
      `insert into transactions (id, organization_id, created_by, date, kind, counterparty_id, supplier_name, lines)
       values ($1, $2, $3, now(), 'sale', $4, 'Đồng Phú', $5)`,
      [newId(), vua, vuaOwner, buyer, JSON.stringify([rubberLine()])],
    );

    phoneOf(boss, '+84933333333');
    const dnApi = await as(boss, dn);
    await dnApi.post('/v1/links/discover').expect(200);
    const [link] = LinksList.parse((await dnApi.get('/v1/links').expect(200)).body).links;
    expect(link?.partnerKind).toBe('buyer');
    await dnApi.post(`/v1/links/${link?.id}/accept`).expect(200);

    expect(LinkedBalance.parse((await dnApi.get('/v1/linked/balance').expect(200)).body).items[0]).toMatchObject({
      theyOwe: 0,
      youOwe: 1_438_000,
    });
  });
});
