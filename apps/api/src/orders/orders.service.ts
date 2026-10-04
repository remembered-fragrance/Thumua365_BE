/**
 * Đơn hàng & đặt lịch — KH backend §1.5, BE5. Hợp đồng: `@mambo/contracts/orders`.
 *
 * Đọc/ghi đơn đi qua RLS như thường (policy `order_sides`: hai bên mua và bán). Chỉ TÊN tổ chức
 * bên kia cần nhìn xuyên tổ chức — qua hàm security definer `order_counterparts()`. Luật chuyển
 * trạng thái được trigger `orders_guard` giữ thêm một lớp ở database.
 *
 * Mọi lần chuyển: kiểm phía + quyền → so `version` → `updateMany … where version` (hai bên bấm
 * cùng lúc thì chỉ một người thắng, người kia nhận 409) → ghi `order_events` → sau commit phát
 * `order.<trạng thái>` (thông báo cho bên kia). `fulfilled` không có ở đây — xem đồng bộ sổ.
 */

import {
  can,
  OrderCreateInput,
  type OrderDetail,
  type OrdersListQuery,
  type OrdersListResult,
  OrderScheduleInput,
  type OrderStatus,
  type OrderSummary,
  OrderTransitionInput,
} from '@mambo/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { z } from 'zod';
import type { AuthUser } from '../auth/auth-user';
import type { MembershipContext } from '../auth/membership';
import { ApiException } from '../common/api-exception';
import { encodeCursor, olderThan } from '../common/page-cursor';
import { DATABASE, type Database } from '../db/database';
import { DomainEvents, type OrderEventName } from '../events/domain-events';
import type { Order, Prisma } from '../generated/prisma/client';
import { changeOf, counterparts, logStep, summaryOf, toSummary } from './order-records';

const LIST_DEFAULT_LIMIT = 50;

type CreateInput = z.output<typeof OrderCreateInput>;
type TransitionInput = z.output<typeof OrderTransitionInput>;
type ScheduleInput = z.output<typeof OrderScheduleInput>;

/** Ai được làm bước nào, từ trạng thái nào. */
const STEPS = {
  accept: { from: ['submitted'], to: 'accepted', side: 'receiver', event: 'order.accepted' },
  reject: { from: ['submitted'], to: 'cancelled', side: 'receiver', event: 'order.cancelled' },
  schedule: { from: ['accepted', 'scheduled'], to: 'scheduled', side: 'buyer', event: 'order.scheduled' },
  cancel: { from: ['submitted', 'accepted', 'scheduled'], to: 'cancelled', side: 'either', event: 'order.cancelled' },
} as const satisfies Record<
  string,
  { from: readonly OrderStatus[]; to: OrderStatus; side: 'receiver' | 'buyer' | 'either'; event: OrderEventName }
>;
export type OrderStep = keyof typeof STEPS;

const notFound = (): ApiException => new ApiException('NOT_FOUND', 'Không có đơn này');

const stateChanged = (order: Pick<Order, 'status' | 'version'>): ApiException =>
  new ApiException('ORDER_STATE_CHANGED', 'Đơn vừa được đổi ở nơi khác — tải lại đơn rồi làm lại', {
    status: order.status,
    version: order.version,
  });

/** Đơn tổ chức này thấy: là một bên; người gắn chi nhánh chỉ thấy đơn của chi nhánh mình. */
const visible = (m: MembershipContext): Prisma.OrderWhereInput => ({
  OR: [{ sellerOrgId: m.organizationId }, { buyerOrgId: m.organizationId }],
  ...(m.branchId ? { branchId: m.branchId } : {}),
});

const assertCanView = (m: MembershipContext): void => {
  if (!can(m.orgType, m.role, 'order:create') && !can(m.orgType, m.role, 'order:respond')) {
    throw new ApiException('FORBIDDEN', 'Không có quyền xem đơn', { permission: 'order:respond' });
  }
};

@Injectable()
export class OrdersService {
  private readonly db: Database;
  private readonly events: DomainEvents;

  constructor(@Inject(DATABASE) db: Database, events: DomainEvents) {
    this.db = db;
    this.events = events;
  }

  async list(user: AuthUser, m: MembershipContext, query: OrdersListQuery): Promise<OrdersListResult> {
    assertCanView(m);
    const orgId = m.organizationId;
    const limit = query.limit ?? LIST_DEFAULT_LIMIT;

    return this.db.scoped({ userId: user.id, orgId }, async (tx) => {
      const where: Prisma.OrderWhereInput = {
        AND: [
          visible(m),
          query.role === 'seller' ? { sellerOrgId: orgId } : query.role === 'buyer' ? { buyerOrgId: orgId } : {},
          query.status ? { status: query.status } : {},
          olderThan(query.cursor),
        ],
      };
      const rows = await tx.order.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit + 1 });
      const page = rows.slice(0, limit);
      const names = await counterparts(tx, orgId, page);
      const last = page.at(-1);
      return {
        orders: page.map((row) => toSummary(row, orgId, names)),
        cursor: rows.length > limit && last ? encodeCursor(last) : null,
      };
    });
  }

  /** Chỉ với tổ chức đã kết nối ĐÚNG CHIỀU: bên bán là người bán trong sổ bên mua, hoặc ngược lại. */
  async create(user: AuthUser, m: MembershipContext, input: CreateInput): Promise<OrderSummary> {
    const orgId = m.organizationId;
    if (input.counterpartOrgId === orgId) {
      throw new ApiException('VALIDATION_FAILED', 'Không tạo đơn với chính mình', {
        fields: { counterpartOrgId: 'Phải là tổ chức khác' },
      });
    }
    const sellerOrgId = input.role === 'seller' ? orgId : input.counterpartOrgId;
    const buyerOrgId = input.role === 'seller' ? input.counterpartOrgId : orgId;

    const { summary, changed } = await this.db.scoped({ userId: user.id, orgId }, async (tx) => {
      const links = await tx.partnerLink.findMany({
        where: {
          status: 'active',
          OR: [
            { ownerOrgId: buyerOrgId, linkedOrgId: sellerOrgId, partnerKind: 'supplier' },
            { ownerOrgId: sellerOrgId, linkedOrgId: buyerOrgId, partnerKind: 'buyer' },
          ],
        },
        select: { partnerKind: true, partnerId: true },
      });
      if (links.length === 0) {
        throw new ApiException('LINK_REQUIRED', 'Chỉ gửi đơn được cho tổ chức đã kết nối với mình');
      }

      if (input.productId) {
        const product = await tx.product.findFirst({
          where: { id: input.productId, organizationId: orgId, deletedAt: null },
          select: { id: true },
        });
        if (!product) {
          throw new ApiException('VALIDATION_FAILED', 'Không có mặt hàng này trong sổ', {
            fields: { productId: 'Không có mặt hàng này trong sổ' },
          });
        }
      }

      const order = await tx.order.create({
        data: {
          sellerOrgId,
          buyerOrgId,
          sellerPartnerId: links.find((l) => l.partnerKind === 'supplier')?.partnerId ?? null,
          buyerPartnerId: links.find((l) => l.partnerKind === 'buyer')?.partnerId ?? null,
          createdByOrgId: orgId,
          createdBy: user.id,
          productId: input.productId ?? null,
          crop: input.crop ?? null,
          estQuantity: input.estQuantity,
          unit: input.unit,
          offeredPrice: input.offeredPrice ?? null,
          pickupAt: input.pickupAt ? new Date(input.pickupAt) : null,
          pickupAddress: input.pickupAddress ?? null,
          branchId: m.branchId,
        },
      });
      await logStep(tx, order.id, null, 'submitted', user.id, orgId, input.note);
      return { summary: await summaryOf(tx, orgId, order), changed: changeOf(order, user, orgId) };
    });

    this.events.emit('order.submitted', changed);
    return summary;
  }

  async get(user: AuthUser, m: MembershipContext, id: string): Promise<OrderDetail> {
    assertCanView(m);
    const orgId = m.organizationId;
    return this.db.scoped({ userId: user.id, orgId }, async (tx) => {
      const order = await tx.order.findFirst({ where: { AND: [{ id }, visible(m)] } });
      if (!order) throw notFound();
      const events = await tx.orderEvent.findMany({ where: { orderId: id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
      return {
        ...(await summaryOf(tx, orgId, order)),
        events: events.map((e) => ({
          fromStatus: (e.fromStatus as OrderStatus | null) ?? null,
          toStatus: e.toStatus as OrderStatus,
          by: e.actorOrgId === orgId ? ('me' as const) : ('counterpart' as const),
          note: e.note,
          at: e.createdAt.toISOString(),
        })),
      };
    });
  }

  step(user: AuthUser, m: MembershipContext, id: string, step: Exclude<OrderStep, 'schedule'>, input: TransitionInput): Promise<OrderSummary> {
    return this.move(user, m, id, step, input, {});
  }

  schedule(user: AuthUser, m: MembershipContext, id: string, input: ScheduleInput): Promise<OrderSummary> {
    return this.move(user, m, id, 'schedule', input, {
      pickupAt: new Date(input.pickupAt),
      ...(input.pickupAddress !== undefined ? { pickupAddress: input.pickupAddress } : {}),
    });
  }

  private async move(
    user: AuthUser,
    m: MembershipContext,
    id: string,
    stepName: OrderStep,
    input: TransitionInput,
    extra: Prisma.OrderUpdateManyMutationInput,
  ): Promise<OrderSummary> {
    const rule = STEPS[stepName];
    const orgId = m.organizationId;

    const { summary, changed } = await this.db.scoped({ userId: user.id, orgId }, async (tx) => {
      const order = await tx.order.findFirst({ where: { AND: [{ id }, visible(m)] } });
      if (!order) throw notFound();
      assertSide(m, order, rule.side, stepName);
      if (order.version !== input.version || !(rule.from as readonly string[]).includes(order.status)) {
        throw stateChanged(order);
      }

      const { count } = await tx.order.updateMany({
        where: { id, version: input.version },
        data: { ...extra, status: rule.to, version: { increment: 1 } },
      });
      // Bên kia vừa đổi đơn giữa lúc đọc và lúc ghi — báo trạng thái MỚI để app hiện đúng.
      if (count === 0) throw stateChanged(await tx.order.findUniqueOrThrow({ where: { id } }));

      await logStep(tx, id, order.status, rule.to, user.id, orgId, input.note);
      const updated = await tx.order.findUniqueOrThrow({ where: { id } });
      return { summary: await summaryOf(tx, orgId, updated), changed: changeOf(updated, user, orgId) };
    });

    this.events.emit(rule.event, changed);
    return summary;
  }
}

/** Bên nhận nhận/từ chối; bên mua hẹn lịch; huỷ: bên tạo cần order:create, bên nhận cần order:respond. */
const assertSide = (m: MembershipContext, order: Order, side: 'receiver' | 'buyer' | 'either', step: OrderStep): void => {
  const orgId = m.organizationId;
  const isCreator = order.createdByOrgId === orgId;
  if (side === 'receiver' && isCreator) {
    throw new ApiException('FORBIDDEN', 'Bên tạo đơn không tự nhận hay từ chối đơn của mình', { step });
  }
  if (side === 'buyer' && order.buyerOrgId !== orgId) {
    throw new ApiException('FORBIDDEN', 'Chỉ bên mua hẹn lịch lấy hàng', { step });
  }
  if (side === 'either') {
    const permission = isCreator ? 'order:create' : 'order:respond';
    if (!can(m.orgType, m.role, permission)) {
      throw new ApiException('FORBIDDEN', 'Không có quyền huỷ đơn này', { permission });
    }
  }
};
