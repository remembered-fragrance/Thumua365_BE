import { normalizePhone } from '@mambo/core/identifier';
import { type LinksDiscoverResult, routes } from '@mambo/contracts';
import { Controller, Inject } from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user';
import { CurrentMembership } from '../auth/current-membership';
import { CurrentUser } from '../auth/current-user';
import type { MembershipContext } from '../auth/membership';
import { SUPABASE_USERS, type SupabaseUsers } from '../auth/supabase-users';
import { ApiException } from '../common/api-exception';
import { Endpoint } from '../common/endpoint';
import { DATABASE, type Database } from '../db/database';
import { DomainEvents } from '../events/domain-events';

@Controller()
export class LinksController {
  private readonly db: Database;
  private readonly users: SupabaseUsers;
  private readonly events: DomainEvents;

  constructor(@Inject(DATABASE) db: Database, @Inject(SUPABASE_USERS) users: SupabaseUsers, events: DomainEvents) {
    this.db = db;
    this.users = users;
    this.events = events;
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
    const account = await this.users.fetch(user.token);
    const phone = account.phone_confirmed_at && account.phone ? normalizePhone(account.phone) : '';
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
}
