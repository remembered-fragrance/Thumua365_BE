import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { ApiRequest } from '../common/request-context';
import type { AuthUser } from './auth-user';

/** Người gọi đã qua JwtAuthGuard. Chỉ dùng trên route `auth: 'user'` hoặc `'org'`. */
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  const user = ctx.switchToHttp().getRequest<ApiRequest>().user;
  // Guard đã chặn trước; tới đây mà không có user là lỗi cấu hình route.
  if (!user) throw new Error('CurrentUser dùng trên route không yêu cầu đăng nhập');
  return user;
});
