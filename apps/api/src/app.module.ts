import { type DynamicModule, Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerModule } from '@nestjs/throttler';
import type { Logger } from 'winston';
import { AuthController } from './auth/auth.controller';
import { type Jwks, JWKS } from './auth/auth-user';
import { ClientIpThrottlerGuard } from './auth/client-ip-throttler.guard';
import { JwtAuthGuard, OrgContextGuard, PermissionGuard } from './auth/guards';
import { MEMBERSHIP_LOOKUP, type MembershipLookup } from './auth/membership';
import { SUPABASE_ADMIN, type SupabaseAdmin } from './auth/supabase-admin';
import { SUPABASE_USERS, type SupabaseUsers } from './auth/supabase-users';
import { ContractInterceptor } from './common/contract.interceptor';
import { ENV, type Env } from './config/env';
import { DATABASE, type Database, DatabaseShutdown } from './db/database';
import { DomainEvents, LOGGER } from './events/domain-events';
import { HealthController } from './health/health.controller';
import { LinksController } from './links/links.controller';
import { BootstrapService } from './me/bootstrap.service';
import { MeController } from './me/me.controller';

/** Những phụ thuộc chạm ra ngoài — main.ts nối bản thật, test nối bản giả (hoặc Postgres ở máy). */
export interface AppDeps {
  readonly jwks: Jwks;
  readonly supabaseUsers: SupabaseUsers;
  readonly supabaseAdmin: SupabaseAdmin;
  readonly memberships: MembershipLookup;
  readonly db: Database;
  readonly logger: Logger;
}

@Module({})
export class AppModule {
  static forRoot(env: Env, deps: AppDeps): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: env.RATE_LIMIT_PER_MINUTE }] }),
        EventEmitterModule.forRoot(),
      ],
      controllers: [HealthController, MeController, AuthController, LinksController],
      providers: [
        { provide: ENV, useValue: env },
        { provide: JWKS, useValue: deps.jwks },
        { provide: SUPABASE_USERS, useValue: deps.supabaseUsers },
        { provide: SUPABASE_ADMIN, useValue: deps.supabaseAdmin },
        { provide: MEMBERSHIP_LOOKUP, useValue: deps.memberships },
        { provide: DATABASE, useValue: deps.db },
        { provide: LOGGER, useValue: deps.logger },
        DatabaseShutdown,
        DomainEvents,
        BootstrapService,
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
