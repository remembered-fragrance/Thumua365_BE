import { routes, type SyncPullQuery, type SyncPullResult, type SyncPushInput, type SyncPushResult } from '@mambo/contracts';
import { Body, Controller } from '@nestjs/common';
import type { z } from 'zod';
import type { AuthUser } from '../auth/auth-user';
import { CurrentMembership } from '../auth/current-membership';
import { CurrentUser } from '../auth/current-user';
import type { MembershipContext } from '../auth/membership';
import { ContractQuery } from '../common/contract-query';
import { Endpoint } from '../common/endpoint';
import { RequestId } from '../common/request-id';
import { SyncPullService } from './sync-pull.service';
import { SyncPushService } from './sync-push.service';

/** Sổ offline của vựa và doanh nghiệp — KH backend §4. Nông dân bị guard chặn (`book:sync`). */
@Controller()
export class SyncController {
  private readonly pusher: SyncPushService;
  private readonly puller: SyncPullService;

  constructor(pusher: SyncPushService, puller: SyncPullService) {
    this.pusher = pusher;
    this.puller = puller;
  }

  @Endpoint(routes.syncPush)
  push(
    @CurrentUser() user: AuthUser,
    @CurrentMembership() membership: MembershipContext,
    @Body() input: z.output<typeof SyncPushInput>,
    @RequestId() requestId: string,
  ): Promise<SyncPushResult> {
    return this.pusher.push(user, membership, input, requestId);
  }

  @Endpoint(routes.syncPull)
  pull(
    @CurrentUser() user: AuthUser,
    @CurrentMembership() membership: MembershipContext,
    @ContractQuery() query: SyncPullQuery,
  ): Promise<SyncPullResult> {
    return this.puller.pull(user, membership, query);
  }
}
