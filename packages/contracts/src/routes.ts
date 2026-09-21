/**
 * Danh bạ endpoint — nguồn duy nhất cho ba nơi:
 *   - NestJS: controller lấy `path` từ đây; interceptor kiểm phản hồi bằng `response`
 *   - SDK: `@mambo/sdk` gọi theo đúng `method` + `path` và kiểm lại phản hồi
 *   - OpenAPI: `openapi.json` sinh từ đây (`npm run openapi`)
 *
 * Thêm endpoint = thêm một dòng ở đây trước, rồi mới viết controller.
 */

import type { z } from 'zod';
import { Health } from './health.js';
import { Me } from './me.js';
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
  readonly response: z.ZodType;
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
} as const satisfies Record<string, RouteDef>;

export type RouteName = keyof typeof routes;
export type RouteResponse<N extends RouteName> = z.infer<(typeof routes)[N]['response']>;
