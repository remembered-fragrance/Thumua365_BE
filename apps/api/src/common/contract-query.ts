import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { ApiRequest } from './request-context';

/**
 * Query string ĐÃ KIỂM bằng `route.query` của hợp đồng (ContractInterceptor) — số đã
 * ép kiểu, tham số lạ đã bị từ chối. Dùng thay `@Query()`, vốn trả chuỗi thô.
 */
export const ContractQuery = createParamDecorator((_: unknown, ctx: ExecutionContext): unknown => {
  const req = ctx.switchToHttp().getRequest<ApiRequest>();
  if (req.contractQuery === undefined) throw new Error('ContractQuery dùng trên route không khai báo query');
  return req.contractQuery;
});
