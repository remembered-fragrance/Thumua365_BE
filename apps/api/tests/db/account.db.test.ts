/**
 * BE6 trên Postgres thật — hồ sơ, mã giới thiệu, xoá tài khoản THẬT. Xoá tài khoản theo đúng thứ tự
 * ảnh → dữ liệu → tài khoản đăng nhập; giữ sổ đối soát ngân hàng và nhật ký; tổ chức còn người làm
 * thì không xoá được. Supabase Auth Admin và Storage là giả.
 */

import {
  AccountDeleteResult,
  ErrorBody,
  LinksList,
  LinkSummary,
  MeProfile,
  OrderDetail,
  OrdersListResult,
  ReferralClaimResult,
} from '@mambo/contracts';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaMemberships } from '../../src/auth/prisma-memberships';
import { Database } from '../../src/db/database';
import { ORDER_DETACHED_NOTE } from '../../src/account/account-deletion.service';
import { PrivilegedDatabase } from '../../src/db/privileged-database';
import { FakeStorageAdmin, FakeSupabaseAdmin, buildTestApp, makeSigner, testEnv } from '../helpers';
import { SERVICE_URL, admin, createOrg, createSupplier, newId, service, serviceError, truncateAll } from './db';
import { NOW, addMember, rubberLine } from './sync-fixture';

const PRIVILEGED_URL =
  process.env.TEST_DATABASE_PRIVILEGED_URL ?? 'postgresql://api_privileged:api_privileged_dev@localhost:54329/thumua365';

let app: INestApplication;
let auth: FakeSupabaseAdmin;
let storage: FakeStorageAdmin;
let signer: Awaited<ReturnType<typeof makeSigner>>;
// DELETE /v1/me giới hạn 5 lần/phút mỗi IP — mỗi test một IP, như links.db.test.
let clientIp = 0;

beforeAll(async () => {
  signer = await makeSigner();
  auth = new FakeSupabaseAdmin();
  storage = new FakeStorageAdmin();
  const db = new Database(SERVICE_URL);
  app = await buildTestApp({
    env: testEnv({
      DATABASE_URL: SERVICE_URL,
      PRIVILEGED_DATABASE_URL: PRIVILEGED_URL,
      RATE_LIMIT_PER_MINUTE: '10000',
      CLIENT_IP_HEADER: 'cf-connecting-ip',
    }),
    jwks: signer.jwks,
    supabaseAdmin: auth,
    storage,
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
  const http = () => request(app.getHttpServer());
  const authed = <T extends request.Test>(r: T) => {
    r.set('authorization', `Bearer ${token}`).set('cf-connecting-ip', `198.51.100.${clientIp}`);
    return orgId ? r.set('x-organization-id', orgId) : r;
  };
  return {
    get: (path: string) => authed(http().get(path)),
    post: (path: string, body: object) => authed(http().post(path).send(body)),
    patch: (path: string, body: object) => authed(http().patch(path).send(body)),
    del: (path: string) => authed(http().delete(path)),
  };
};

const profile = async (id: string, name: string, phone: string | null) => {
  await admin.query('insert into profiles (id, name, phone) values ($1, $2, $3)', [id, name, phone]);
  return (await admin.query<{ referral_code: string }>('select referral_code from profiles where id = $1', [id])).rows[0]?.referral_code ?? '';
};

const count = async (sql: string, params: unknown[] = []): Promise<number> =>
  (await admin.query<{ n: number }>(`select count(*)::int as n from ${sql}`, params)).rows[0]?.n ?? -1;

beforeEach(async () => {
  clientIp++;
  await truncateAll();
  auth.deleted.length = 0;
  storage.removed.length = 0;
  storage.failing = false;
});

describe('hồ sơ', () => {
  it('xem, sửa tên / tên đăng nhập / email khôi phục; tên đăng nhập trùng → 422; chưa có hồ sơ → 404', async () => {
    const me = newId();
    const other = newId();
    await profile(me, 'Anh Hùng', '+84905112233');
    await profile(other, 'Chị Lan', null);
    await admin.query(`update profiles set username = 'chilan' where id = $1`, [other]);
    const api = await as(me);

    const before = MeProfile.parse((await api.get('/v1/me/profile').expect(200)).body);
    expect(before).toMatchObject({ name: 'Anh Hùng', phone: '+84905112233', username: null, referred: false });
    expect(before.referralCode).toMatch(/^[2-9A-Z]{6}$/);

    const after = MeProfile.parse(
      (await api.patch('/v1/me/profile', { name: 'Hùng Tư', username: 'VuaTuHung', recoveryEmail: 'hung@example.com' }).expect(200)).body,
    );
    expect(after).toMatchObject({ name: 'Hùng Tư', username: 'vuatuhung', recoveryEmail: 'hung@example.com', phone: '+84905112233' });

    const taken = await api.patch('/v1/me/profile', { username: 'ChiLan' }).expect(422);
    expect(ErrorBody.parse(taken.body).error.details).toMatchObject({ fields: { username: expect.any(String) } });
    await api.patch('/v1/me/profile', { phone: '+84900000000' }).expect(422);
    await (await as(newId())).get('/v1/me/profile').expect(404);
  });

  it('🔴 tên đăng nhập giống SĐT → 422; email khôi phục người khác đang dùng → 422 đúng trường', async () => {
    const me = newId();
    const other = newId();
    await profile(me, 'Anh Hùng', '+84905112233');
    await profile(other, 'Chị Lan', '+84905112244');
    await admin.query(`update profiles set recovery_email = 'lan@example.com' where id = $1`, [other]);
    const api = await as(me);

    const phoneLike = await api.patch('/v1/me/profile', { username: '0905112244' }).expect(422);
    expect(ErrorBody.parse(phoneLike.body).error.details).toMatchObject({ fields: { username: expect.any(String) } });
    const email = await api.patch('/v1/me/profile', { recoveryEmail: 'LAN@example.com' }).expect(422);
    expect(ErrorBody.parse(email.body).error.details).toMatchObject({ fields: { recoveryEmail: expect.any(String) } });
    const { rows } = await admin.query('select username, recovery_email from profiles where id = $1', [me]);
    expect(rows[0]).toEqual({ username: null, recovery_email: null });
  });
});

describe('mã giới thiệu', () => {
  it('ghi nhận đúng một lần; mã của chính mình, mã lạ → false; luôn 200', async () => {
    const inviter = newId();
    const me = newId();
    const code = await profile(inviter, 'Anh Tư', '+84901000001');
    const mine = await profile(me, 'Chị Ba', '+84901000002');
    const api = await as(me);

    expect(ReferralClaimResult.parse((await api.post('/v1/referrals/claim', { code: 'KHONGCO' }).expect(200)).body)).toEqual({ claimed: false });
    expect(ReferralClaimResult.parse((await api.post('/v1/referrals/claim', { code: mine }).expect(200)).body)).toEqual({ claimed: false });
    expect(ReferralClaimResult.parse((await api.post('/v1/referrals/claim', { code: code.toLowerCase() }).expect(200)).body)).toEqual({
      claimed: true,
    });
    const other = await profile(newId(), 'Người khác', '+84901000003');
    expect(ReferralClaimResult.parse((await api.post('/v1/referrals/claim', { code: other }).expect(200)).body)).toEqual({ claimed: false });
    const { rows } = await admin.query('select referred_by from profiles where id = $1', [me]);
    expect(rows[0]?.referred_by).toBe(inviter);
  });
});

describe('xoá tài khoản', () => {
  /** Vựa có đủ thứ: sổ, lần trả, đơn và kết nối với một nông dân, gói, ý định thanh toán, thông báo. */
  const fullTrader = async () => {
    const owner = newId();
    await profile(owner, 'Anh Hùng', '+84905112233');
    auth.emails.set(owner, '84905112233@id.thumua365.vn');
    const vua = await createOrg('trader', owner, 'Vựa Tư Hùng');
    await admin.query(`insert into subscriptions (organization_id, status, trial_ends_at) values ($1, 'trialing', now() + interval '30 days')`, [vua]);
    const mai = newId();
    const farm = await createOrg('farmer', mai, 'Hộ cô Mai');
    const supplier = await createSupplier(vua, '0912 345 678', 'Cô Mai');
    await admin.query(
      `insert into partner_links (owner_org_id, partner_kind, partner_id, linked_org_id, invited_phone, status)
       values ($1, 'supplier', $2, $3, '+84912345678', 'active')`,
      [vua, supplier, farm],
    );
    const order = newId();
    await admin.query(
      `insert into orders (id, seller_org_id, seller_partner_id, buyer_org_id, created_by_org_id, created_by, est_quantity)
       values ($1, $2, $3, $4, $2, $5, 100)`,
      [order, farm, supplier, vua, mai],
    );
    await admin.query(`insert into order_events (order_id, to_status, actor_user_id, actor_org_id) values ($1, 'submitted', $2, $3)`, [
      order,
      mai,
      farm,
    ]);
    const tx = newId();
    await admin.query(
      `insert into transactions (id, organization_id, created_by, date, kind, counterparty_id, supplier_name, lines, order_id)
       values ($1, $2, $3, $4, 'purchase', $5, 'Cô Mai', $6, $7)`,
      [tx, vua, owner, NOW, supplier, JSON.stringify([rubberLine()]), order],
    );
    await admin.query(`insert into payments (id, organization_id, transaction_id, created_by, date, amount) values ($1, $2, $3, $4, now(), 500000)`, [
      newId(),
      vua,
      tx,
      owner,
    ]);
    await admin.query(`insert into notifications (organization_id, kind) values ($1, 'order.submitted'), ($2, 'order.accepted')`, [vua, farm]);
    await admin.query(`insert into places (organization_id, created_by, kind, name, lat, lng) values ($1, $2, 'trader', 'Vựa Tư Hùng', 11.6, 106.6)`, [
      vua,
      owner,
    ]);
    await admin.query(
      `insert into payment_intents (organization_id, created_by, amount, status, provider, provider_ref) values ($1, $2, 149000, 'paid', 'vietqr', 'K7M2P9')`,
      [vua, owner],
    );
    await admin.query(`insert into bank_transactions (bank_tx_id, organization_id, amount, source) values ('FT-CU', $1, 149000, 'webhook')`, [vua]);
    return { owner, vua, mai, farm, supplier, order, tx };
  };

  it('chủ duy nhất: ảnh → dữ liệu → tài khoản; tổ chức và mọi thứ của nó mất hẳn; sổ đối soát và nhật ký còn', async () => {
    const { owner, vua, mai, farm } = await fullTrader();
    const res = AccountDeleteResult.parse((await (await as(owner)).del('/v1/me').expect(200)).body);
    expect(res).toEqual({ deletedOrganizations: [vua], leftOrganizations: [] });

    expect(storage.removed).toEqual([`attachments/${vua}`]);
    expect(auth.deleted).toEqual([owner]);
    for (const table of ['transactions', 'payments', 'suppliers', 'subscriptions', 'payment_intents', 'memberships', 'notifications', 'places']) {
      expect(await count(`${table} where organization_id = $1`, [vua]), table).toBe(0);
    }
    expect(await count('organizations where id = $1', [vua])).toBe(0);
    expect(await count('profiles where id = $1', [owner])).toBe(0);
    expect(await count('orders')).toBe(0);
    expect(await count('order_events')).toBe(0);
    expect(await count('partner_links')).toBe(0);
    // Giữ lại: sổ đối soát ngân hàng, nhật ký xoá tài khoản.
    expect(await count(`bank_transactions where bank_tx_id = 'FT-CU'`)).toBe(1);
    expect(await count(`audit_log where action = 'account.deleted' and actor_user_id = $1`, [owner])).toBe(1);
    // Bên kia vẫn nguyên: tổ chức, thông báo của chính họ.
    expect(await count('organizations where id = $1', [farm])).toBe(1);
    expect(await count('memberships where user_id = $1', [mai])).toBe(1);
    expect(await count('notifications where organization_id = $1', [farm])).toBe(1);
  });

  it('nông dân xoá tài khoản → sổ vựa giữ nguyên: đơn, lịch sử đơn, phiếu theo đơn; kết nối thành revoked; vựa được báo', async () => {
    const { owner, vua, mai, farm, supplier, order, tx } = await fullTrader();
    await profile(mai, 'Cô Mai', '+84912345678');
    // Thêm một đơn đã xong (giữ nguyên trạng thái) và một kết nối đã huỷ từ trước (chỉ gỡ tổ chức).
    const done = newId();
    await admin.query(
      `insert into orders (id, seller_org_id, seller_partner_id, buyer_org_id, created_by_org_id, created_by, est_quantity)
       values ($1, $2, $3, $4, $4, $5, 50)`,
      [done, farm, supplier, vua, owner],
    );
    await admin.query(`update orders set status = 'fulfilled', version = 2 where id = $1`, [done]);
    const oldSupplier = await createSupplier(vua, null, 'Cô Mai (số cũ)');
    await admin.query(
      `insert into partner_links (owner_org_id, partner_kind, partner_id, linked_org_id, status) values ($1, 'supplier', $2, $3, 'revoked')`,
      [vua, oldSupplier, farm],
    );

    const res = AccountDeleteResult.parse((await (await as(mai)).del('/v1/me').expect(200)).body);
    expect(res).toEqual({ deletedOrganizations: [farm], leftOrganizations: [] });
    expect(auth.deleted).toEqual([mai]);
    expect(await count('organizations where id = $1', [farm])).toBe(0);
    expect(await count('profiles where id = $1', [mai])).toBe(0);
    expect(await count('memberships where organization_id = $1', [farm])).toBe(0);
    expect(await count('notifications where organization_id = $1', [farm])).toBe(0);

    // Đơn còn mở: ở lại, gỡ hộ nông dân, tự huỷ (version + 1) — lịch sử thêm mốc huỷ.
    const { rows: orders } = await admin.query(
      `select id, seller_org_id, seller_partner_id, buyer_org_id, created_by_org_id, status, version from orders order by est_quantity desc`,
    );
    expect(orders).toEqual([
      { id: order, seller_org_id: null, seller_partner_id: supplier, buyer_org_id: vua, created_by_org_id: null, status: 'cancelled', version: 2 },
      { id: done, seller_org_id: null, seller_partner_id: supplier, buyer_org_id: vua, created_by_org_id: vua, status: 'fulfilled', version: 2 },
    ]);
    const { rows: events } = await admin.query(
      `select from_status, to_status, actor_org_id, note from order_events where order_id = $1 order by created_at, id`,
      [order],
    );
    expect(events).toEqual([
      { from_status: null, to_status: 'submitted', actor_org_id: farm, note: null },
      { from_status: 'submitted', to_status: 'cancelled', actor_org_id: farm, note: ORDER_DETACHED_NOTE },
    ]);
    // Phiếu của vựa vẫn gắn đơn.
    expect((await admin.query('select order_id from transactions where id = $1', [tx])).rows[0]).toEqual({ order_id: order });

    // Kết nối: ở lại trong sổ vựa, revoked, không còn trỏ tới hộ đã xoá.
    const { rows: links } = await admin.query(
      `select partner_id, linked_org_id, status, decided_by, invite_code from partner_links order by partner_id = $1 desc`,
      [supplier],
    );
    expect(links).toEqual([
      { partner_id: supplier, linked_org_id: null, status: 'revoked', decided_by: mai, invite_code: null },
      { partner_id: oldSupplier, linked_org_id: null, status: 'revoked', decided_by: null, invite_code: null },
    ]);

    // Vựa được báo: huỷ đơn còn mở, ngừng kết nối đang active. Thông báo cũ của vựa còn.
    const { rows: notes } = await admin.query<{ kind: string; payload: Record<string, unknown> }>(
      `select kind, payload from notifications where organization_id = $1 order by created_at, kind`,
      [vua],
    );
    expect(notes.map((n) => n.kind).sort()).toEqual(['link.revoked', 'order.cancelled', 'order.submitted']);
    expect(notes.find((n) => n.kind === 'order.cancelled')?.payload).toEqual({
      orderId: order,
      orderStatus: 'cancelled',
      pickupAt: null,
      fromOrgId: farm,
      fromOrgName: 'Hộ cô Mai',
      fromOrgType: 'farmer',
    });
    expect(notes.find((n) => n.kind === 'link.revoked')?.payload).toMatchObject({ fromOrgName: 'Hộ cô Mai' });

    const { rows: audit } = await admin.query(`select after from audit_log where action = 'account.deleted' and actor_user_id = $1`, [mai]);
    expect(audit[0]?.after).toEqual({ deletedOrganizations: [farm], leftOrganizations: [], keptOrders: 2, revokedLinks: 1 });

    // Vựa xem qua API: đơn còn, bên kia null, tên lấy từ danh bạ; lịch sử đọc được; kết nối "đã ngừng".
    const vuaApi = await as(owner, vua);
    const list = OrdersListResult.parse((await vuaApi.get('/v1/orders').expect(200)).body);
    expect(list.orders.map((o) => [o.id, o.status, o.counterpart, o.partnerName]).sort()).toEqual(
      [
        [done, 'fulfilled', null, 'Cô Mai'],
        [order, 'cancelled', null, 'Cô Mai'],
      ].sort(),
    );
    const detail = OrderDetail.parse((await vuaApi.get(`/v1/orders/${order}`).expect(200)).body);
    expect(detail).toMatchObject({ role: 'buyer', createdByMe: false, counterpart: null, partnerId: supplier, partnerName: 'Cô Mai' });
    expect(detail.events.map((e) => [e.toStatus, e.by])).toEqual([
      ['submitted', 'counterpart'],
      ['cancelled', 'counterpart'],
    ]);
    // Đơn đã huỷ: không làm bước nào được nữa.
    await vuaApi.post(`/v1/orders/${order}/cancel`, { version: 2 }).expect(409);
    const { links: myLinks } = LinksList.parse((await vuaApi.get('/v1/links').expect(200)).body);
    expect(myLinks.map((l) => [l.partner.id, l.status, l.counterpart])).toContainEqual([supplier, 'revoked', null]);
    // Mời lại được: lời mời mới cho cùng dòng danh bạ.
    const again = LinkSummary.parse((await vuaApi.post('/v1/links/invite', { partnerKind: 'supplier', partnerId: supplier }).expect(200)).body);
    expect(again).toMatchObject({ status: 'pending', counterpart: null, partner: { id: supplier } });
  });

  it('vựa xoá tài khoản, bên kia là doanh nghiệp (có sổ) → đơn ở lại trong sổ DN; kết nối DN giữ sổ thành revoked', async () => {
    const { owner, vua } = await fullTrader();
    const boss = newId();
    const dn = await createOrg('enterprise', boss, 'Công ty Cao su Bình Phước');
    const vuaInDn = newId();
    await admin.query(`insert into buyers (id, organization_id, created_by, name) values ($1, $2, $3, 'Vựa Tư Hùng')`, [vuaInDn, dn, boss]);
    const dnLink = newId();
    await admin.query(
      `insert into partner_links (id, owner_org_id, partner_kind, partner_id, linked_org_id, status) values ($1, $2, 'buyer', $3, $4, 'active')`,
      [dnLink, dn, vuaInDn, vua],
    );
    // DN bán cho vựa, vựa gửi đơn (đã nhận).
    const sale = newId();
    await admin.query(
      `insert into orders (id, seller_org_id, buyer_org_id, buyer_partner_id, created_by_org_id, created_by, est_quantity)
       values ($1, $2, $3, $4, $3, $5, 2000)`,
      [sale, dn, vua, vuaInDn, owner],
    );
    await admin.query(`update orders set status = 'accepted', version = 2 where id = $1`, [sale]);

    await (await as(owner)).del('/v1/me').expect(200);

    // Đơn với nông dân (không có sổ) mất theo; đơn với DN ở lại, gỡ vựa, tự huỷ.
    const { rows } = await admin.query('select id, seller_org_id, buyer_org_id, created_by_org_id, status, version from orders');
    expect(rows).toEqual([{ id: sale, seller_org_id: dn, buyer_org_id: null, created_by_org_id: null, status: 'cancelled', version: 3 }]);
    expect((await admin.query('select linked_org_id, status from partner_links')).rows).toEqual([{ linked_org_id: null, status: 'revoked' }]);
    expect(await count(`notifications where organization_id = $1 and kind in ('order.cancelled', 'link.revoked')`, [dn])).toBe(2);

    const dnOrders = OrdersListResult.parse((await (await as(boss, dn)).get('/v1/orders').expect(200)).body);
    expect(dnOrders.orders).toMatchObject([{ id: sale, role: 'seller', counterpart: null, partnerName: 'Vựa Tư Hùng' }]);
  });

  it('🔴 DN có chi nhánh xoá tài khoản → đơn chi nhánh gửi vựa ở lại sổ vựa, gỡ cả chi nhánh (không vướng orders_guard)', async () => {
    const { owner, vua } = await fullTrader();
    const boss = newId();
    const dn = await createOrg('enterprise', boss, 'Công ty Cao su Bình Phước');
    const branch = newId();
    await admin.query(`insert into branches (id, organization_id, name) values ($1, $2, 'Chi nhánh Bù Đăng')`, [branch, dn]);
    const dnInVua = await createSupplier(vua, null, 'Công ty Cao su BP');
    // DN (chi nhánh) bán cho vựa: một đơn đã nhận, một đơn đã xong.
    const open = newId();
    const done = newId();
    for (const id of [open, done]) {
      await admin.query(
        `insert into orders (id, seller_org_id, seller_partner_id, buyer_org_id, created_by_org_id, created_by, est_quantity, branch_id)
         values ($1, $2, $3, $4, $2, $5, 500, $6)`,
        [id, dn, dnInVua, vua, boss, branch],
      );
    }
    await admin.query(`update orders set status = 'accepted', version = 2 where id = $1`, [open]);
    await admin.query(`update orders set status = 'fulfilled', version = 2 where id = $1`, [done]);

    await (await as(boss)).del('/v1/me').expect(200);

    expect(await count('branches where id = $1', [branch])).toBe(0);
    const { rows } = await admin.query('select id, seller_org_id, buyer_org_id, branch_id, status, version from orders where seller_partner_id = $1', [
      dnInVua,
    ]);
    expect(rows.sort((a, b) => a.status.localeCompare(b.status))).toEqual([
      { id: open, seller_org_id: null, buyer_org_id: vua, branch_id: null, status: 'cancelled', version: 3 },
      { id: done, seller_org_id: null, buyer_org_id: vua, branch_id: null, status: 'fulfilled', version: 2 },
    ]);
    const list = OrdersListResult.parse((await (await as(owner, vua)).get('/v1/orders').expect(200)).body);
    expect(list.orders.filter((o) => o.counterpart === null).map((o) => o.partnerName)).toEqual(['Công ty Cao su BP', 'Công ty Cao su BP']);
  });

  it('một người xoá cả hai tổ chức có đơn với nhau → không còn ai giữ đơn, xoá hết', async () => {
    const { owner, vua } = await fullTrader();
    const dn = await createOrg('enterprise', owner, 'Công ty của anh Hùng');
    const vuaInDn = newId();
    await admin.query(`insert into buyers (id, organization_id, created_by, name) values ($1, $2, $3, 'Vựa Tư Hùng')`, [vuaInDn, dn, owner]);
    await admin.query(
      `insert into orders (seller_org_id, buyer_org_id, buyer_partner_id, created_by_org_id, created_by, est_quantity) values ($1, $2, $3, $2, $4, 10)`,
      [dn, vua, vuaInDn, owner],
    );

    const res = AccountDeleteResult.parse((await (await as(owner)).del('/v1/me').expect(200)).body);
    expect(res.deletedOrganizations.sort()).toEqual([vua, dn].sort());
    expect(await count('orders')).toBe(0);
    expect(await count('order_events')).toBe(0);
    expect(await count('partner_links')).toBe(0);
  });

  it('🔴 database: chỉ khi xoá tài khoản mới gỡ được một bên khỏi đơn / kết nối', async () => {
    const { owner, vua, farm, order } = await fullTrader();
    // api_service, kể cả là một bên của đơn, không gỡ được bên kia (giấu đơn khỏi họ).
    expect(await serviceError({ userId: owner, orgId: vua }, 'update orders set seller_org_id = null where id = $1', [order])).toMatch(
      /Chỉ khi xoá tài khoản mới gỡ được một bên khỏi đơn/,
    );
    expect(
      await serviceError({ userId: owner, orgId: vua }, `update partner_links set linked_org_id = null, status = 'revoked' where linked_org_id = $1`, [
        farm,
      ]),
    ).toMatch(/Kết nối đã có bên được liên kết/);
    // Quyền khác cũng không đổi được sang tổ chức KHÁC, hay gỡ bên được liên kết mà kết nối còn sống.
    const other = await createOrg('trader', newId(), 'Vựa khác');
    await expect(admin.query('update orders set buyer_org_id = $1 where id = $2', [other, order])).rejects.toThrow(/Không đổi được hai bên/);
    await expect(admin.query('update partner_links set linked_org_id = null where linked_org_id = $1', [farm])).rejects.toThrow(
      /Kết nối đã có bên được liên kết/,
    );
    // Đơn mới vẫn bắt buộc có bên mua và bên tạo.
    await expect(
      admin.query(`insert into orders (seller_org_id, created_by_org_id, created_by, est_quantity) values ($1, $1, $2, 1)`, [farm, newId()]),
    ).rejects.toThrow(/phải có bên mua và bên tạo đơn/);
  });

  it('chủ còn người làm → 422 ORG_HAS_MEMBERS, không xoá gì, không chạm Storage', async () => {
    const { owner, vua } = await fullTrader();
    await addMember(vua, newId(), 'staff');
    const res = await (await as(owner)).del('/v1/me').expect(422);
    expect(ErrorBody.parse(res.body).error.details).toMatchObject({ reason: 'ORG_HAS_MEMBERS', organizations: [vua] });
    expect(storage.removed).toEqual([]);
    expect(auth.deleted).toEqual([]);
    expect(await count('transactions where organization_id = $1', [vua])).toBe(1);
  });

  it('🔴 người làm thuê còn trong tổ chức → 422 STILL_MEMBER, không xoá gì; chủ gỡ ra rồi mới xoá được', async () => {
    const { owner, vua } = await fullTrader();
    const staff = newId();
    await addMember(vua, staff, 'staff');
    await profile(staff, 'Người cân', '+84907777777');

    const blocked = await (await as(staff)).del('/v1/me').expect(422);
    expect(ErrorBody.parse(blocked.body).error.details).toMatchObject({ reason: 'STILL_MEMBER', organizations: [vua] });
    expect(auth.deleted).toEqual([]);
    expect(await count(`memberships where user_id = $1 and status = 'active'`, [staff])).toBe(1);
    expect(await count('profiles where id = $1', [staff])).toBe(1);

    await admin.query(`update memberships set status = 'removed' where user_id = $1`, [staff]);
    const res = AccountDeleteResult.parse((await (await as(staff)).del('/v1/me').expect(200)).body);
    expect(res).toEqual({ deletedOrganizations: [], leftOrganizations: [] });
    expect(storage.removed).toEqual([]);
    expect(auth.deleted).toEqual([staff]);
    expect(await count('transactions where organization_id = $1', [vua])).toBe(1);
    expect(await count('profiles where id = $1', [owner])).toBe(1);
  });

  it('🔴 Storage hỏng → dừng trước khi xoá dữ liệu hay tài khoản', async () => {
    const { owner, vua } = await fullTrader();
    storage.failing = true;
    await (await as(owner)).del('/v1/me').expect(500);
    expect(auth.deleted).toEqual([]);
    expect(await count('organizations where id = $1', [vua])).toBe(1);
    expect(await count('profiles where id = $1', [owner])).toBe(1);
  });
});
