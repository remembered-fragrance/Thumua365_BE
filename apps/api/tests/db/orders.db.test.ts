/**
 * BE5 trên Postgres thật — đúng "Xong khi" của KH (nghiệm thu R2): nông dân tạo đơn → vựa nhận,
 * hẹn lịch → nông dân thấy lịch → vựa cân, lập phiếu theo đơn, trả một phần (đẩy lên sau, như lúc
 * mất mạng) → đơn tự `fulfilled` → nông dân thấy phiếu và số còn nợ. Cộng: chỉ gửi cho tổ chức đã
 * kết nối, version, ai làm bước nào, phiếu theo đơn đã huỷ, thông báo, và luật ở database.
 */

import {
  ErrorBody,
  LinkedReceiptsResult,
  NotificationsReadResult,
  NotificationsResult,
  OrderDetail,
  OrdersListResult,
  OrderSummary,
  SyncPullResult,
  SyncPushResult,
} from '@mambo/contracts';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { admin, asService, createOrg, createSupplier, newId, service, serviceError, truncateAll } from './db';
import { addMember, buildSyncApp, giveTrial, opMaker, paymentData, pullAs, pushAs, txData } from './sync-fixture';

let app: INestApplication;
let tokenFor: (userId: string) => Promise<string>;

// Vựa Tư Hùng (chủ + người cân), có cô Mai trong danh bạ và đã kết nối. Hộ cô Mai. Vựa khác.
let vua: string;
let vuaOwner: string;
let vuaStaff: string;
let farm: string;
let mai: string;
let maiSupplier: string;
let other: string;
let otherOwner: string;

beforeAll(async () => {
  ({ app, tokenFor } = await buildSyncApp());
});

afterAll(async () => {
  await app.close();
  await admin.end();
  await service.end();
});

const as = async (userId: string, orgId: string) => {
  const token = await tokenFor(userId);
  const withAuth = <T extends request.Test>(r: T) => r.set('authorization', `Bearer ${token}`).set('x-organization-id', orgId);
  const http = () => request(app.getHttpServer());
  return {
    get: (path: string, query: Record<string, string | number> = {}) => withAuth(http().get(path).query(query)),
    post: (path: string, body: object = {}) => withAuth(http().post(path).send(body)),
    push: (ops: unknown[]) => pushAs(app, token, orgId, ops),
    pull: () => pullAs(app, token, orgId),
  };
};

/** Kết nối đã đồng ý: `ownerOrg` có `partnerId` trong sổ, `linkedOrg` là tổ chức thật của người đó. */
const link = async (ownerOrg: string, partnerKind: 'supplier' | 'buyer', partnerId: string, linkedOrg: string, status = 'active') => {
  const id = newId();
  await admin.query(
    `insert into partner_links (id, owner_org_id, partner_kind, partner_id, linked_org_id, invited_phone, status)
     values ($1, $2, $3, $4, $5, '+84912345678', $6)`,
    [id, ownerOrg, partnerKind, partnerId, linkedOrg, status],
  );
  return id;
};

/** Listener ghi thông báo SAU commit, bất đồng bộ — đợi tới khi có. */
const notificationsOf = async (orgId: string, kind: string, count = 1) => {
  for (let i = 0; i < 50; i++) {
    const { rows } = await admin.query<{ kind: string; payload: Record<string, unknown> }>(
      'select kind, payload from notifications where organization_id = $1 and kind = $2 order by created_at',
      [orgId, kind],
    );
    if (rows.length >= count) return rows;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`Không thấy ${count} thông báo ${kind} cho ${orgId}`);
};

const sellOrder = { role: 'seller', crop: 'rubber', estQuantity: 1000, offeredPrice: 47_940, note: 'Mủ chén, 1 tấn' };

beforeEach(async () => {
  await truncateAll();
  vuaOwner = newId();
  vuaStaff = newId();
  mai = newId();
  otherOwner = newId();
  vua = await createOrg('trader', vuaOwner, 'Vựa Tư Hùng');
  await addMember(vua, vuaStaff, 'staff');
  await giveTrial(vua);
  farm = await createOrg('farmer', mai, 'Hộ cô Mai');
  other = await createOrg('trader', otherOwner, 'Vựa khác');
  maiSupplier = await createSupplier(vua, '0912 345 678', 'Cô Mai');
  await link(vua, 'supplier', maiSupplier, farm);
});

describe('luồng nghiệm thu R2', () => {
  it('nông dân tạo đơn → vựa nhận, hẹn lịch → vựa cân, lập phiếu theo đơn, trả một phần → đơn tự hoàn thành → nông dân thấy phiếu và số còn nợ', async () => {
    const maiApi = await as(mai, farm);
    const vuaApi = await as(vuaOwner, vua);

    // 1. Cô Mai gửi đơn bán cho vựa.
    const created = OrderSummary.parse((await maiApi.post('/v1/orders', { ...sellOrder, counterpartOrgId: vua }).expect(200)).body);
    expect(created).toMatchObject({ status: 'submitted', version: 1, role: 'seller', createdByMe: true, unit: 'kg' });
    expect(created.counterpart).toEqual({ id: vua, name: 'Vựa Tư Hùng', type: 'trader' });
    expect(created.partnerId).toBeNull(); // nông dân không có sổ

    // 2. Vựa thấy đơn, kèm dòng danh bạ của cô Mai trong sổ mình (để lập phiếu theo đơn).
    const forVua = OrdersListResult.parse((await vuaApi.get('/v1/orders', { role: 'buyer' }).expect(200)).body);
    expect(forVua.orders).toHaveLength(1);
    expect(forVua.orders[0]).toMatchObject({ id: created.id, role: 'buyer', createdByMe: false, partnerId: maiSupplier });
    expect(forVua.orders[0]?.counterpart.name).toBe('Hộ cô Mai');
    const [submitted] = await notificationsOf(vua, 'order.submitted');
    expect(submitted?.payload).toMatchObject({ orderId: created.id, fromOrgName: 'Hộ cô Mai' });

    // 3. Vựa nhận, hẹn lịch.
    const accepted = OrderSummary.parse((await vuaApi.post(`/v1/orders/${created.id}/accept`, { version: 1 }).expect(200)).body);
    expect(accepted).toMatchObject({ status: 'accepted', version: 2 });
    const pickupAt = '2026-10-05T01:00:00.000Z';
    const scheduled = OrderSummary.parse(
      (await vuaApi.post(`/v1/orders/${created.id}/schedule`, { version: 2, pickupAt, pickupAddress: 'Rẫy cô Mai, Bù Đăng' }).expect(200)).body,
    );
    expect(scheduled).toMatchObject({ status: 'scheduled', version: 3, pickupAt, pickupAddress: 'Rẫy cô Mai, Bù Đăng' });

    // 4. Cô Mai thấy lịch — trong đơn và trong thông báo.
    const forMai = OrderDetail.parse((await maiApi.get(`/v1/orders/${created.id}`).expect(200)).body);
    expect(forMai).toMatchObject({ status: 'scheduled', pickupAt });
    await notificationsOf(farm, 'order.scheduled');
    const inbox = NotificationsResult.parse((await maiApi.get('/v1/notifications').expect(200)).body);
    expect(inbox.unread).toBe(2);
    expect(inbox.notifications.map((n) => n.kind).sort()).toEqual(['order.accepted', 'order.scheduled']);
    const scheduledNote = inbox.notifications.find((n) => n.kind === 'order.scheduled');
    expect(scheduledNote).toMatchObject({ orderId: created.id, pickupAt, read: false });
    expect(scheduledNote?.from).toEqual({ id: vua, name: 'Vựa Tư Hùng', type: 'trader' });

    // 5. Vựa cân, lập phiếu theo đơn, trả một phần — lúc mất mạng: hai op nằm trong hàng đợi, có
    //    mạng thì đẩy lên một lô.
    const txId = newId();
    const op = opMaker();
    const pushed = SyncPushResult.parse(
      (
        await vuaApi
          .push([
            op('transaction', 'insert', txId, txData({ counterpartyId: maiSupplier, supplierName: 'Cô Mai', orderId: created.id })),
            op('payment', 'insert', newId(), paymentData(txId, 500_000)),
          ])
          .expect(200)
      ).body,
    );
    expect(pushed.results.map((r) => r.status)).toEqual(['applied', 'applied']);
    expect(pushed.results[0]?.warning).toBeUndefined();

    // 6. Đơn tự hoàn thành; cô Mai được báo, thấy phiếu và số còn nợ.
    const done = OrderDetail.parse((await maiApi.get(`/v1/orders/${created.id}`).expect(200)).body);
    expect(done).toMatchObject({ status: 'fulfilled', version: 4 });
    expect(done.events.map((e) => [e.toStatus, e.by])).toEqual([
      ['submitted', 'me'],
      ['accepted', 'counterpart'],
      ['scheduled', 'counterpart'],
      ['fulfilled', 'counterpart'],
    ]);
    expect(done.events[0]?.note).toBe('Mủ chén, 1 tấn');
    await notificationsOf(farm, 'order.fulfilled');

    const receipts = LinkedReceiptsResult.parse((await maiApi.get('/v1/linked/receipts', { orgId: vua }).expect(200)).body);
    expect(receipts.receipts).toHaveLength(1);
    expect(receipts.receipts[0]).toMatchObject({ id: txId, total: 1_438_000, paid: 500_000, debt: 938_000 });

    // Phiếu kéo về máy khác của vựa mang orderId.
    const pulled = SyncPullResult.parse((await vuaApi.pull().expect(200)).body);
    expect(pulled.changes.transactions.find((t) => t.id === txId)?.orderId).toBe(created.id);
  });
});

describe('chỉ gửi đơn cho tổ chức đã kết nối, đúng chiều', () => {
  it('chưa kết nối, kết nối đã huỷ, kết nối ngược chiều → LINK_REQUIRED', async () => {
    const maiApi = await as(mai, farm);
    const noLink = await maiApi.post('/v1/orders', { ...sellOrder, counterpartOrgId: other }).expect(403);
    expect(ErrorBody.parse(noLink.body).error.code).toBe('LINK_REQUIRED');

    // Cô Mai MUA của vựa khác? Kết nối duy nhất của cô với vựa Tư Hùng là chiều bán.
    await maiApi.post('/v1/orders', { ...sellOrder, role: 'buyer', counterpartOrgId: vua }).expect(403);

    await admin.query(`update partner_links set status = 'revoked'`);
    const revoked = await maiApi.post('/v1/orders', { ...sellOrder, counterpartOrgId: vua }).expect(403);
    expect(ErrorBody.parse(revoked.body).error.code).toBe('LINK_REQUIRED');
  });

  it('vựa tạo đơn MUA với nông dân đã kết nối; mặt hàng phải trong sổ của mình', async () => {
    const vuaApi = await as(vuaOwner, vua);
    const order = OrderSummary.parse((await vuaApi.post('/v1/orders', { role: 'buyer', counterpartOrgId: farm, estQuantity: 500 }).expect(200)).body);
    expect(order).toMatchObject({ role: 'buyer', createdByMe: true, partnerId: maiSupplier });
    await notificationsOf(farm, 'order.submitted');

    const bad = await vuaApi.post('/v1/orders', { role: 'buyer', counterpartOrgId: farm, estQuantity: 1, productId: newId() }).expect(422);
    expect(ErrorBody.parse(bad.body).error.details).toMatchObject({ fields: { productId: expect.any(String) } });
  });

  it('thân sai hợp đồng → 422; tạo đơn với chính mình → 422', async () => {
    const maiApi = await as(mai, farm);
    await maiApi.post('/v1/orders', { ...sellOrder, counterpartOrgId: vua, estQuantity: 0 }).expect(422);
    await maiApi.post('/v1/orders', { ...sellOrder, counterpartOrgId: vua, status: 'fulfilled' }).expect(422);
    await maiApi.post('/v1/orders', { ...sellOrder, counterpartOrgId: farm }).expect(422);
  });
});

describe('chuyển trạng thái', () => {
  const submit = async () =>
    OrderSummary.parse((await (await as(mai, farm)).post('/v1/orders', { ...sellOrder, counterpartOrgId: vua }).expect(200)).body);

  it('hai người bấm cùng một version → một người thắng, người kia 409 ORDER_STATE_CHANGED kèm trạng thái mới', async () => {
    const order = await submit();
    const owner = await as(vuaOwner, vua);
    const staff = await as(vuaStaff, vua);
    const [a, b] = await Promise.all([
      owner.post(`/v1/orders/${order.id}/accept`, { version: 1 }),
      staff.post(`/v1/orders/${order.id}/reject`, { version: 1 }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const lost = a.status === 409 ? a : b;
    expect(ErrorBody.parse(lost.body).error).toMatchObject({ code: 'ORDER_STATE_CHANGED', details: { version: 2 } });

    const { rows } = await admin.query('select to_status from order_events where order_id = $1', [order.id]);
    expect(rows).toHaveLength(2); // submitted + đúng một bước
  });

  it('ai làm bước nào: bên tạo không tự nhận, bên bán không hẹn lịch, người lạ không thấy đơn', async () => {
    const order = await submit();
    const maiApi = await as(mai, farm);
    const accept = await maiApi.post(`/v1/orders/${order.id}/accept`, { version: 1 }).expect(403);
    expect(ErrorBody.parse(accept.body).error.code).toBe('FORBIDDEN');

    await (await as(vuaStaff, vua)).post(`/v1/orders/${order.id}/accept`, { version: 1 }).expect(200);
    await maiApi.post(`/v1/orders/${order.id}/schedule`, { version: 2, pickupAt: '2026-10-05T01:00:00Z' }).expect(403);

    const stranger = await as(otherOwner, other);
    await stranger.get(`/v1/orders/${order.id}`).expect(404);
    await stranger.post(`/v1/orders/${order.id}/cancel`, { version: 2 }).expect(404);
    expect(OrdersListResult.parse((await stranger.get('/v1/orders').expect(200)).body).orders).toEqual([]);
  });

  it('huỷ: bên nào cũng được; đơn đã huỷ không đi tiếp; bên kia được báo', async () => {
    const order = await submit();
    const maiApi = await as(mai, farm);
    const cancelled = OrderSummary.parse((await maiApi.post(`/v1/orders/${order.id}/cancel`, { version: 1, note: 'Bán chỗ khác rồi' }).expect(200)).body);
    expect(cancelled).toMatchObject({ status: 'cancelled', version: 2 });
    await notificationsOf(vua, 'order.cancelled');

    const late = await (await as(vuaOwner, vua)).post(`/v1/orders/${order.id}/accept`, { version: 2 }).expect(409);
    expect(ErrorBody.parse(late.body).error.details).toMatchObject({ status: 'cancelled' });
  });

  it('hẹn lại lịch khi đã hẹn; lọc theo trạng thái; phân trang tới cursor null', async () => {
    const first = await submit();
    await submit();
    await submit();
    const vuaApi = await as(vuaOwner, vua);
    await vuaApi.post(`/v1/orders/${first.id}/accept`, { version: 1 }).expect(200);
    await vuaApi.post(`/v1/orders/${first.id}/schedule`, { version: 2, pickupAt: '2026-10-05T01:00:00Z' }).expect(200);
    const again = OrderSummary.parse(
      (await vuaApi.post(`/v1/orders/${first.id}/schedule`, { version: 3, pickupAt: '2026-10-06T01:00:00Z' }).expect(200)).body,
    );
    expect(again).toMatchObject({ status: 'scheduled', version: 4, pickupAt: '2026-10-06T01:00:00.000Z' });

    const scheduled = OrdersListResult.parse((await vuaApi.get('/v1/orders', { status: 'scheduled' }).expect(200)).body);
    expect(scheduled.orders.map((o) => o.id)).toEqual([first.id]);

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page = OrdersListResult.parse((await vuaApi.get('/v1/orders', { limit: 2, ...(cursor ? { cursor } : {}) }).expect(200)).body);
      seen.push(...page.orders.map((o) => o.id));
      cursor = page.cursor;
    } while (cursor);
    expect(new Set(seen).size).toBe(3);
    expect(seen).toHaveLength(3);
  });
});

describe('phiếu theo đơn', () => {
  const acceptedOrder = async () => {
    const order = OrderSummary.parse((await (await as(mai, farm)).post('/v1/orders', { ...sellOrder, counterpartOrgId: vua }).expect(200)).body);
    await (await as(vuaOwner, vua)).post(`/v1/orders/${order.id}/accept`, { version: 1 }).expect(200);
    return order.id;
  };

  it('🔴 đơn đã huỷ trong lúc vựa đang cân offline → phiếu vẫn ghi, gỡ khỏi đơn, cảnh báo ORDER_NOT_OPEN', async () => {
    const orderId = await acceptedOrder();
    await (await as(mai, farm)).post(`/v1/orders/${orderId}/cancel`, { version: 2 }).expect(200);

    const txId = newId();
    const res = SyncPushResult.parse(
      (await (await as(vuaStaff, vua)).push([opMaker()('transaction', 'insert', txId, txData({ orderId }))]).expect(200)).body,
    );
    expect(res.results[0]).toMatchObject({ status: 'applied', warning: 'ORDER_NOT_OPEN' });
    const { rows } = await admin.query('select order_id from transactions where id = $1', [txId]);
    expect(rows[0]?.order_id).toBeNull();
    const { rows: order } = await admin.query('select status from orders where id = $1', [orderId]);
    expect(order[0]?.status).toBe('cancelled');
  });

  it('phiếu thứ hai của đơn đã hoàn thành → chỉ gắn; gửi lại lô → duplicate, không hoàn thành hai lần', async () => {
    const orderId = await acceptedOrder();
    const staff = await as(vuaStaff, vua);
    const op = opMaker();
    const first = op('transaction', 'insert', newId(), txData({ orderId }));
    await staff.push([first]).expect(200);
    const again = SyncPushResult.parse((await staff.push([first, op('transaction', 'insert', newId(), txData({ orderId }))]).expect(200)).body);
    expect(again.results.map((r) => r.status)).toEqual(['duplicate', 'applied']);

    const { rows } = await admin.query(`select count(*)::int as n from order_events where order_id = $1 and to_status = 'fulfilled'`, [orderId]);
    expect(rows[0]?.n).toBe(1);
    const { rows: linked } = await admin.query('select count(*)::int as n from transactions where order_id = $1', [orderId]);
    expect(linked[0]?.n).toBe(2);
  });

  it('đơn không có, đơn của người khác, phiếu BÁN cho đơn mình là bên mua → rejected VALIDATION_FAILED', async () => {
    const orderId = await acceptedOrder();
    const staff = await as(vuaStaff, vua);
    const op = opMaker();
    for (const data of [txData({ orderId: newId() }), txData({ orderId, kind: 'sale' })]) {
      const res = SyncPushResult.parse((await staff.push([op('transaction', 'insert', newId(), data)]).expect(200)).body);
      expect(res.results[0]?.status).toBe('rejected');
      expect(res.results[0]?.error).toMatchObject({ code: 'VALIDATION_FAILED', details: { fields: { orderId: expect.any(String) } } });
    }
    await giveTrial(other);
    const stranger = SyncPushResult.parse(
      (await (await as(otherOwner, other)).push([opMaker()('transaction', 'insert', newId(), txData({ orderId }))]).expect(200)).body,
    );
    expect(stranger.results[0]?.error?.code).toBe('VALIDATION_FAILED');
    const { rows } = await admin.query('select status from orders where id = $1', [orderId]);
    expect(rows[0]?.status).toBe('accepted');
  });

  it('nháp theo đơn đồng bộ được, kéo về mang orderId', async () => {
    const orderId = await acceptedOrder();
    const staff = await as(vuaStaff, vua);
    const draftId = newId();
    const draft = { status: 'draft', supplierName: 'Cô Mai', lines: [], amountPaid: 0, orderId };
    expect(SyncPushResult.parse((await staff.push([opMaker()('draft', 'insert', draftId, draft)]).expect(200)).body).results[0]?.status).toBe(
      'applied',
    );
    const pulled = SyncPullResult.parse((await staff.pull().expect(200)).body);
    expect(pulled.changes.drafts.find((d) => d.id === draftId)?.orderId).toBe(orderId);
  });
});

describe('thông báo', () => {
  it('đọc từng cái, đọc tất cả; tổ chức khác không đọc được; phân trang', async () => {
    const maiApi = await as(mai, farm);
    for (let i = 0; i < 3; i++) await maiApi.post('/v1/orders', { ...sellOrder, counterpartOrgId: vua }).expect(200);
    await notificationsOf(vua, 'order.submitted', 3);

    const vuaApi = await as(vuaStaff, vua);
    const page1 = NotificationsResult.parse((await vuaApi.get('/v1/notifications', { limit: 2 }).expect(200)).body);
    expect(page1.notifications).toHaveLength(2);
    expect(page1.unread).toBe(3);
    const page2 = NotificationsResult.parse((await vuaApi.get('/v1/notifications', { limit: 2, cursor: page1.cursor ?? '' }).expect(200)).body);
    expect(page2.notifications).toHaveLength(1);
    expect(page2.cursor).toBeNull();

    const firstId = page1.notifications[0]?.id ?? '';
    // Người lạ "đọc" thông báo của vựa: không có tác dụng.
    await (await as(otherOwner, other)).post('/v1/notifications/read', { ids: [firstId] }).expect(200);
    const one = NotificationsReadResult.parse((await vuaApi.post('/v1/notifications/read', { ids: [firstId] }).expect(200)).body);
    expect(one.unread).toBe(2);
    const all = NotificationsReadResult.parse((await vuaApi.post('/v1/notifications/read').expect(200)).body);
    expect(all.unread).toBe(0);
    expect(NotificationsResult.parse((await (await as(otherOwner, other)).get('/v1/notifications').expect(200)).body).notifications).toEqual([]);
  });

  it('kết nối được đồng ý / bị huỷ → bên kia được báo', async () => {
    const pending = await link(vua, 'supplier', await createSupplier(vua, '0987 654 321', 'Anh Tư'), farm, 'pending');
    await (await as(mai, farm)).post(`/v1/links/${pending}/revoke`).expect(200);
    const [revoked] = await notificationsOf(vua, 'link.revoked');
    expect(revoked?.payload).toMatchObject({ linkId: pending, fromOrgName: 'Hộ cô Mai' });
  });
});

describe('luật ở database', () => {
  const insertOrder = async () => {
    const id = newId();
    await admin.query(
      `insert into orders (id, seller_org_id, buyer_org_id, created_by_org_id, created_by, est_quantity)
       values ($1, $2, $3, $2, $4, 100)`,
      [id, farm, vua, mai],
    );
    return id;
  };

  it('🔴 phiếu gắn đơn của tổ chức khác → bị chặn dù khoá ngoại một cột không đi qua RLS', async () => {
    const orderId = await insertOrder();
    const msg = await serviceError(
      { userId: otherOwner, orgId: other },
      `insert into transactions (id, organization_id, created_by, date, kind, supplier_name, lines, order_id)
       values ($1, $2, $3, now(), 'purchase', 'x', '[]', $4)`,
      [newId(), other, otherOwner, orderId],
    );
    expect(msg).toMatch(/không phải đúng bên/);
  });

  it('đơn: không tạo thẳng trạng thái khác submitted, không đổi hai bên, không nhảy trạng thái, bên tạo không tự nhận', async () => {
    const orderId = await insertOrder();
    const asFarm = { userId: mai, orgId: farm };
    expect(
      await serviceError(
        asFarm,
        `insert into orders (seller_org_id, buyer_org_id, created_by_org_id, created_by, est_quantity, status)
         values ($1, $2, $1, $3, 1, 'accepted')`,
        [farm, vua, mai],
      ),
    ).toMatch(/submitted/);
    expect(await serviceError(asFarm, 'update orders set buyer_org_id = $2, version = 2 where id = $1', [orderId, other])).toMatch(
      /hai bên/,
    );
    expect(await serviceError(asFarm, `update orders set status = 'accepted', version = 2 where id = $1`, [orderId])).toMatch(
      /không tự nhận/,
    );
    expect(await serviceError(asFarm, `update orders set status = 'scheduled', version = 2 where id = $1`, [orderId])).toMatch(
      /Không chuyển được/,
    );
    expect(await serviceError(asFarm, `update orders set status = 'cancelled' where id = $1`, [orderId])).toMatch(/version/);
  });

  it('notify_order chỉ ghi cho bên kia của đơn mình là một bên', async () => {
    const orderId = await insertOrder();
    const fromStranger = await asService({ userId: otherOwner, orgId: other }, (c) =>
      c.query<{ id: string | null }>(`select public.notify_order($1, 'order.cancelled') as id`, [orderId]),
    );
    expect(fromStranger.rows[0]?.id).toBeNull();
    expect(
      await serviceError({ userId: mai, orgId: farm }, `select public.notify_order($1, 'plan.activated')`, [orderId]),
    ).toMatch(/chỉ cho thông báo về đơn/);
    // anon / authenticated của Supabase không gọi được.
    const { rows } = await admin.query(
      `select has_function_privilege('authenticated', 'public.notify_order(uuid, text)', 'execute') as can`,
    );
    expect(rows[0]?.can).toBe(false);
  });
});
