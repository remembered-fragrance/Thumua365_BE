import { type DynamicModule, Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerModule } from '@nestjs/throttler';
import type { Logger } from 'winston';
import { AccountController } from './account/account.controller';
import { AccountDeletionService } from './account/account-deletion.service';
import { ProfileService } from './account/profile.service';
import { AdminController } from './admin/admin.controller';
import { AdminService } from './admin/admin.service';
import { AttachmentsController } from './attachments/attachments.controller';
import { AttachmentsService } from './attachments/attachments.service';
import { AuthController } from './auth/auth.controller';
import { BankWebhookService } from './billing/bank-webhook.service';
import { BillingController } from './billing/billing.controller';
import { BillingService } from './billing/billing.service';
import { type Jwks, JWKS } from './auth/auth-user';
import { ClientIpThrottlerGuard } from './auth/client-ip-throttler.guard';
import { JwtAuthGuard, OrgContextGuard, PermissionGuard } from './auth/guards';
import { MEMBERSHIP_LOOKUP, type MembershipLookup } from './auth/membership';
import { SUPABASE_ADMIN, type SupabaseAdmin } from './auth/supabase-admin';
import { SUPABASE_USERS, type SupabaseUsers } from './auth/supabase-users';
import { ContractInterceptor } from './common/contract.interceptor';
import { ENV, type Env } from './config/env';
import { DATABASE, type Database, DatabaseShutdown } from './db/database';
import { PRIVILEGED_DATABASE, type PrivilegedDatabase } from './db/privileged-database';
import { STORAGE_ADMIN, type StorageAdmin } from './storage/storage-admin';
import { DomainEvents, LOGGER } from './events/domain-events';
import { HealthController } from './health/health.controller';
import { LinksController } from './links/links.controller';
import { LinksService } from './links/links.service';
import { BootstrapService } from './me/bootstrap.service';
import { MeController } from './me/me.controller';
import { NotificationsController } from './notifications/notifications.controller';
import { NotificationsListener } from './notifications/notifications.listener';
import { NotificationsService } from './notifications/notifications.service';
import { OrdersController } from './orders/orders.controller';
import { OrdersService } from './orders/orders.service';
import { BranchesService } from './org/branches.service';
import { MembersService } from './org/members.service';
import { OrgController } from './org/org.controller';
import { ReportsController } from './reports/reports.controller';
import { ReportsService } from './reports/reports.service';
import { SyncController } from './sync/sync.controller';
import { SyncPullService } from './sync/sync-pull.service';
import { SyncPushService } from './sync/sync-push.service';

/** Những phụ thuộc chạm ra ngoài — main.ts nối bản thật, test nối bản giả (hoặc Postgres ở máy). */
export interface AppDeps {
  readonly jwks: Jwks;
  readonly supabaseUsers: SupabaseUsers;
  readonly supabaseAdmin: SupabaseAdmin;
  readonly memberships: MembershipLookup;
  readonly db: Database;
  /** null khi PRIVILEGED_DATABASE_URL trống — chỉ webhook, quản trị, xoá tài khoản cần. */
  readonly privilegedDb: PrivilegedDatabase | null;
  readonly storage: StorageAdmin;
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
      controllers: [
        HealthController,
        MeController,
        AuthController,
        LinksController,
        OrdersController,
        NotificationsController,
        OrgController,
        ReportsController,
        AccountController,
        BillingController,
        AdminController,
        AttachmentsController,
        SyncController,
      ],
      providers: [
        { provide: ENV, useValue: env },
        { provide: JWKS, useValue: deps.jwks },
        { provide: SUPABASE_USERS, useValue: deps.supabaseUsers },
        { provide: SUPABASE_ADMIN, useValue: deps.supabaseAdmin },
        { provide: MEMBERSHIP_LOOKUP, useValue: deps.memberships },
        { provide: DATABASE, useValue: deps.db },
        { provide: PRIVILEGED_DATABASE, useValue: deps.privilegedDb },
        { provide: STORAGE_ADMIN, useValue: deps.storage },
        { provide: LOGGER, useValue: deps.logger },
        DatabaseShutdown,
        DomainEvents,
        BootstrapService,
        LinksService,
        OrdersService,
        NotificationsService,
        NotificationsListener,
        MembersService,
        BranchesService,
        ReportsService,
        ProfileService,
        AccountDeletionService,
        BillingService,
        BankWebhookService,
        AdminService,
        AttachmentsService,
        SyncPushService,
        SyncPullService,
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
