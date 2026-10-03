/**
 * BE4 trên Postgres thật — đúng "Xong khi" của KH: vựa ghi phiếu có nợ → nông dân nhập MÃ KẾT NỐI
 * vựa đưa tận tay → thấy đúng phiếu, đúng số nợ; huỷ kết nối → mất quyền ngay. Cộng: mã dùng một
 * lần, hết hạn, chỉ bên sổ thấy mã, chỉ trường in trên biên nhận, vai trò, phân trang, nhật ký,
 * và đường OTP (tạm ẩn tới khi > 100 tổ chức trả phí) vẫn đúng như trước.
 * Chỉ Supabase Auth là giả (số điện thoại đã xác thực hay chưa).
 */

import {
  ErrorBody,
  LINK_CODE_ALPHABET,
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
const CODE_SHAPE = new RegExp(`^[${LINK_CODE_ALPHABET}]{8}$`);

let app: INestApplication;
let users: FakeSupabaseUsers;
let signer: Awaited<ReturnType<typeof makeSigner>>;
/** Mỗi test một IP riêng — route nhập mã có hạn mức 10 lần/phút/IP. */
let clientIp = 0;

// Vựa Tư Hùng: chủ + người cân. Nông dân cô Mai.
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
    env: testEnv({ DATABASE_URL: SERVICE_URL, RATE_LIMIT_PER_MINUTE: '10000', CLIENT_IP_HEADER: 'cf-connecting-ip' }),
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
  const ip = `198.51.100.${clientIp}`;
  const withAuth = <T extends request.Test>(r: T) =>
    r.set('authorization', `Bearer ${token}`).set('x-organization-id', orgId).set('cf-connecting-ip', ip);
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
  clientIp++;
  vuaOwner = newId();
  vuaStaff = newId();
  mai = newId();
  vua = await createOrg('trader', vuaOwner, 'Vựa Tư Hùng');
  await addMember(vua, vuaStaff, 'staff');
  farm = await createOrg('farmer', mai, 'Hộ cô Mai');
  maiSupplier = await createSupplier(vua, '0912 345 678', 'Cô Mai');
  // Mặc định: chưa ai xác thực số — đúng tình trạng khi OTP tạm ẩn.
  phoneOf(mai, MAI_PHONE, false);
});

/** Vựa mời một dòng danh bạ, trả kết nối kèm mã. */
const invite = async (partnerId = maiSupplier, partnerKind: 'supplier' | 'buyer' = 'supplier') =>
  LinkSummary.parse((await (await as(vuaOwner, vua)).post('/v1/links/invite', { partnerKind, partnerId }).expect(200)).body);

const codeOf = (link: LinkSummary): string => link.inviteCode?.code ?? '';

/** Vựa mời → cô Mai nhập mã. Trả id kết nối. */
const connectMai = async (): Promise<string> => {
  const code = codeOf(await invite());
  const res = await (await as(mai, farm)).post('/v1/links/claim', { code }).expect(200);
  return LinkSummary.parse(res.body).id;
};

const errorOf = (res: request.Response) => ErrorBody.parse(res.body).error;

describe('luồng nghiệm thu BE4 — mã kết nối, không cần OTP', () => {
  it('vựa ghi phiếu có nợ → mời, đưa mã → cô Mai nhập mã → thấy đúng phiếu, đúng số nợ → vựa huỷ → mất quyền ngay', async () => {
    await purchase(vua, maiSupplier, { paid: 500_000 });
    await purchase(vua, maiSupplier, { deleted: true }); // phiếu đã xoá: không hiện
    await purchase(vua, await createSupplier(vua, '0987654321', 'Người khác')); // phiếu người khác: không hiện
    await purchase(vua, null); // khách lẻ: không hiện

    const invited = await invite();
    expect(invited).toMatchObject({ side: 'owner', status: 'pending', counterpart: null, invitedPhone: MAI_PHONE });
    expect(codeOf(invited)).toMatch(CODE_SHAPE);
    const ttlDays = (Date.parse(invited.inviteCode?.expiresAt ?? '') - Date.now()) / 86_400_000;
    expect(ttlDays).toBeGreaterThan(6.99);
    expect(ttlDays).toBeLessThanOrEqual(7);

    // Chưa nhập mã: cô Mai không thấy lời mời, không xem được gì.
    const maiApi = await as(mai, farm);
    expect(LinksList.parse((await maiApi.get('/v1/links').expect(200)).body).links).toEqual([]);
    expect(errorOf(await maiApi.get('/v1/linked/receipts', { orgId: vua }).expect(403)).code).toBe('LINK_REQUIRED');

    // Gõ như người thật: chữ thường, gạch nối giữa.
    const typed = `${codeOf(invited).slice(0, 4)}-${codeOf(invited).slice(4)}`.toLowerCase();
    const claimed = LinkSummary.parse((await maiApi.post('/v1/links/claim', { code: typed }).expect(200)).body);
    expect(claimed).toMatchObject({
      id: invited.id,
      side: 'linked',
      status: 'active',
      partner: { id: maiSupplier, name: 'Cô Mai' },
      counterpart: { id: vua, name: 'Vựa Tư Hùng', type: 'trader' },
      inviteCode: null,
    });

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

    // Phía vựa: đã kết nối, mã không còn.
    const vuaApi = await as(vuaOwner, vua);
    const [mine] = LinksList.parse((await vuaApi.get('/v1/links').expect(200)).body).links;
    expect(mine).toMatchObject({ status: 'active', counterpart: { id: farm, name: 'Hộ cô Mai', type: 'farmer' }, inviteCode: null });

    // Vựa huỷ → cô Mai mất quyền NGAY, ở cả phiếu lẫn công nợ.
    expect(LinkSummary.parse((await vuaApi.post(`/v1/links/${invited.id}/revoke`).expect(200)).body).status).toBe('revoked');
    await maiApi.get('/v1/linked/receipts', { orgId: vua }).expect(403);
    expect(LinkedBalance.parse((await maiApi.get('/v1/linked/balance').expect(200)).body).items).toEqual([]);

    // Huỷ là cuối: mã cũ không mở lại được.
    await maiApi.post('/v1/links/claim', { code: codeOf(invited) }).expect(404);

    const { rows } = await admin.query<{ action: string; organization_id: string; after: { via?: string } }>(
      `select action, organization_id, after from audit_log where entity = 'partner_link' order by created_at`,
    );
    expect(rows.map((r) => [r.action, r.organization_id])).toEqual([
      ['link.invited', vua],
      ['link.accepted', farm],
      ['link.revoked', vua],
    ]);
    expect(rows[1]?.after.via).toBe('code');
    // 🔴 Mã không nằm trong nhật ký.
    expect(JSON.stringify(rows)).not.toContain(codeOf(invited));
  });

  it('🔴 mã dùng một lần — người khác nhập lại mã đã dùng → 404', async () => {
    const code = codeOf(await invite());
    await (await as(mai, farm)).post('/v1/links/claim', { code }).expect(200);

    const stranger = newId();
    const res = await (await as(stranger, await createOrg('farmer', stranger, 'Hộ lạ'))).post('/v1/links/claim', { code }).expect(404);
    expect(errorOf(res).code).toBe('NOT_FOUND');
  });

  it('🔴 hai người nhập cùng một mã cùng lúc → đúng một người được', async () => {
    const code = codeOf(await invite());
    const other = newId();
    const otherFarm = await createOrg('farmer', other, 'Hộ khác');
    const [a, b] = await Promise.all([
      (await as(mai, farm)).post('/v1/links/claim', { code }),
      (await as(other, otherFarm)).post('/v1/links/claim', { code }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 404]);
    const { rows } = await admin.query(`select status from partner_links`);
    expect(rows).toEqual([{ status: 'active' }]);
  });
});

describe('mã kết nối — cấp, hết hạn, mời lại', () => {
  it('mời lại khi mã còn hạn → đúng kết nối, đúng mã cũ (QR in ra vẫn dùng được)', async () => {
    const first = await invite();
    const again = await invite();
    expect(again.id).toBe(first.id);
    expect(again.inviteCode).toEqual(first.inviteCode);
    const listed = LinksList.parse((await (await as(vuaOwner, vua)).get('/v1/links').expect(200)).body).links[0];
    expect(listed?.inviteCode).toEqual(first.inviteCode);
  });

  it('mã hết hạn → 404 như mã sai; mời lại → mã mới, mã cũ chết hẳn', async () => {
    const first = await invite();
    await admin.query(`update partner_links set invite_code_expires_at = now() - interval '1 minute' where id = $1`, [first.id]);

    const maiApi = await as(mai, farm);
    const expired = errorOf(await maiApi.post('/v1/links/claim', { code: codeOf(first) }).expect(404));
    const wrong = errorOf(await maiApi.post('/v1/links/claim', { code: 'ZZZZZZZZ' }).expect(404));
    expect(expired.message).toBe(wrong.message); // không dò được mã nào từng tồn tại

    // Bên sổ không thấy mã đã hết hạn — màn hình hiện nút "Lấy mã mới".
    const listed = LinksList.parse((await (await as(vuaOwner, vua)).get('/v1/links').expect(200)).body).links[0];
    expect(listed?.inviteCode).toBeNull();

    const renewed = await invite();
    expect(renewed.id).toBe(first.id);
    expect(codeOf(renewed)).toMatch(CODE_SHAPE);
    expect(codeOf(renewed)).not.toBe(codeOf(first));
    await maiApi.post('/v1/links/claim', { code: codeOf(first) }).expect(404);
    await maiApi.post('/v1/links/claim', { code: codeOf(renewed) }).expect(200);
  });

  it('huỷ rồi mời lại → kết nối mới, mã mới; mã của kết nối đã huỷ không dùng được', async () => {
    const first = await invite();
    await (await as(vuaOwner, vua)).post(`/v1/links/${first.id}/revoke`).expect(200);
    const second = await invite();
    expect(second.id).not.toBe(first.id);
    expect(codeOf(second)).not.toBe(codeOf(first));
    const maiApi = await as(mai, farm);
    await maiApi.post('/v1/links/claim', { code: codeOf(first) }).expect(404);
    await maiApi.post('/v1/links/claim', { code: codeOf(second) }).expect(200);
  });

  it('dòng danh bạ không có số điện thoại vẫn mời được — mã đã đủ chứng minh', async () => {
    const noPhone = await createSupplier(vua, null, 'Chú Bảy');
    const invited = await invite(noPhone);
    expect(invited).toMatchObject({ invitedPhone: null, status: 'pending' });
    await (await as(mai, farm)).post('/v1/links/claim', { code: codeOf(invited) }).expect(200);
  });

  it('mã sai hình dạng → 422 đúng trường; mã của chính sổ mình → 422, không tự kết nối được', async () => {
    const vuaApi = await as(vuaOwner, vua);
    const bad = errorOf(await vuaApi.post('/v1/links/claim', { code: 'K7M2' }).expect(422));
    expect(bad.details).toMatchObject({ fields: { code: expect.any(String) } });

    const own = errorOf(await vuaApi.post('/v1/links/claim', { code: codeOf(await invite()) }).expect(422));
    expect(own.code).toBe('VALIDATION_FAILED');
    expect(own.message).toMatch(/chính sổ này/);
  });

  it('10 lần nhập mã mỗi phút mỗi IP — lần 11 → 429', async () => {
    const maiApi = await as(mai, farm);
    for (let i = 0; i < 10; i++) await maiApi.post('/v1/links/claim', { code: 'ZZZZZZZZ' }).expect(404);
    expect(errorOf(await maiApi.post('/v1/links/claim', { code: 'ZZZZZZZZ' }).expect(429)).code).toBe('RATE_LIMITED');
  });
});

describe('ai được làm gì', () => {
  it('người cân của vựa không mời, không nhập mã, không xem, không huỷ được kết nối', async () => {
    const staffApi = await as(vuaStaff, vua);
    await staffApi.post('/v1/links/invite', { partnerKind: 'supplier', partnerId: maiSupplier }).expect(403);
    await staffApi.post('/v1/links/claim', { code: 'ZZZZZZZZ' }).expect(403);
    const id = await connectMai();
    await staffApi.get('/v1/links').expect(403);
    await staffApi.post(`/v1/links/${id}/revoke`).expect(403);
  });

  it('mời dòng danh bạ của sổ khác → 404', async () => {
    const other = await createOrg('trader', newId(), 'Vựa khác');
    const foreign = await createSupplier(other, '0911111111', 'Của vựa khác');
    await (await as(vuaOwner, vua)).post('/v1/links/invite', { partnerKind: 'supplier', partnerId: foreign }).expect(404);
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

describe('đường OTP — tạm ẩn tới khi > 100 tổ chức trả phí, vẫn đúng như trước', () => {
  it('chưa xác thực OTP → PHONE_NOT_VERIFIED khi dò — tình trạng hiện tại của mọi tài khoản', async () => {
    expect(errorOf(await (await as(mai, farm)).post('/v1/links/discover').expect(403)).code).toBe('PHONE_NOT_VERIFIED');
  });

  it('đã xác thực: dò → đồng ý → xem được; huỷ rồi dò lại không tạo lại', async () => {
    await purchase(vua, maiSupplier, { paid: 500_000 });
    phoneOf(mai, MAI_PHONE);
    const maiApi = await as(mai, farm);
    expect(LinksDiscoverResult.parse((await maiApi.post('/v1/links/discover').expect(200)).body)).toEqual({ created: 1, pending: 1 });
    const [pending] = LinksList.parse((await maiApi.get('/v1/links').expect(200)).body).links;
    expect(pending).toMatchObject({ side: 'linked', status: 'pending', invitedPhone: MAI_PHONE, inviteCode: null });
    await maiApi.get('/v1/linked/receipts', { orgId: vua }).expect(403);

    await maiApi.post(`/v1/links/${pending?.id}/accept`).expect(200);
    const { receipts } = LinkedReceiptsResult.parse((await maiApi.get('/v1/linked/receipts', { orgId: vua }).expect(200)).body);
    expect(receipts.map((r) => r.debt)).toEqual([938_000]);

    await (await as(vuaOwner, vua)).post(`/v1/links/${pending?.id}/revoke`).expect(200);
    await maiApi.post(`/v1/links/${pending?.id}/accept`).expect(404);
    expect(LinksDiscoverResult.parse((await maiApi.post('/v1/links/discover').expect(200)).body).created).toBe(0);
  });

  it('🔴 số đã xác thực KHÁC số được mời → không đồng ý được', async () => {
    phoneOf(mai, MAI_PHONE);
    const maiApi = await as(mai, farm);
    await maiApi.post('/v1/links/discover').expect(200);
    const id = LinksList.parse((await maiApi.get('/v1/links').expect(200)).body).links[0]?.id ?? '';
    phoneOf(mai, '+84987654321');
    expect(errorOf(await maiApi.post(`/v1/links/${id}/accept`).expect(403)).code).toBe('PHONE_NOT_VERIFIED');
  });

  it('chỉ bên được liên kết đồng ý — vựa tự đồng ý kết nối của mình → 404', async () => {
    phoneOf(mai, MAI_PHONE);
    const maiApi = await as(mai, farm);
    await maiApi.post('/v1/links/discover').expect(200);
    const id = LinksList.parse((await maiApi.get('/v1/links').expect(200)).body).links[0]?.id ?? '';
    await (await as(vuaOwner, vua)).post(`/v1/links/${id}/accept`).expect(404);
  });

  it('hai đường gặp nhau: vựa mời (có mã) → cô Mai dò được bằng OTP → 🔴 phía cô Mai không thấy mã; nhập mã vẫn được', async () => {
    const invited = await invite();
    phoneOf(mai, MAI_PHONE);
    const maiApi = await as(mai, farm);
    await maiApi.post('/v1/links/discover').expect(200);
    const [seen] = LinksList.parse((await maiApi.get('/v1/links').expect(200)).body).links;
    expect(seen).toMatchObject({ id: invited.id, side: 'linked', status: 'pending', inviteCode: null });
    expect((await invite()).inviteCode).toEqual(invited.inviteCode); // bên sổ vẫn thấy mã

    await maiApi.post('/v1/links/claim', { code: codeOf(invited) }).expect(200);
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

  it('vựa ↔ doanh nghiệp bằng mã: phiếu vựa BÁN cho DN → DN thấy "mình còn nợ"', async () => {
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

    const code = codeOf(await invite(buyer, 'buyer'));
    const dnApi = await as(boss, dn);
    expect(LinkSummary.parse((await dnApi.post('/v1/links/claim', { code }).expect(200)).body).partnerKind).toBe('buyer');
    expect(LinkedBalance.parse((await dnApi.get('/v1/linked/balance').expect(200)).body).items[0]).toMatchObject({
      theyOwe: 0,
      youOwe: 1_438_000,
    });
  });
});
