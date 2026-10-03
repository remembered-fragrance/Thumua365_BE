import { AdminActivatePlanInput, type AdminActivatePlanResult, type AdminDoneResult, AdminResetPasswordInput, routes } from '@mambo/contracts';
import { Body, Controller } from '@nestjs/common';
import type { z } from 'zod';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/current-user';
import { Endpoint } from '../common/endpoint';
import { AdminService } from './admin.service';

/** `/v1/admin/*` — route khai `auth: 'admin'`: PermissionGuard chỉ cho id trong ADMIN_USER_IDS. */
@Controller()
export class AdminController {
  private readonly admin: AdminService;

  constructor(admin: AdminService) {
    this.admin = admin;
  }

  @Endpoint(routes.adminActivatePlan)
  activatePlan(@CurrentUser() user: AuthUser, @Body() input: z.output<typeof AdminActivatePlanInput>): Promise<AdminActivatePlanResult> {
    return this.admin.activatePlan(user, input);
  }

  @Endpoint(routes.adminResetPassword)
  resetPassword(@CurrentUser() user: AuthUser, @Body() input: z.output<typeof AdminResetPasswordInput>): Promise<AdminDoneResult> {
    return this.admin.resetPassword(user, input);
  }
}
