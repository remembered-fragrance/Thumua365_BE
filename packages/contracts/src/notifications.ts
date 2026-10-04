/**
 * Thông báo trong app — KH backend §1.8, BE5.
 *
 * Mỗi việc của bên kia (gửi đơn, nhận, hẹn lịch, huỷ, hoàn thành; đồng ý / huỷ kết nối) thành một
 * thông báo cho TỔ CHỨC bên này — mọi thành viên cùng thấy, cùng một trạng thái đã đọc. App hỏi
 * khi mở và mỗi 60 giây (Realtime ở giai đoạn 2). Email là kênh thứ hai, gửi qua hàng đợi job.
 *
 * `kind` liệt kê sẵn cả loại của các bước sau (thành viên — BE7, gói — BE6) để SDK đang chạy
 * không vỡ khi server bắt đầu gửi loại mới. App gặp loại chưa biết vẽ thì bỏ qua.
 */

import { z } from 'zod';
import { OrgRef } from './links.js';
import { OrderStatus } from './orders.js';

const Time = z.iso.datetime({ offset: true });

export const NOTIFICATION_KINDS = [
  'order.submitted',
  'order.accepted',
  'order.scheduled',
  'order.cancelled',
  'order.fulfilled',
  'link.accepted',
  'link.revoked',
  'member.invited',
  'member.role_changed',
  'plan.activated',
] as const;
export const NotificationKind = z.enum(NOTIFICATION_KINDS);
export type NotificationKind = z.infer<typeof NotificationKind>;

export const NotificationView = z.object({
  id: z.uuid(),
  kind: NotificationKind,
  /** Tổ chức gây ra việc — để hiện "Vựa Tư Hùng đã hẹn lịch". null với việc của hệ thống. */
  from: OrgRef.nullable(),
  orderId: z.uuid().nullable(),
  /** Trạng thái đơn ngay sau việc này. */
  orderStatus: OrderStatus.nullable(),
  /** Lịch hẹn lấy hàng, với `order.scheduled`. */
  pickupAt: Time.nullable(),
  linkId: z.uuid().nullable(),
  read: z.boolean(),
  createdAt: Time,
});
export type NotificationView = z.infer<typeof NotificationView>;

export const NotificationsQuery = z.strictObject({
  cursor: z.string().min(1).max(500).optional(),
  /** Mặc định 50. */
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
export type NotificationsQuery = z.output<typeof NotificationsQuery>;

/** Mới nhất trước. `unread` đếm trên toàn bộ, không chỉ trang này. */
export const NotificationsResult = z.object({
  notifications: z.array(NotificationView),
  unread: z.number().int().nonnegative(),
  cursor: z.string().nullable(),
});
export type NotificationsResult = z.infer<typeof NotificationsResult>;

/** Bỏ trống `ids` = đánh dấu đã đọc tất cả. Gọi lại an toàn. */
export const NotificationsReadInput = z.strictObject({ ids: z.array(z.uuid()).min(1).max(200).optional() });
export type NotificationsReadInput = z.input<typeof NotificationsReadInput>;

export const NotificationsReadResult = z.object({ unread: z.number().int().nonnegative() });
export type NotificationsReadResult = z.infer<typeof NotificationsReadResult>;
