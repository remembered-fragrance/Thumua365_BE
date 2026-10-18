/**
 * Đơn trong database ↔ đơn trên mạng, và ghi lịch sử đơn. Dùng chung cho `OrdersService` và đồng
 * bộ sổ (phiếu theo đơn → `fulfilled` trong cùng transaction với phiếu, KH §4.1 mục 8).
 */

import { type OrderStatus, type OrderSummary, OrgType } from '@mambo/contracts';
import type { AuthUser } from '../auth/auth-user';
import type { MembershipContext } from '../auth/membership';
import type { Tx } from '../db/database';
import type { OrderChanged } from '../events/domain-events';
import type { Order, Prisma } from '../generated/prisma/client';

export interface Counterpart {
  id: string;
  name: string;
  type: string;
}

/**
 * Đơn người gắn chi nhánh đụng được: đơn tổ chức mình tạo ở ĐÚNG chi nhánh mình, và mọi đơn bên kia
 * gửi tới. `orders.branch_id` là chi nhánh của BÊN TẠO đơn — đơn bên kia gửi tới không mang chi
 * nhánh nào của mình (nông dân gửi: `null`; vựa / DN khác: chi nhánh của họ), lọc theo cột đó thì
 * người gắn chi nhánh không bao giờ thấy đơn gửi tới. Dùng chung cho danh sách đơn và phiếu theo đơn.
 */
export const branchScope = (m: Pick<MembershipContext, 'organizationId' | 'branchId'>): Prisma.OrderWhereInput =>
  m.branchId === null
    ? {}
    : {
        OR: [
          { createdByOrgId: m.organizationId, branchId: m.branchId },
          // `<>` bỏ qua NULL: bên tạo đã xoá tài khoản thì `created_by_org_id` là null.
          { createdByOrgId: { not: m.organizationId } },
          { createdByOrgId: null },
        ],
      };

export const logStep = async (
  tx: Tx,
  orderId: string,
  from: string | null,
  to: OrderStatus,
  actorUserId: string,
  actorOrgId: string,
  note: string | null | undefined,
): Promise<void> => {
  await tx.orderEvent.create({
    data: { orderId, fromStatus: from, toStatus: to, actorUserId, actorOrgId, note: note ?? null },
    select: { id: true },
  });
};

export const changeOf = (order: Order, user: Pick<AuthUser, 'id'>, actorOrgId: string): OrderChanged => ({
  orderId: order.id,
  actorOrgId,
  actorUserId: user.id,
  sellerOrgId: order.sellerOrgId,
  buyerOrgId: order.buyerOrgId,
});

const otherSide = (order: Order, orgId: string): string | null =>
  order.sellerOrgId === orgId ? order.buyerOrgId : order.sellerOrgId;

/** Dòng danh bạ trong sổ CỦA MÌNH ứng với bên kia: người bán khi mình mua, người mua khi mình bán. */
const myPartnerId = (order: Order, orgId: string): string | null =>
  order.sellerOrgId === orgId ? order.buyerPartnerId : order.sellerPartnerId;

/** Tên để hiện cho một trang đơn: tổ chức bên kia (còn tài khoản) và dòng danh bạ trong sổ mình. */
export interface OrderNames {
  readonly orgs: ReadonlyMap<string, Counterpart>;
  readonly partners: ReadonlyMap<string, string>;
}

export const orderNames = async (tx: Tx, orgId: string, orders: readonly Order[]): Promise<OrderNames> => {
  const unique = (ids: (string | null)[]) => [...new Set(ids.filter((id): id is string => id !== null))];
  const orgIds = unique(orders.map((o) => otherSide(o, orgId)));
  // Mình mua → người bán là dòng nhà cung cấp; mình bán → người mua là dòng khách mua.
  const supplierIds = unique(orders.filter((o) => o.sellerOrgId !== orgId).map((o) => o.sellerPartnerId));
  const buyerIds = unique(orders.filter((o) => o.sellerOrgId === orgId).map((o) => o.buyerPartnerId));

  const orgs =
    orgIds.length > 0 ? await tx.$queryRaw<Counterpart[]>`select * from public.order_counterparts(${orgIds}::uuid[])` : [];
  // Cả dòng đã xoá mềm: đơn cũ vẫn phải có tên. Lọc theo tổ chức dù RLS đã lọc — sổ nào tên nấy.
  const select = { id: true, name: true } as const;
  const suppliers =
    supplierIds.length > 0 ? await tx.supplier.findMany({ where: { id: { in: supplierIds }, organizationId: orgId }, select }) : [];
  const buyers =
    buyerIds.length > 0 ? await tx.buyer.findMany({ where: { id: { in: buyerIds }, organizationId: orgId }, select }) : [];
  return {
    orgs: new Map(orgs.map((r) => [r.id, r])),
    partners: new Map([...suppliers, ...buyers].map((p) => [p.id, p.name])),
  };
};

export const summaryOf = async (tx: Tx, orgId: string, order: Order): Promise<OrderSummary> =>
  toSummary(order, orgId, await orderNames(tx, orgId, [order]));

export const toSummary = (order: Order, orgId: string, names: OrderNames): OrderSummary => {
  const role = order.sellerOrgId === orgId ? 'seller' : 'buyer';
  // Bên kia null = đã xoá tài khoản. Còn id mà không đọc được tên là lỗi thật (hàm/quyền hỏng).
  const otherId = otherSide(order, orgId);
  const other = otherId === null ? null : names.orgs.get(otherId);
  if (other === undefined) throw new Error(`Không đọc được tổ chức bên kia của đơn ${order.id}`);
  const createdByMe = order.createdByOrgId === orgId;
  const partnerId = myPartnerId(order, orgId);
  return {
    id: order.id,
    status: order.status as OrderStatus,
    version: order.version,
    role,
    createdByMe,
    counterpart: other ? { id: other.id, name: other.name, type: OrgType.parse(other.type) } : null,
    crop: (order.crop as OrderSummary['crop']) ?? null,
    productId: createdByMe ? order.productId : null,
    estQuantity: order.estQuantity,
    unit: order.unit,
    offeredPrice: order.offeredPrice,
    pickupAt: order.pickupAt ? order.pickupAt.toISOString() : null,
    pickupAddress: order.pickupAddress,
    branchId: order.branchId,
    partnerId,
    partnerName: partnerId === null ? null : (names.partners.get(partnerId) ?? null),
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  };
};
