/**
 * Đơn hàng & đặt lịch — KH backend §1.5, BE5.
 *
 * Đơn là thực thể CHUNG giữa hai tổ chức (bên bán, bên mua), server giữ, không nằm trong sổ
 * offline — id do server sinh, tạo và chuyển trạng thái đều cần mạng. Bản đầu chỉ gửi đơn cho
 * tổ chức ĐÃ KẾT NỐI (`LINK_REQUIRED` nếu chưa).
 *
 *   submitted ──accept──▶ accepted ──schedule──▶ scheduled ──(phiếu theo đơn đồng bộ lên)──▶ fulfilled
 *       └──reject/cancel─────┴───────cancel──────────┴──▶ cancelled
 *
 * Ai làm gì (ngoài quyền trong ma trận §1.6):
 *   accept · reject — bên NHẬN đơn (không phải bên tạo), `order:respond`
 *   schedule        — bên MUA (người đến cân), `order:respond`; hẹn lại được khi đã `scheduled`
 *   cancel          — bên nào cũng được: bên tạo cần `order:create`, bên nhận cần `order:respond`
 *   fulfilled       — KHÔNG có endpoint: phiếu có `orderId` đồng bộ lên thì server tự chuyển
 *
 * Mọi lần chuyển mang `version` đang thấy; lệch (bên kia vừa đổi) → 409 `ORDER_STATE_CHANGED`,
 * app tải lại đơn. Cùng mã khi trạng thái hiện tại không cho bước đó.
 */

import { z } from 'zod';
import { OrgRef } from './links.js';
import { CropType } from './sync-records.js';

const Time = z.iso.datetime({ offset: true });
const Note = z.string().trim().max(500).nullable().optional();

export const OrderStatus = z.enum(['submitted', 'accepted', 'scheduled', 'fulfilled', 'cancelled']);
export type OrderStatus = z.infer<typeof OrderStatus>;

/** Vai trò của tổ chức ĐANG LÀM VIỆC trong đơn. */
export const OrderRole = z.enum(['seller', 'buyer']);
export type OrderRole = z.infer<typeof OrderRole>;

export const OrderIdParams = z.strictObject({ id: z.uuid() });
export type OrderIdParams = z.infer<typeof OrderIdParams>;

// ─── POST /v1/orders ─────────────────────────────────────────────────────────

/**
 * Nông dân tạo đơn bán (`role: 'seller'`) cho vựa đã kết nối; vựa/DN cũng tạo được đơn mua hay
 * bán với tổ chức đã kết nối. Kết nối phải đúng chiều: bên bán là người bán trong sổ bên mua, hoặc
 * bên mua là người mua trong sổ bên bán.
 */
export const OrderCreateInput = z.strictObject({
  role: OrderRole,
  /** Tổ chức bên kia — lấy từ `counterpart.id` của một kết nối `active`. */
  counterpartOrgId: z.uuid(),
  crop: CropType.nullable().optional(),
  /** Mặt hàng trong sổ CỦA MÌNH (chỉ vựa/DN). Bên kia không thấy id này. */
  productId: z.uuid().nullable().optional(),
  estQuantity: z.number().positive().max(10_000_000),
  unit: z.string().trim().min(1).max(20).default('kg'),
  /** Giá đề nghị mỗi đơn vị, đồng. */
  offeredPrice: z.number().nonnegative().max(1_000_000_000).nullable().optional(),
  pickupAt: Time.nullable().optional(),
  pickupAddress: z.string().trim().max(300).nullable().optional(),
  /** Lời nhắn kèm đơn — lưu ở mốc `submitted` của lịch sử đơn. */
  note: Note,
});
export type OrderCreateInput = z.input<typeof OrderCreateInput>;

// ─── Đơn nhìn từ tổ chức đang làm việc ───────────────────────────────────────

export const OrderSummary = z.object({
  id: z.uuid(),
  status: OrderStatus,
  /** Gửi lại đúng số này khi chuyển trạng thái. */
  version: z.number().int().positive(),
  role: OrderRole,
  /** Tổ chức mình là bên tạo đơn. */
  createdByMe: z.boolean(),
  counterpart: OrgRef,
  crop: CropType.nullable(),
  /** Mặt hàng trong sổ của bên tạo — chỉ có khi `createdByMe`. */
  productId: z.uuid().nullable(),
  estQuantity: z.number(),
  unit: z.string(),
  offeredPrice: z.number().nullable(),
  pickupAt: Time.nullable(),
  pickupAddress: z.string().nullable(),
  /** Doanh nghiệp: chi nhánh nhận đơn. */
  branchId: z.uuid().nullable(),
  /**
   * Dòng danh bạ trong sổ CỦA MÌNH ứng với bên kia (người bán khi mình mua, người mua khi mình
   * bán) — ô "Theo đơn" của màn Tạo phiếu điền sẵn `counterpartyId` bằng id này. null khi mình
   * không có sổ hoặc bên kia chưa có trong danh bạ của mình.
   */
  partnerId: z.uuid().nullable(),
  createdAt: Time,
  updatedAt: Time,
});
export type OrderSummary = z.infer<typeof OrderSummary>;

export const OrderEventView = z.object({
  fromStatus: OrderStatus.nullable(),
  toStatus: OrderStatus,
  /** Tổ chức nào làm bước này, nhìn từ mình. */
  by: z.enum(['me', 'counterpart']),
  note: z.string().nullable(),
  at: Time,
});
export type OrderEventView = z.infer<typeof OrderEventView>;

/** Một đơn kèm lịch sử, cũ nhất trước. */
export const OrderDetail = OrderSummary.extend({ events: z.array(OrderEventView) });
export type OrderDetail = z.infer<typeof OrderDetail>;

export const OrdersListQuery = z.strictObject({
  /** Chỉ đơn mình bán / chỉ đơn mình mua. Bỏ trống = cả hai. */
  role: OrderRole.optional(),
  status: OrderStatus.optional(),
  cursor: z.string().min(1).max(500).optional(),
  /** Mặc định 50. */
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
export type OrdersListQuery = z.output<typeof OrdersListQuery>;

/** Mới tạo trước. `cursor` null = hết. */
export const OrdersListResult = z.object({ orders: z.array(OrderSummary), cursor: z.string().nullable() });
export type OrdersListResult = z.infer<typeof OrdersListResult>;

// ─── Chuyển trạng thái ───────────────────────────────────────────────────────

/** accept · reject · cancel. */
export const OrderTransitionInput = z.strictObject({ version: z.number().int().positive(), note: Note });
export type OrderTransitionInput = z.input<typeof OrderTransitionInput>;

export const OrderScheduleInput = z.strictObject({
  version: z.number().int().positive(),
  pickupAt: Time,
  /** Bỏ trống = giữ địa chỉ đang có. */
  pickupAddress: z.string().trim().max(300).nullable().optional(),
  note: Note,
});
export type OrderScheduleInput = z.input<typeof OrderScheduleInput>;
