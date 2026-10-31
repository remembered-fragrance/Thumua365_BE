/**
 * Tính tiền gói vựa (0.28.0) — hàm thuần, không đọc database. `createIntent` dùng để báo giá; webhook và quản trị
 * dùng để biết ý định mua gì và quy đổi ngày khi đổi gói. Số tiền luôn do máy chủ tính, app không gửi.
 */

import { daysBetween } from '@mambo/core/subscription';
import type { PlanCode } from '@mambo/contracts';
import { LEGACY_PRICES, PLAN_PRICES, STAFF_PRICES } from '../config/plans';

/**
 * Thứ một lần trả tiền mở ra. `plan` / `extraStaff` bỏ trống (chỉ quản trị viên) = giữ như gói đang có; `months` của
 * quản trị viên là 1–36, không chỉ 1 | 12.
 */
export type Purchase =
  | { readonly kind: 'plan'; readonly months: number; readonly plan?: PlanCode | undefined; readonly extraStaff?: number | undefined }
  | { readonly kind: 'staff'; readonly extraStaff: number };

const priceOf = (plan: PlanCode, months: 1 | 12): number => {
  const row = PLAN_PRICES.find((p) => p.plan === plan && p.months === months);
  if (!row) throw new Error(`Thiếu giá gói ${plan} ${months} tháng`);
  return row.amount;
};

const staffPriceOf = (months: 1 | 12): number => {
  const row = STAFF_PRICES.find((p) => p.months === months);
  if (!row) throw new Error(`Thiếu giá người cân ${months} tháng`);
  return row.amount;
};

/** Gói cho trọn kỳ, kể cả người cân thêm: Vựa 1 tháng + 2 người = 449.000 + 2 × 79.000 = 607.000đ. */
export const planAmount = (plan: PlanCode, months: 1 | 12, extraStaff: number): number =>
  priceOf(plan, months) + extraStaff * staffPriceOf(months);

/**
 * Mua thêm người cân giữa kỳ: trả theo ngày còn lại tới hạn gói, làm tròn XUỐNG tới 1.000đ (lợi khách, dễ chuyển
 * khoản). Đơn giá ngày theo kỳ đang dùng: tháng 79.000/30, năm 790.000/365. Còn 20 ngày (kỳ tháng), thêm 2 người →
 * 2 × 79.000 × 20 / 30 = 105.333 → 105.000đ. Ngày còn lại làm tròn lên như số ngày app hiện.
 */
export const staffTopUpAmount = (extraStaff: number, billingMonths: 1 | 12, periodEnd: Date, now: Date): number => {
  const days = daysBetween(now.getTime(), periodEnd.getTime());
  const periodDays = billingMonths === 12 ? 365 : 30;
  return Math.floor((extraStaff * staffPriceOf(billingMonths) * days) / periodDays / 1000) * 1000;
};

/**
 * Đổi gói giữa kỳ: số ngày đã trả còn lại quy đổi theo giá tháng của hai gói, làm tròn LÊN (nghiêng về khách).
 * Thương lái → Vựa: ⌈21 × 199.000 / 449.000⌉ = ⌈9,31⌉ = 10 ngày Vựa. Giá năm cùng tỉ lệ nên dùng chung.
 */
export const convertDays = (days: number, from: PlanCode, to: PlanCode): number =>
  Math.ceil((days * priceOf(from, 1)) / priceOf(to, 1));

/** Kỳ của một số tháng — đơn giá ngày người cân: từ 12 tháng trở lên tính giá năm. */
export const billingMonthsOf = (months: number): 1 | 12 => (months >= 12 ? 12 : 1);

interface IntentRow {
  readonly kind: string;
  readonly plan: string | null;
  readonly months: number | null;
  readonly extraStaff: number;
  readonly amount: number;
}

/**
 * Ý định này mua gì. Ý định tạo trước 0.28.0 không có cột gói / số tháng → bảng giá cũ, gói Vựa (chốt 30/10).
 * Số tiền lạ (không thể xảy ra trừ khi ai sửa tay) → 1 tháng như webhook cũ.
 */
export const purchaseOf = (row: IntentRow): Purchase & { readonly extraStaff: number } => {
  if (row.kind === 'staff') return { kind: 'staff', extraStaff: row.extraStaff };
  const plan: PlanCode = row.plan === 'thuong_lai' ? 'thuong_lai' : 'vua';
  const months = row.months ?? LEGACY_PRICES.find((p) => p.amount === row.amount)?.months ?? 1;
  return { kind: 'plan', plan, months, extraStaff: row.extraStaff };
};
