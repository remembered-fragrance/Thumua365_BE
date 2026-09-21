import type { RouteDef } from '@mambo/contracts';
import { Delete, Get, Patch, Post, SetMetadata, applyDecorators } from '@nestjs/common';

export const ROUTE_KEY = Symbol('contract-route');

const METHOD = { GET: Get, POST: Post, PATCH: Patch, DELETE: Delete } as const;

/**
 * Gắn một handler vào đúng một dòng của `routes` trong `@mambo/contracts`:
 * đường dẫn, phương thức, loại xác thực, quyền và schema phản hồi đều lấy từ đó.
 * Controller không tự gõ đường dẫn.
 *
 * Handler thiếu decorator này vẫn bị bắt đăng nhập (guard mặc định đóng).
 */
export const Endpoint = (route: RouteDef) =>
  applyDecorators(SetMetadata(ROUTE_KEY, route), METHOD[route.method](route.path));
