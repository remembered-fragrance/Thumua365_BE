import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { ApiRequest } from './request-context';

/** Mã request — ghi vào audit_log để nối nhật ký với log truy cập. */
export const RequestId = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string => ctx.switchToHttp().getRequest<ApiRequest>().requestId,
);
