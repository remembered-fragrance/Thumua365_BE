/**
 * Góp ý + chấm sao trong app (0.25.0) — `POST /v1/feedback`. Người đã đăng nhập gửi cho tổ chức đang
 * làm việc; máy chủ gắn người và tổ chức từ phiên, không nhận từ app. Chỉ quản trị đọc lại.
 */

import { z } from 'zod';

export const FEEDBACK_COMMENT_MAX = 1000;

export const FeedbackInput = z.strictObject({
  rating: z.number().int().min(1, 'Chọn số sao').max(5),
  /** Chuỗi rỗng sau khi trim coi như bỏ trống (null). */
  comment: z
    .string()
    .trim()
    .max(FEEDBACK_COMMENT_MAX, `Tối đa ${FEEDBACK_COMMENT_MAX} ký tự`)
    .nullish()
    .transform((v) => (v ? v : null)),
  platform: z.enum(['web', 'pwa', 'twa']),
  appVersion: z.string().max(32).optional(),
});
export type FeedbackInput = z.input<typeof FeedbackInput>;

export const FeedbackResult = z.object({ ok: z.literal(true) });
export type FeedbackResult = z.infer<typeof FeedbackResult>;
