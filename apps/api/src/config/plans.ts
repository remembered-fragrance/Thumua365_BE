/**
 * Hằng số gói — trùng với `src/config.ts` của frontend (TRIAL_DAYS, GRACE_DAYS).
 * `@mambo/core/subscription` nhận chúng làm tham số: core không import ra ngoài.
 */

/** Vựa và doanh nghiệp mới đăng ký được dùng thử ngần này ngày (KH §1.7). */
export const TRIAL_DAYS = 30;

/** Hết kỳ đã trả tiền vẫn đồng bộ được thêm ngần này ngày, có banner nhắc. */
export const GRACE_DAYS = 7;

/**
 * Bảng giá vựa (KH §1.7) — trùng `PRICE_MONTHLY`, `PRICE_YEARLY`, `MONTHS_PER_PRICE` của frontend.
 * Doanh nghiệp không có ở đây: giá theo số chi nhánh, quản trị viên kích hoạt.
 */
export const PLAN_PRICES: readonly { readonly months: 1 | 12; readonly amount: number }[] = [
  { months: 1, amount: 149_000 },
  { months: 12, amount: 1_490_000 },
];

/** Số tháng ứng với một số tiền đúng bảng giá; khác bảng giá → null. */
export const monthsForAmount = (amount: number): number | null =>
  PLAN_PRICES.find((p) => p.amount === amount)?.months ?? null;
