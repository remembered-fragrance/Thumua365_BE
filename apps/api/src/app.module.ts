import { type DynamicModule, Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { type Jwks, JWKS } from './auth/auth-user';
import { ClientIpThrottlerGuard } from './auth/client-ip-throttler.guard';
import { JwtAuthGuard, OrgContextGuard, PermissionGuard } from './auth/guards';
import { MEMBERSHIP_LOOKUP, type MembershipLookup } from './auth/membership';
import { SUPABASE_USERS, type SupabaseUsers } from './auth/supabase-users';
import { ContractInterceptor } from './common/contract.interceptor';
import { ENV, type Env } from './config/env';
import { HealthController } from './health/health.controller';
import { MeController } from './me/me.controller';

/** Những phụ thuộc chạm ra ngoài — main.ts nối bản thật, test nối bản giả. */
export interface AppDeps {
  readonly jwks: Jwks;
  readonly supabaseUsers: SupabaseUsers;
  readonly memberships: MembershipLookup;
}

@Module({})
export class AppModule {
  static forRoot(env: Env, deps: AppDeps): DynamicModule {
    return {
      module: AppModule,
      imports: [ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: env.RATE_LIMIT_PER_MINUTE }] })],
      controllers: [HealthController, MeController],
      providers: [
        { provide: ENV, useValue: env },
        { provide: JWKS, useValue: deps.jwks },
        { provide: SUPABASE_USERS, useValue: deps.supabaseUsers },
        { provide: MEMBERSHIP_LOOKUP, useValue: deps.memberships },
        // Thứ tự đăng ký = thứ tự chạy.
        { provide: APP_GUARD, useClass: ClientIpThrottlerGuard },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: OrgContextGuard },
        { provide: APP_GUARD, useClass: PermissionGuard },
        { provide: APP_INTERCEPTOR, useClass: ContractInterceptor },
      ],
    };
  }
}
