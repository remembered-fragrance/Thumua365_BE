import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { ApiRequest } from '../common/request-context';
import type { MembershipContext } from './membership';

/** Tổ chức đang làm việc, đã qua OrgContextGuard. Chỉ dùng trên route `auth: 'org'`. */
export const CurrentMembership = createParamDecorator((_: unknown, ctx: ExecutionContext): MembershipContext => {
  const membership = ctx.switchToHttp().getRequest<ApiRequest>().membership;
  if (!membership) throw new Error('CurrentMembership dùng trên route không phải auth: org');
  return membership;
});
