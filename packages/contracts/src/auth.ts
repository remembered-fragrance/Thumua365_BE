/**
 * `POST /v1/auth/resolve-identifier` — thay RPC `resolve_identifier` cũ.
 *
 * Người dùng gõ MỘT ô (tên tài khoản / số điện thoại / email). API trả email để
 * app gọi `signInWithPassword`. API LUÔN trả một email hợp lệ về hình thức, kể cả
 * khi không có tài khoản nào — app LUÔN báo cùng một câu "Tài khoản hoặc mật khẩu
 * không đúng". Nhờ vậy endpoint này không thành công cụ dò xem ai có tài khoản.
 */

import { z } from 'zod';

export const ResolveIdentifierInput = z.strictObject({
  identifier: z.string().trim().min(1).max(200),
});
export type ResolveIdentifierInput = z.input<typeof ResolveIdentifierInput>;

export const ResolveIdentifierResult = z.object({
  email: z.string(),
});
export type ResolveIdentifierResult = z.infer<typeof ResolveIdentifierResult>;
