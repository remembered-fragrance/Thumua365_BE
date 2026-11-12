import {
  type AdminAccessLog,
  AdminFeatureInput,
  type AdminFeatures,
  type AdminFeedback,
  type AdminFeedbackQuery,
  type AdminOrganizationDetail,
  type AdminOrganizationParams,
  type AdminOrganizations,
  type AdminOrganizationsQuery,
  type AdminOverview,
  type AdminPromoCodes,
  AdminPromoCreateInput,
  type AdminPromoDeleteQuery,
  type AdminPromoParams,
  type AdminPromoRow,
  type AdminUsers,
  type AdminUsersQuery,
  routes,
} from '@mambo/contracts';
import { Body, Controller } from '@nestjs/common';
import type { z } from 'zod';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/current-user';
import { ContractParams, ContractQuery } from '../common/contract-query';
import { Endpoint } from '../common/endpoint';
import { AdminConsoleService } from './admin-console.service';

/** Trang quản trị đầy đủ (0.32.0) — `auth: 'admin'`: PermissionGuard chỉ cho id trong ADMIN_USER_IDS. */
@Controller()
export class AdminConsoleController {
  private readonly console: AdminConsoleService;

  constructor(console: AdminConsoleService) {
    this.console = console;
  }

  @Endpoint(routes.adminOverview)
  overview(): Promise<AdminOverview> {
    return this.console.overview();
  }

  @Endpoint(routes.adminOrganizations)
  organizations(@CurrentUser() user: AuthUser, @ContractQuery() query: AdminOrganizationsQuery): Promise<AdminOrganizations> {
    return this.console.organizations(user, query);
  }

  @Endpoint(routes.adminOrganization)
  organization(@CurrentUser() user: AuthUser, @ContractParams() params: AdminOrganizationParams): Promise<AdminOrganizationDetail> {
    return this.console.organization(user, params.id);
  }

  @Endpoint(routes.adminOrganizationFeature)
  setFeature(
    @CurrentUser() user: AuthUser,
    @ContractParams() params: AdminOrganizationParams,
    @Body() input: z.output<typeof AdminFeatureInput>,
  ): Promise<AdminFeatures> {
    return this.console.setFeature(user, params.id, input);
  }

  @Endpoint(routes.adminPromoCodes)
  promoCodes(): Promise<AdminPromoCodes> {
    return this.console.promoCodes();
  }

  @Endpoint(routes.adminPromoCreate)
  createPromo(@CurrentUser() user: AuthUser, @Body() input: z.output<typeof AdminPromoCreateInput>): Promise<AdminPromoRow> {
    return this.console.createPromo(user, input);
  }

  @Endpoint(routes.adminPromoDelete)
  deletePromo(
    @CurrentUser() user: AuthUser,
    @ContractParams() params: AdminPromoParams,
    @ContractQuery() query: AdminPromoDeleteQuery,
  ): Promise<AdminPromoCodes> {
    return this.console.deletePromo(user, params.code, query);
  }

  @Endpoint(routes.adminUsers)
  users(@CurrentUser() user: AuthUser, @ContractQuery() query: AdminUsersQuery): Promise<AdminUsers> {
    return this.console.users(user, query);
  }

  @Endpoint(routes.adminFeedback)
  feedback(@CurrentUser() user: AuthUser, @ContractQuery() query: AdminFeedbackQuery): Promise<AdminFeedback> {
    return this.console.feedback(user, query);
  }

  @Endpoint(routes.adminAccessLog)
  accessLog(): Promise<AdminAccessLog> {
    return this.console.accessLog();
  }
}
