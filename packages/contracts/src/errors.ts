/**
 * Định dạng lỗi duy nhất của API — KH backend §3.1.
 *
 * Frontend quyết định làm gì dựa trên `code`, KHÔNG dựa trên `message`
 * (message là chữ cho người đọc, được phép đổi câu chữ bất cứ lúc nào).
 * Thêm mã mới: thêm vào `ERROR_CODES`, thêm HTTP status vào `ERROR_STATUS`,
 * ghi một dòng vào CHANGELOG.md. Bỏ mã cũ là thay đổi phá vỡ — không làm trong /v1.
 */

import { z } from 'zod';

export const ERROR_CODES = [
  'UNAUTHENTICATED',
  'NOT_A_MEMBER',
  'FORBIDDEN',
  'PHONE_NOT_VERIFIED',
  'LINK_REQUIRED',
  'PLAN_EXPIRED',
  'BRANCH_LIMIT',
  'VALIDATION_FAILED',
  'PARENT_MISSING',
  'ORDER_STATE_CHANGED',
  'RATE_LIMITED',
  'INTERNAL',
] as const;

export const ErrorCode = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ERROR_STATUS: Readonly<Record<ErrorCode, number>> = {
  UNAUTHENTICATED: 401,
  NOT_A_MEMBER: 403,
  FORBIDDEN: 403,
  PHONE_NOT_VERIFIED: 403,
  LINK_REQUIRED: 403,
  PLAN_EXPIRED: 402,
  BRANCH_LIMIT: 402,
  VALIDATION_FAILED: 422,
  PARENT_MISSING: 409,
  ORDER_STATE_CHANGED: 409,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

export const ErrorBody = z.object({
  error: z.object({
    code: ErrorCode,
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
    requestId: z.string().optional(),
  }),
});
export type ErrorBody = z.infer<typeof ErrorBody>;

/**
 * Hàng đợi đồng bộ có được thử lại thao tác này không.
 *
 * `PLAN_EXPIRED` trả `false` nhưng KHÔNG phải lỗi vĩnh viễn: hàng đợi phải dừng
 * cả lượt và giữ nguyên, không đốt lượt thử — trả tiền xong là đi tiếp.
 */
export const isRetryable = (code: ErrorCode): boolean =>
  code === 'PARENT_MISSING' || code === 'RATE_LIMITED' || code === 'INTERNAL';
