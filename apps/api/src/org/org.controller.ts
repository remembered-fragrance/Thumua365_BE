import {
  type IdParams,
  type OrgBranch,
  OrgBranchCreateInput,
  type OrgBranchesList,
  OrgBranchPatch,
  type OrgMember,
  OrgMemberCreateInput,
  OrgMemberPatch,
  type OrgMembersList,
  OrgPatch,
  type OrgProfile,
  routes,
} from '@mambo/contracts';
import { Body, Controller } from '@nestjs/common';
import type { z } from 'zod';
import type { AuthUser } from '../auth/auth-user';
import { CurrentMembership } from '../auth/current-membership';
import { CurrentUser } from '../auth/current-user';
import type { MembershipContext } from '../auth/membership';
import { ContractParams } from '../common/contract-query';
import { Endpoint } from '../common/endpoint';
import { RequestId } from '../common/request-id';
import { BranchesService } from './branches.service';
import { MembersService } from './members.service';
import { OrganizationService } from './organization.service';

@Controller()
export class OrgController {
  private readonly members: MembersService;
  private readonly branches: BranchesService;
  private readonly organization: OrganizationService;

  constructor(members: MembersService, branches: BranchesService, organization: OrganizationService) {
    this.members = members;
    this.branches = branches;
    this.organization = organization;
  }

  @Endpoint(routes.orgUpdate)
  updateOrg(
    @CurrentUser() user: AuthUser,
    @CurrentMembership() m: MembershipContext,
    @Body() patch: z.output<typeof OrgPatch>,
    @RequestId() requestId: string,
  ): Promise<OrgProfile> {
    return this.organization.update(user, m, patch, requestId);
  }

  @Endpoint(routes.orgLeave)
  leave(@CurrentUser() user: AuthUser, @CurrentMembership() m: MembershipContext, @RequestId() requestId: string): Promise<OrgMember> {
    return this.members.leave(user, m, requestId);
  }

  @Endpoint(routes.orgMembersList)
  async listMembers(@CurrentUser() user: AuthUser, @CurrentMembership() m: MembershipContext): Promise<OrgMembersList> {
    return { members: await this.members.list(user, m) };
  }

  @Endpoint(routes.orgMembersCreate)
  createMember(
    @CurrentUser() user: AuthUser,
    @CurrentMembership() m: MembershipContext,
    @Body() input: z.output<typeof OrgMemberCreateInput>,
    @RequestId() requestId: string,
  ): Promise<OrgMember> {
    return this.members.create(user, m, input, requestId);
  }

  @Endpoint(routes.orgMemberUpdate)
  updateMember(
    @CurrentUser() user: AuthUser,
    @CurrentMembership() m: MembershipContext,
    @ContractParams() params: IdParams,
    @Body() patch: z.output<typeof OrgMemberPatch>,
    @RequestId() requestId: string,
  ): Promise<OrgMember> {
    return this.members.update(user, m, params.id, patch, requestId);
  }

  @Endpoint(routes.orgMemberRemove)
  removeMember(
    @CurrentUser() user: AuthUser,
    @CurrentMembership() m: MembershipContext,
    @ContractParams() params: IdParams,
    @RequestId() requestId: string,
  ): Promise<OrgMember> {
    return this.members.remove(user, m, params.id, requestId);
  }

  @Endpoint(routes.orgBranchesList)
  listBranches(@CurrentUser() user: AuthUser, @CurrentMembership() m: MembershipContext): Promise<OrgBranchesList> {
    return this.branches.list(user, m);
  }

  @Endpoint(routes.orgBranchesCreate)
  createBranch(
    @CurrentUser() user: AuthUser,
    @CurrentMembership() m: MembershipContext,
    @Body() input: z.output<typeof OrgBranchCreateInput>,
    @RequestId() requestId: string,
  ): Promise<OrgBranch> {
    return this.branches.create(user, m, input, requestId);
  }

  @Endpoint(routes.orgBranchUpdate)
  updateBranch(
    @CurrentUser() user: AuthUser,
    @CurrentMembership() m: MembershipContext,
    @ContractParams() params: IdParams,
    @Body() patch: z.output<typeof OrgBranchPatch>,
    @RequestId() requestId: string,
  ): Promise<OrgBranch> {
    return this.branches.update(user, m, params.id, patch, requestId);
  }
}
