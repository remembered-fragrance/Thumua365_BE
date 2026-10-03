/**
 * Đơn trong database ↔ đơn trên mạng, và ghi lịch sử đơn. Dùng chung cho `OrdersService` và đồng
 * bộ sổ (phiếu theo đơn → `fulfilled` trong cùng transaction với phiếu, KH §4.1 mục 8).
 */

import { type OrderStatus, type OrderSummary, OrgType } from '@mambo/contracts';
import type { AuthUser } from '../auth/auth-user';
import type { Tx } from '../db/database';
import type { OrderChanged } from '../events/domain-events';
import type { Order } from '../generated/prisma/client';

export interface Counterpart {
  id: string;
  name: string;
  type: string;
}

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

export const counterparts = async (tx: Tx, orgId: string, orders: readonly Order[]): Promise<Map<string, Counterpart>> => {
  const ids = [...new Set(orders.map((o) => otherSide(o, orgId)).filter((id): id is string => id !== null))];
  if (ids.length === 0) return new Map();
  const rows = await tx.$queryRaw<Counterpart[]>`select * from public.order_counterparts(${ids}::uuid[])`;
  return new Map(rows.map((r) => [r.id, r]));
};

export const summaryOf = async (tx: Tx, orgId: string, order: Order): Promise<OrderSummary> =>
  toSummary(order, orgId, await counterparts(tx, orgId, [order]));

export const toSummary = (order: Order, orgId: string, names: ReadonlyMap<string, Counterpart>): OrderSummary => {
  const role = order.sellerOrgId === orgId ? 'seller' : 'buyer';
  const other = names.get(otherSide(order, orgId) ?? '');
  if (!other) throw new Error(`Không đọc được tổ chức bên kia của đơn ${order.id}`);
  const createdByMe = order.createdByOrgId === orgId;
  return {
    id: order.id,
    status: order.status as OrderStatus,
    version: order.version,
    role,
    createdByMe,
    counterpart: { id: other.id, name: other.name, type: OrgType.parse(other.type) },
    crop: (order.crop as OrderSummary['crop']) ?? null,
    productId: createdByMe ? order.productId : null,
    estQuantity: order.estQuantity,
    unit: order.unit,
    offeredPrice: order.offeredPrice,
    pickupAt: order.pickupAt ? order.pickupAt.toISOString() : null,
    pickupAddress: order.pickupAddress,
    branchId: order.branchId,
    partnerId: role === 'buyer' ? order.sellerPartnerId : order.buyerPartnerId,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  };
};
