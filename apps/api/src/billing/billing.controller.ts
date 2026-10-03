import {
  type BankWebhookResult,
  PaymentIntentCreateInput,
  type PaymentIntentsList,
  type PaymentIntentView,
  routes,
  type SubscriptionView,
} from '@mambo/contracts';
import { Body, Controller, Headers } from '@nestjs/common';
import type { z } from 'zod';
import type { AuthUser } from '../auth/auth-user';
import { CurrentMembership } from '../auth/current-membership';
import { CurrentUser } from '../auth/current-user';
import type { MembershipContext } from '../auth/membership';
import { Endpoint } from '../common/endpoint';
import { RequestId } from '../common/request-id';
import { BankWebhookService, tokenFrom } from './bank-webhook.service';
import { BillingService } from './billing.service';

@Controller()
export class BillingController {
  private readonly billing: BillingService;
  private readonly webhook: BankWebhookService;

  constructor(billing: BillingService, webhook: BankWebhookService) {
    this.billing = billing;
    this.webhook = webhook;
  }

  @Endpoint(routes.meSubscription)
  subscription(@CurrentUser() user: AuthUser, @CurrentMembership() m: MembershipContext): Promise<SubscriptionView> {
    return this.billing.subscription(user, m);
  }

  @Endpoint(routes.billingIntentsList)
  async intents(@CurrentUser() user: AuthUser, @CurrentMembership() m: MembershipContext): Promise<PaymentIntentsList> {
    return { intents: await this.billing.intents(user, m) };
  }

  @Endpoint(routes.billingIntentsCreate)
  createIntent(
    @CurrentUser() user: AuthUser,
    @CurrentMembership() m: MembershipContext,
    @Body() input: z.output<typeof PaymentIntentCreateInput>,
  ): Promise<PaymentIntentView> {
    return this.billing.createIntent(user, m, input);
  }

  @Endpoint(routes.webhooksBank)
  bank(
    @Headers('secure-token') secureToken: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
    @RequestId() requestId: string,
  ): Promise<BankWebhookResult> {
    return this.webhook.handle(tokenFrom(secureToken, authorization), body, requestId);
  }
}
