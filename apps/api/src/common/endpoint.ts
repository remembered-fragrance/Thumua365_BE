import type { RouteDef } from '@mambo/contracts';
import { Delete, Get, HttpCode, Patch, Post, SetMetadata, applyDecorators } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

export const ROUTE_KEY = Symbol('contract-route');

const METHOD = { GET: Get, POST: Post, PATCH: Patch, DELETE: Delete } as const;

/**
 * Gắn một handler vào đúng một dòng của `routes` trong `@mambo/contracts`:
 * đường dẫn, phương thức, loại xác thực, quyền, schema thân request, schema phản
 * hồi và hạn mức riêng đều lấy từ đó. Controller không tự gõ đường dẫn.
 *
 * Mọi phản hồi thành công là 200 (kể cả POST) — hợp đồng chỉ khai báo 200.
 *
 * Handler thiếu decorator này vẫn bị bắt đăng nhập (guard mặc định đóng).
 */
export const Endpoint = (route: RouteDef) =>
  applyDecorators(
    SetMetadata(ROUTE_KEY, route),
    METHOD[route.method](route.path),
    HttpCode(200),
    ...(route.rateLimitPerMinute ? [Throttle({ default: { limit: route.rateLimitPerMinute, ttl: 60_000 } })] : []),
  );
