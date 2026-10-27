import { type AuditQuery, type AuditResult, routes } from '@mambo/contracts';
import { Controller } from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user';
import { CurrentMembership } from '../auth/current-membership';
import { CurrentUser } from '../auth/current-user';
import type { MembershipContext } from '../auth/membership';
import { ContractQuery } from '../common/contract-query';
import { Endpoint } from '../common/endpoint';
import { AuditService } from './audit.service';

@Controller()
export class AuditController {
  private readonly audit: AuditService;

  constructor(audit: AuditService) {
    this.audit = audit;
  }

  @Endpoint(routes.auditList)
  list(
    @CurrentUser() user: AuthUser,
    @CurrentMembership() membership: MembershipContext,
    @ContractQuery() query: AuditQuery,
  ): Promise<AuditResult> {
    return this.audit.list(user, membership, query);
  }
}
