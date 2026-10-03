/**
 * Đo lường first-party — KH backend §6, BE9 (R5). Danh mục sự kiện CÓ KIỂU: mỗi tên một bộ thuộc
 * tính `strictObject` — thuộc tính lạ bị bỏ cả sự kiện. Không bao giờ có tên, số điện thoại, email
 * hay số tiền cụ thể (trang Quyền riêng tư chỉ hứa những gì làm thật).
 *
 * Tên: `đối_tượng_hành_động`, tiếng Anh, snake_case, thì quá khứ. Ba sự kiện do SERVER bắn (không
 * nhận từ app): `plan_activated`, `order_fulfilled`, `link_accepted`.
 *
 * App gửi qua hàng đợi riêng (`track()`), lô ≤ 50. Có đăng nhập + `X-Organization-Id` thì server tự
 * gắn tổ chức và `orgType` từ membership; chưa đăng nhập thì chỉ có `anonId` (+ `orgType` app khai,
 * nếu biết). Sự kiện sai hình dạng bị bỏ RIÊNG LẺ (`dropped`) — không 422 cả lô, để hàng đợi không kẹt.
 */

import { z } from 'zod';
import { OrgType } from './organization.js';

const Time = z.iso.datetime({ offset: true });
const Count = z.number().int().nonnegative().max(100_000);
const none = z.strictObject({});

/** Phần chung của mọi sự kiện. */
const common = {
  /** Id ngẫu nhiên app sinh một lần và giữ trong máy — không gắn với người. */
  anonId: z.string().min(8).max(64),
  /** Giờ trên máy lúc xảy ra (lúc mất mạng vẫn đúng thứ tự). */
  at: Time,
  platform: z.enum(['web', 'pwa', 'twa']),
  appVersion: z.string().max(32).optional(),
  /** Chỉ dùng khi chưa đăng nhập; đã đăng nhập thì server lấy từ membership. */
  orgType: OrgType.optional(),
};

const event = <N extends string, P extends z.ZodType>(name: N, props: P) =>
  z.strictObject({ ...common, name: z.literal(name), props });

/** Một sự kiện app gửi: phần chung + đúng bộ thuộc tính của tên đó. */
export const TrackedEvent = z.discriminatedUnion('name', [
  event('app_opened', none),
  event('sign_up_completed', z.strictObject({ orgType: OrgType })),
  event('login_succeeded', z.strictObject({ method: z.enum(['phone', 'username', 'email']) })),
  event('login_failed', z.strictObject({ reason: z.enum(['wrong_credentials', 'network', 'other']) })),
  event('order_created', z.strictObject({ role: z.enum(['seller', 'buyer']) })),
  event('order_accepted', none),
  event('order_scheduled', none),
  event('receipt_created', z.strictObject({ kind: z.enum(['purchase', 'sale']), lines: Count, offline: z.boolean(), fromOrder: z.boolean() })),
  event('receipt_shared', z.strictObject({ channel: z.enum(['zalo', 'image', 'pdf', 'other']) })),
  event('debt_payment_recorded', z.strictObject({ offline: z.boolean() })),
  event('import_completed', z.strictObject({ kind: z.enum(['receipts', 'partners']), rows: Count })),
  event('quota_wall_shown', z.strictObject({ feature: z.enum(['sync', 'branches', 'other']) })),
  event('plans_viewed', none),
  event('checkout_started', z.strictObject({ months: z.union([z.literal(1), z.literal(12)]) })),
  event('member_invited', z.strictObject({ role: z.enum(['manager', 'staff']) })),
  event('contact_clicked', z.strictObject({ channel: z.enum(['zalo', 'phone', 'email']) })),
  event('account_deleted', none),
]);
export type TrackedEvent = z.input<typeof TrackedEvent>;
export type ClientEventName = TrackedEvent['name'];

export const SERVER_EVENT_NAMES = ['plan_activated', 'order_fulfilled', 'link_accepted'] as const;
export type ServerEventName = (typeof SERVER_EVENT_NAMES)[number];

export const EVENTS_MAX_BATCH = 50;

/** Cổng chỉ kiểm vỏ lô; từng sự kiện kiểm riêng (sai thì bỏ riêng nó). */
export const EventsTrackInput = z.strictObject({ events: z.array(z.unknown()).min(1).max(EVENTS_MAX_BATCH) });
/** Hình dạng đầy đủ, cho tài liệu / mock. */
export const EventsTrackRequest = z.strictObject({ events: z.array(TrackedEvent).min(1).max(EVENTS_MAX_BATCH) });
export type EventsTrackRequest = z.input<typeof EventsTrackRequest>;

export const EventsTrackResult = z.object({ accepted: Count, dropped: Count });
export type EventsTrackResult = z.infer<typeof EventsTrackResult>;

// ─── Phễu cho quản trị ───────────────────────────────────────────────────────

export const AdminFunnelQuery = z.strictObject({ from: Time, to: Time });
export type AdminFunnelQuery = z.output<typeof AdminFunnelQuery>;

export const AdminFunnel = z.object({
  from: Time,
  to: Time,
  /** Mỗi (loại tổ chức, sự kiện) một dòng; `orgType` null = chưa đăng nhập. */
  rows: z.array(
    z.object({
      orgType: OrgType.nullable(),
      name: z.string(),
      events: Count,
      /** Số tổ chức khác nhau (đã đăng nhập) / số máy khác nhau (anonId). */
      organizations: Count,
      devices: Count,
      firstAt: Time,
      lastAt: Time,
    }),
  ),
});
export type AdminFunnel = z.infer<typeof AdminFunnel>;
