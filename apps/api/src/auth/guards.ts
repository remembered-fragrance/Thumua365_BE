/**
 * Ba guard toàn cục, chạy đúng thứ tự đăng ký trong AppModule (sau throttler):
 *
 *   JwtAuthGuard → OrgContextGuard → PermissionGuard
 *
 * Cả ba đọc cấu hình từ dòng `routes` gắn qua `@Endpoint`. Handler không có
 * `@Endpoint` bị coi là cần đăng nhập — mặc định ĐÓNG, quên khai báo không thành
 * lỗ hổng.
 */

import { can, type RouteDef } from '@mambo/contracts';
import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiException } from '../common/api-exception';
import { ROUTE_KEY } from '../common/endpoint';
import type { ApiRequest } from '../common/request-context';
import { ENV, type Env } from '../config/env';
import { JWKS, type Jwks, verifySupabaseToken } from './auth-user';
import { MEMBERSHIP_LOOKUP, type MembershipLookup } from './membership';

const routeOf = (reflector: Reflector, ctx: ExecutionContext): RouteDef | undefined =>
  reflector.get<RouteDef | undefined>(ROUTE_KEY, ctx.getHandler());

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly reflector: Reflector;
  private readonly jwks: Jwks;
  private readonly env: Env;

  constructor(reflector: Reflector, @Inject(JWKS) jwks: Jwks, @Inject(ENV) env: Env) {
    this.reflector = reflector;
    this.jwks = jwks;
    this.env = env;
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (routeOf(this.reflector, ctx)?.auth === 'public') return true;

    const req = ctx.switchToHttp().getRequest<ApiRequest>();
    const header = req.header('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (token === '') throw new ApiException('UNAUTHENTICATED', 'Chưa đăng nhập');

    try {
      req.user = await verifySupabaseToken(token, this.jwks, this.env.SUPABASE_URL);
    } catch {
      // Không nói lý do cụ thể (hết hạn / sai chữ ký / sai issuer) ra ngoài.
      throw new ApiException('UNAUTHENTICATED', 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn');
    }
    return true;
  }
}

@Injectable()
export class OrgContextGuard implements CanActivate {
  private readonly reflector: Reflector;
  private readonly memberships: MembershipLookup;

  constructor(reflector: Reflector, @Inject(MEMBERSHIP_LOOKUP) memberships: MembershipLookup) {
    this.reflector = reflector;
    this.memberships = memberships;
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (routeOf(this.reflector, ctx)?.auth !== 'org') return true;

    const req = ctx.switchToHttp().getRequest<ApiRequest>();
    const orgId = req.header('x-organization-id') ?? '';
    if (!UUID.test(orgId)) {
      throw new ApiException('VALIDATION_FAILED', 'Thiếu hoặc sai header X-Organization-Id', {
        header: 'X-Organization-Id',
      });
    }
    // JwtAuthGuard chạy trước nên user luôn có ở đây.
    const userId = req.user?.id ?? '';
    const membership = await this.memberships.find(userId, orgId.toLowerCase());
    if (!membership) throw new ApiException('NOT_A_MEMBER', 'Bác không thuộc tổ chức này');

    req.membership = membership;
    return true;
  }
}

@Injectable()
export class PermissionGuard implements CanActivate {
  private readonly reflector: Reflector;

  constructor(reflector: Reflector) {
    this.reflector = reflector;
  }

  canActivate(ctx: ExecutionContext): boolean {
    const route = routeOf(this.reflector, ctx);
    if (route?.auth !== 'org' || !route.permission) return true;

    const membership = ctx.switchToHttp().getRequest<ApiRequest>().membership;
    if (!membership || !can(membership.orgType, membership.role, route.permission)) {
      throw new ApiException('FORBIDDEN', 'Không có quyền làm việc này', { permission: route.permission });
    }
    return true;
  }
}
