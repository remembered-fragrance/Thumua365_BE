/**
 * Hằng số gói — trùng với `src/config.ts` của frontend (TRIAL_DAYS, GRACE_DAYS).
 * `@mambo/core/subscription` nhận chúng làm tham số: core không import ra ngoài.
 */

import type { PlanCode } from '@mambo/contracts';

/** Vựa và doanh nghiệp mới đăng ký được dùng thử ngần này ngày (KH §1.7). */
export const TRIAL_DAYS = 30;

/** Hết kỳ đã trả tiền vẫn đồng bộ được thêm ngần này ngày, có banner nhắc. */
export const GRACE_DAYS = 7;

/**
 * Bảng giá tài khoản vựa (0.28.0, duyệt 31/10/2026) — năm = 10 tháng. Doanh nghiệp không có ở đây: giá theo số
 * chi nhánh, quản trị viên kích hoạt. Gói Vựa đứng trước: app cũ tìm giá theo `months` và lấy dòng đầu, rồi gửi
 * `{ months }` — máy chủ hiểu là mua Vựa, nên số app cũ hiện khớp số phải chuyển.
 */
export const PLAN_PRICES: readonly { readonly plan: PlanCode; readonly months: 1 | 12; readonly amount: number }[] = [
  { plan: 'vua', months: 1, amount: 449_000 },
  { plan: 'vua', months: 12, amount: 4_490_000 },
  { plan: 'thuong_lai', months: 1, amount: 199_000 },
  { plan: 'thuong_lai', months: 12, amount: 1_990_000 },
];

/** Một người cân thêm (chỉ gói Vựa) cho trọn một kỳ. */
export const STAFF_PRICES: readonly { readonly months: 1 | 12; readonly amount: number }[] = [
  { months: 1, amount: 79_000 },
  { months: 12, amount: 790_000 },
];

/**
 * Giá trước 0.28.0 (một gói 149.000đ / 1.490.000đ). Ý định tạo trước 0.28.0 không có cột gói / số tháng: webhook
 * suy số tháng từ số tiền ở đây và mở gói Vựa (chốt 30/10) — mã chuyển khoản còn dở (`REUSE_MS` 24 giờ) vẫn mở được gói.
 */
export const LEGACY_PRICES: readonly { readonly months: 1 | 12; readonly amount: number }[] = [
  { months: 1, amount: 149_000 },
  { months: 12, amount: 1_490_000 },
];
