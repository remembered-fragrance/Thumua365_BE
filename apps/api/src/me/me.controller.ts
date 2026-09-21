import { type Me, routes } from '@mambo/contracts';
import { Controller, Inject } from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/current-user';
import { MEMBERSHIP_LOOKUP, type MembershipLookup } from '../auth/membership';
import { SUPABASE_USERS, type SupabaseAccount, type SupabaseUsers } from '../auth/supabase-users';
import { Endpoint } from '../common/endpoint';

/**
 * Email nội bộ cho người chỉ đăng ký bằng số điện thoại (`84912…@id.thumua365.vn`,
 * xem `data/auth.ts` của frontend). Đó là khoá đăng nhập, không phải email thật —
 * không trả ra như thể người dùng có email.
 */
const INTERNAL_EMAIL_DOMAIN = '@id.thumua365.vn';

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);

/** Supabase lưu số không có dấu `+`; hợp đồng dùng E.164 có dấu `+`. */
const e164 = (phone: string | null | undefined): string | null =>
  phone ? `+${phone.replace(/^\+/, '')}` : null;

export const meUserFrom = (account: SupabaseAccount): Me['user'] => {
  const email = text(account.email);
  return {
    id: account.id,
    name: text(account.user_metadata?.name),
    phone: e164(account.phone),
    email: email && !email.endsWith(INTERNAL_EMAIL_DOMAIN) ? email : null,
    phoneVerified: Boolean(account.phone_confirmed_at),
  };
};

@Controller()
export class MeController {
  private readonly users: SupabaseUsers;
  private readonly memberships: MembershipLookup;

  constructor(@Inject(SUPABASE_USERS) users: SupabaseUsers, @Inject(MEMBERSHIP_LOOKUP) memberships: MembershipLookup) {
    this.users = users;
    this.memberships = memberships;
  }

  @Endpoint(routes.me)
  async me(@CurrentUser() user: AuthUser): Promise<Me> {
    const [account, memberships] = await Promise.all([
      this.users.fetch(user.token),
      this.memberships.listForUser(user.id),
    ]);
    return {
      user: meUserFrom(account),
      memberships,
      // Lời mời kết nối có từ BE4 (partner_links). Tới đó luôn 0.
      pendingLinks: 0,
    };
  }
}
