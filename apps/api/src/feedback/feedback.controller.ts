import { FeedbackInput, type FeedbackResult, routes } from '@mambo/contracts';
import { Body, Controller } from '@nestjs/common';
import type { z } from 'zod';
import type { AuthUser } from '../auth/auth-user';
import { CurrentMembership } from '../auth/current-membership';
import { CurrentUser } from '../auth/current-user';
import type { MembershipContext } from '../auth/membership';
import { Endpoint } from '../common/endpoint';
import { FeedbackService } from './feedback.service';

@Controller()
export class FeedbackController {
  private readonly feedback: FeedbackService;

  constructor(feedback: FeedbackService) {
    this.feedback = feedback;
  }

  @Endpoint(routes.feedbackCreate)
  create(
    @CurrentUser() user: AuthUser,
    @CurrentMembership() m: MembershipContext,
    @Body() input: z.output<typeof FeedbackInput>,
  ): Promise<FeedbackResult> {
    return this.feedback.create(user, m, input);
  }
}
