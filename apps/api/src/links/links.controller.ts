import {
  type LinkedBalance,
  type LinkedReceiptsQuery,
  type LinkedReceiptsResult,
  type LinkIdParams,
  type LinkInviteInput,
  type LinksDiscoverResult,
  type LinksList,
  type LinkSummary,
  routes,
} from '@mambo/contracts';
import { Body, Controller, Inject } from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user';
import { CurrentMembership } from '../auth/current-membership';
import { CurrentUser } from '../auth/current-user';
import type { MembershipContext } from '../auth/membership';
import { SUPABASE_USERS, type SupabaseUsers } from '../auth/supabase-users';
import { ApiException } from '../common/api-exception';
import { ContractParams, ContractQuery } from '../common/contract-query';
import { Endpoint } from '../common/endpoint';
import { RequestId } from '../common/request-id';
import { DATABASE, type Database } from '../db/database';
import { DomainEvents } from '../events/domain-events';
import { LinksService, verifiedPhone } from './links.service';

@Controller()
export class LinksController {
  private readonly db: Database;
  private readonly users: SupabaseUsers;
  private readonly events: DomainEvents;
  private readonly links: LinksService;

  constructor(
    @Inject(DATABASE) db: Database,
    @Inject(SUPABASE_USERS) users: SupabaseUsers,
    events: DomainEvents,
    links: LinksService,
  ) {
    this.db = db;
    this.users = users;
    this.events = events;
    this.links = links;
  }

  /**
   * KH §1.4 bước 3. Số điện thoại lấy từ Supabase Auth NGAY LÚC GỌI và phải có
   * `phone_confirmed_at` — không tin số nào client gửi lên. Không có bước này thì ai
   * cũng đăng ký bằng số người khác để xem công nợ của họ.
   */
  @Endpoint(routes.linksDiscover)
  async discover(
    @CurrentUser() user: AuthUser,
    @CurrentMembership() membership: MembershipContext,
  ): Promise<LinksDiscoverResult> {
    const phone = verifiedPhone(await this.users.fetch(user.token));
    if (!phone) {
      throw new ApiException('PHONE_NOT_VERIFIED', 'Cần xác thực số điện thoại Việt Nam bằng mã OTP trước');
    }

    const orgId = membership.organizationId;
    const result = await this.db.scoped({ userId: user.id, orgId }, async (tx) => {
      const rows = await tx.$queryRaw<{ created: number }[]>`select public.discover_links(${phone}) as created`;
      const pending = await tx.partnerLink.count({ where: { linkedOrgId: orgId, status: 'pending' } });
      return { created: Number(rows[0]?.created ?? 0), pending };
    });

    if (result.created > 0) this.events.emit('link.discovered', { linkedOrgId: orgId, created: result.created });
    return result;
  }

  @Endpoint(routes.linksList)
  async list(@CurrentUser() user: AuthUser, @CurrentMembership() membership: MembershipContext): Promise<LinksList> {
    return { links: await this.links.list(user, membership) };
  }

  @Endpoint(routes.linksInvite)
  invite(
    @CurrentUser() user: AuthUser,
    @CurrentMembership() membership: MembershipContext,
    @Body() input: LinkInviteInput,
    @RequestId() requestId: string,
  ): Promise<LinkSummary> {
    return this.links.invite(user, membership, input, requestId);
  }

  @Endpoint(routes.linksAccept)
  accept(
    @CurrentUser() user: AuthUser,
    @CurrentMembership() membership: MembershipContext,
    @ContractParams() params: LinkIdParams,
    @RequestId() requestId: string,
  ): Promise<LinkSummary> {
    return this.links.accept(user, membership, params.id, requestId);
  }

  @Endpoint(routes.linksRevoke)
  revoke(
    @CurrentUser() user: AuthUser,
    @CurrentMembership() membership: MembershipContext,
    @ContractParams() params: LinkIdParams,
    @RequestId() requestId: string,
  ): Promise<LinkSummary> {
    return this.links.revoke(user, membership, params.id, requestId);
  }

  @Endpoint(routes.linkedReceipts)
  receipts(
    @CurrentUser() user: AuthUser,
    @CurrentMembership() membership: MembershipContext,
    @ContractQuery() query: LinkedReceiptsQuery,
  ): Promise<LinkedReceiptsResult> {
    return this.links.receipts(user, membership, query);
  }

  @Endpoint(routes.linkedBalance)
  balance(@CurrentUser() user: AuthUser, @CurrentMembership() membership: MembershipContext): Promise<LinkedBalance> {
    return this.links.balance(user, membership);
  }
}
