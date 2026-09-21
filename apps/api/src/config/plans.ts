/**
 * Hằng số gói — trùng với `src/config.ts` của frontend (TRIAL_DAYS, GRACE_DAYS).
 * `@mambo/core/subscription` nhận chúng làm tham số: core không import ra ngoài.
 */

/** Vựa và doanh nghiệp mới đăng ký được dùng thử ngần này ngày (KH §1.7). */
export const TRIAL_DAYS = 30;

/** Hết kỳ đã trả tiền vẫn đồng bộ được thêm ngần này ngày, có banner nhắc. */
export const GRACE_DAYS = 7;
