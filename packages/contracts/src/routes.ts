/**
 * Danh bạ endpoint — nguồn duy nhất cho ba nơi:
 *   - NestJS: controller lấy `path` từ đây; interceptor kiểm phản hồi bằng `response`
 *   - SDK: `@mambo/sdk` gọi theo đúng `method` + `path` và kiểm lại phản hồi
 *   - OpenAPI: `openapi.json` sinh từ đây (`npm run openapi`)
 *
 * Thêm endpoint = thêm một dòng ở đây trước, rồi mới viết controller.
 */

import type { z } from 'zod';
import { ResolveIdentifierInput, ResolveIdentifierResult } from './auth.js';
import type { ErrorCode } from './errors.js';
import { Health } from './health.js';
import { LinksDiscoverResult } from './links.js';
import { Me, MeBootstrapInput } from './me.js';
import type { Permission } from './permissions.js';

/**
 * Ai được gọi:
 *   public — không cần đăng nhập
 *   user   — cần JWT của Supabase
 *   org    — cần JWT + header `X-Organization-Id` của tổ chức người đó là thành viên
 */
export type RouteAuth = 'public' | 'user' | 'org';

export interface RouteDef {
  readonly method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  readonly path: `/v1/${string}`;
  readonly summary: string;
  readonly auth: RouteAuth;
  /** Chỉ có nghĩa khi `auth: 'org'`. */
  readonly permission?: Permission;
  /** Thân request (JSON). Server kiểm trước khi vào handler; sai → 422 `VALIDATION_FAILED`. */
  readonly body?: z.ZodType;
  readonly response: z.ZodType;
  /** Hạn mức riêng mỗi phút mỗi IP, chặt hơn mức chung — cho route dễ bị dò. */
  readonly rateLimitPerMinute?: number;
  /** Mã lỗi riêng của route này (ngoài các mã chung theo loại xác thực) — để frontend biết trước. */
  readonly errors?: readonly ErrorCode[];
}

export const routes = {
  health: {
    method: 'GET',
    path: '/v1/health',
    summary: 'Trạng thái API',
    auth: 'public',
    response: Health,
  },
  me: {
    method: 'GET',
    path: '/v1/me',
    summary: 'Người đang đăng nhập, các tổ chức và quyền trong từng tổ chức',
    auth: 'user',
    response: Me,
  },
  meBootstrap: {
    method: 'POST',
    path: '/v1/me/bootstrap',
    summary: 'Sau khi đăng ký: tạo hồ sơ, tổ chức, vai trò chủ và gói dùng thử. Gọi lại không tạo thêm',
    auth: 'user',
    body: MeBootstrapInput,
    response: Me,
  },
  resolveIdentifier: {
    method: 'POST',
    path: '/v1/auth/resolve-identifier',
    summary: 'Tên tài khoản / SĐT / email → email để đăng nhập. Luôn trả một email',
    auth: 'public',
    body: ResolveIdentifierInput,
    response: ResolveIdentifierResult,
    rateLimitPerMinute: 10,
  },
  linksDiscover: {
    method: 'POST',
    path: '/v1/links/discover',
    summary: 'Dò các sổ có đối tác mang số điện thoại đã xác thực của người gọi, tạo lời mời chờ đồng ý',
    auth: 'org',
    permission: 'linked:read',
    response: LinksDiscoverResult,
    errors: ['PHONE_NOT_VERIFIED'],
  },
} as const satisfies Record<string, RouteDef>;

export type RouteName = keyof typeof routes;
export type RouteResponse<N extends RouteName> = z.infer<(typeof routes)[N]['response']>;

/** Tên các route có thân request. */
export type RouteWithBody = {
  [N in RouteName]: (typeof routes)[N] extends { body: z.ZodType } ? N : never;
}[RouteName];

/** Thân request mà client gửi (trước khi server chuẩn hoá: trim, chữ thường…). */
export type RouteBody<N extends RouteWithBody> = (typeof routes)[N] extends { body: infer B extends z.ZodType }
  ? z.input<B>
  : never;
