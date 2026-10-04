/** Hình dạng một dòng trong danh bạ endpoint (`routes.ts`). */

import type { z } from 'zod';
import type { ErrorCode } from './errors.js';
import type { Permission } from './permissions.js';

/**
 * Ai được gọi:
 *   public — không cần đăng nhập
 *   user   — cần JWT của Supabase
 *   org    — cần JWT + header `X-Organization-Id` của tổ chức người đó là thành viên
 *   admin  — cần JWT của một quản trị viên (id nằm trong `ADMIN_USER_IDS` của API); không ai khác
 *            gọi được, kể cả chủ tổ chức (BE6)
 */
export type RouteAuth = 'public' | 'user' | 'org' | 'admin';

export interface RouteDef {
  readonly method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  readonly path: `/v1/${string}`;
  readonly summary: string;
  readonly auth: RouteAuth;
  /**
   * Chỉ với `auth: 'public'`: client gửi token (và tổ chức) NẾU đang đăng nhập; server dùng nếu xác
   * thực được, sai thì coi như ẩn danh (BE9 — đo lường). Route công khai khác KHÔNG gửi token.
   */
  readonly optionalAuth?: boolean;
  /** Chỉ có nghĩa khi `auth: 'org'`. */
  readonly permission?: Permission;
  /** Thân request (JSON). Server kiểm trước khi vào handler; sai → 422 `VALIDATION_FAILED`. */
  readonly body?: z.ZodType;
  /**
   * Thân request như tài liệu (openapi, mock) mô tả, khi `body` cố ý lỏng hơn — ví dụ
   * `/sync/push` chỉ kiểm vỏ ở cổng để lỗi của từng op được trả về theo op, không làm hỏng
   * cả lô. Không có thì tài liệu dùng `body`.
   */
  readonly docBody?: z.ZodType;
  /** Tham số query string. Server kiểm trước khi vào handler; sai hoặc thừa → 422 `VALIDATION_FAILED`. */
  readonly query?: z.ZodType;
  /**
   * Tham số trên đường dẫn — mỗi `:ten` trong `path` là một trường của schema này (test bắt
   * khớp). Server kiểm trước khi vào handler; sai → 422 `VALIDATION_FAILED`.
   */
  readonly params?: z.ZodType;
  readonly response: z.ZodType;
  /** Hạn mức riêng mỗi phút mỗi IP, chặt hơn mức chung — cho route dễ bị dò. */
  readonly rateLimitPerMinute?: number;
  /** Mã lỗi riêng của route này (ngoài các mã chung theo loại xác thực) — để frontend biết trước. */
  readonly errors?: readonly ErrorCode[];
}
