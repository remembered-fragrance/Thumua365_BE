import {
  type NotificationsQuery,
  type NotificationsReadInput,
  type NotificationsReadResult,
  type NotificationsResult,
  routes,
} from '@mambo/contracts';
import { Body, Controller } from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user';
import { CurrentMembership } from '../auth/current-membership';
import { CurrentUser } from '../auth/current-user';
import type { MembershipContext } from '../auth/membership';
import { ContractQuery } from '../common/contract-query';
import { Endpoint } from '../common/endpoint';
import { NotificationsService } from './notifications.service';

@Controller()
export class NotificationsController {
  private readonly notifications: NotificationsService;

  constructor(notifications: NotificationsService) {
    this.notifications = notifications;
  }

  @Endpoint(routes.notificationsList)
  list(
    @CurrentUser() user: AuthUser,
    @CurrentMembership() membership: MembershipContext,
    @ContractQuery() query: NotificationsQuery,
  ): Promise<NotificationsResult> {
    return this.notifications.list(user, membership, query);
  }

  @Endpoint(routes.notificationsRead)
  read(
    @CurrentUser() user: AuthUser,
    @CurrentMembership() membership: MembershipContext,
    @Body() input: NotificationsReadInput,
  ): Promise<NotificationsReadResult> {
    return this.notifications.read(user, membership, input.ids);
  }
}
