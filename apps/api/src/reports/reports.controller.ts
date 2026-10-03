import { type ReportSummary, type ReportSummaryQuery, routes } from '@mambo/contracts';
import { Controller } from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user';
import { CurrentMembership } from '../auth/current-membership';
import { CurrentUser } from '../auth/current-user';
import type { MembershipContext } from '../auth/membership';
import { ContractQuery } from '../common/contract-query';
import { Endpoint } from '../common/endpoint';
import { ReportsService } from './reports.service';

@Controller()
export class ReportsController {
  private readonly reports: ReportsService;

  constructor(reports: ReportsService) {
    this.reports = reports;
  }

  @Endpoint(routes.reportsSummary)
  summary(
    @CurrentUser() user: AuthUser,
    @CurrentMembership() m: MembershipContext,
    @ContractQuery() query: ReportSummaryQuery,
  ): Promise<ReportSummary> {
    return this.reports.summary(user, m, query);
  }
}
