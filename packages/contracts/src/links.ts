/**
 * Kết nối giữa tổ chức — KH backend §1.4.
 *
 * `POST /v1/links/discover`: tổ chức đang làm việc (header `X-Organization-Id`) dò
 * những sổ có đối tác mang số điện thoại ĐÃ XÁC THỰC OTP của người gọi, và tạo lời
 * mời `pending`. Chưa xác thực → `PHONE_NOT_VERIFIED`. Lời mời chưa cho xem gì —
 * phải đồng ý (BE4).
 */

import { z } from 'zod';

export const LinksDiscoverResult = z.object({
  /** Số lời mời mới tạo ở lần gọi này. */
  created: z.number().int().nonnegative(),
  /** Tổng lời mời đang chờ tổ chức này đồng ý. */
  pending: z.number().int().nonnegative(),
});
export type LinksDiscoverResult = z.infer<typeof LinksDiscoverResult>;
