import { type AccountDeleteResult, type MeProfile, MeProfilePatch, type ReferralClaimInput, type ReferralClaimResult, routes } from '@mambo/contracts';
import { Body, Controller } from '@nestjs/common';
import type { z } from 'zod';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/current-user';
import { Endpoint } from '../common/endpoint';
import { RequestId } from '../common/request-id';
import { AccountDeletionService } from './account-deletion.service';
import { ProfileService } from './profile.service';

@Controller()
export class AccountController {
  private readonly profiles: ProfileService;
  private readonly deletion: AccountDeletionService;

  constructor(profiles: ProfileService, deletion: AccountDeletionService) {
    this.profiles = profiles;
    this.deletion = deletion;
  }

  @Endpoint(routes.meProfile)
  profile(@CurrentUser() user: AuthUser): Promise<MeProfile> {
    return this.profiles.get(user);
  }

  @Endpoint(routes.meProfileUpdate)
  updateProfile(@CurrentUser() user: AuthUser, @Body() patch: z.output<typeof MeProfilePatch>): Promise<MeProfile> {
    return this.profiles.update(user, patch);
  }

  @Endpoint(routes.referralsClaim)
  claimReferral(@CurrentUser() user: AuthUser, @Body() input: ReferralClaimInput): Promise<ReferralClaimResult> {
    return this.profiles.claimReferral(user, input.code);
  }

  @Endpoint(routes.meDelete)
  deleteMe(@CurrentUser() user: AuthUser, @RequestId() requestId: string): Promise<AccountDeleteResult> {
    return this.deletion.delete(user, requestId);
  }
}
