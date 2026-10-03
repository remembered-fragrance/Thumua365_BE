/**
 * Thông báo trong app — KH backend §1.8, BE5. Hợp đồng: `@mambo/contracts/notifications`.
 *
 * Đọc và đánh dấu đã đọc đi qua RLS (`org_rows`: chỉ tổ chức đang làm việc). Thông báo do
 * `NotificationsListener` ghi sau khi việc chính đã commit — không có endpoint tạo thông báo.
 */

import {
  type NotificationKind,
  type NotificationsQuery,
  type NotificationsReadResult,
  type NotificationsResult,
  type NotificationView,
  OrderStatus,
  OrgType,
} from '@mambo/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth-user';
import type { MembershipContext } from '../auth/membership';
import { encodeCursor, olderThan } from '../common/page-cursor';
import { DATABASE, type Database } from '../db/database';
import type { Notification, Prisma } from '../generated/prisma/client';

const LIST_DEFAULT_LIMIT = 50;

/** Payload do `notify_order()` / `notify_link()` ghi. Đọc lỏng: thiếu trường thì để null. */
const Payload = z.object({
  orderId: z.uuid().optional(),
  orderStatus: OrderStatus.optional(),
  pickupAt: z.string().nullable().optional(),
  linkId: z.uuid().optional(),
  fromOrgId: z.uuid().optional(),
  fromOrgName: z.string().optional(),
  fromOrgType: OrgType.optional(),
});

/** Của cả tổ chức (`user_id` null) hoặc riêng người đang xem. */
const mine = (user: AuthUser, m: MembershipContext): Prisma.NotificationWhereInput => ({
  organizationId: m.organizationId,
  OR: [{ userId: null }, { userId: user.id }],
});

const toView = (row: Notification): NotificationView => {
  const parsed = Payload.safeParse(row.payload);
  const data = parsed.success ? parsed.data : {};
  return {
    id: row.id,
    kind: row.kind as NotificationKind,
    from:
      data.fromOrgId && data.fromOrgName && data.fromOrgType
        ? { id: data.fromOrgId, name: data.fromOrgName, type: data.fromOrgType }
        : null,
    orderId: data.orderId ?? null,
    orderStatus: data.orderStatus ?? null,
    pickupAt: data.pickupAt ? new Date(data.pickupAt).toISOString() : null,
    linkId: data.linkId ?? null,
    read: row.readAt !== null,
    createdAt: row.createdAt.toISOString(),
  };
};

@Injectable()
export class NotificationsService {
  private readonly db: Database;

  constructor(@Inject(DATABASE) db: Database) {
    this.db = db;
  }

  list(user: AuthUser, m: MembershipContext, query: NotificationsQuery): Promise<NotificationsResult> {
    const limit = query.limit ?? LIST_DEFAULT_LIMIT;
    return this.db.scoped({ userId: user.id, orgId: m.organizationId }, async (tx) => {
      const rows = await tx.notification.findMany({
        where: { AND: [mine(user, m), olderThan(query.cursor)] },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      });
      const unread = await tx.notification.count({ where: { AND: [mine(user, m), { readAt: null }] } });
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      return {
        notifications: page.map(toView),
        unread,
        cursor: rows.length > limit && last ? encodeCursor(last) : null,
      };
    });
  }

  /** `ids` bỏ trống = tất cả. Id lạ hay của tổ chức khác thì bỏ qua (RLS giấu) — gọi lại an toàn. */
  read(user: AuthUser, m: MembershipContext, ids: readonly string[] | undefined): Promise<NotificationsReadResult> {
    return this.db.scoped({ userId: user.id, orgId: m.organizationId }, async (tx) => {
      await tx.notification.updateMany({
        where: { AND: [mine(user, m), { readAt: null }, ids ? { id: { in: [...ids] } } : {}] },
        data: { readAt: new Date() },
      });
      return { unread: await tx.notification.count({ where: { AND: [mine(user, m), { readAt: null }] } }) };
    });
  }
}
