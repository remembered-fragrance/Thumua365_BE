import { type Me, type MeBootstrapInput, routes } from '@mambo/contracts';
import { Body, Controller, Inject } from '@nestjs/common';
import type { z } from 'zod';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/current-user';
import { isInternalEmail } from '../auth/login-email';
import { MEMBERSHIP_LOOKUP, type MembershipLookup } from '../auth/membership';
import { SUPABASE_USERS, type SupabaseAccount, type SupabaseUsers } from '../auth/supabase-users';
import { Endpoint } from '../common/endpoint';
import { RequestId } from '../common/request-id';
import { BootstrapService } from './bootstrap.service';

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);

/** Supabase lưu số không có dấu `+`; hợp đồng dùng E.164 có dấu `+`. */
const e164 = (phone: string | null | undefined): string | null =>
  phone ? `+${phone.replace(/^\+/, '')}` : null;

/** Email nội bộ (người chỉ có SĐT) là khoá đăng nhập — không trả ra như thể họ có email. */
export const meUserFrom = (account: SupabaseAccount): Me['user'] => {
  const email = text(account.email);
  return {
    id: account.id,
    name: text(account.user_metadata?.name),
    phone: e164(account.phone),
    email: email && !isInternalEmail(email) ? email : null,
    phoneVerified: Boolean(account.phone_confirmed_at),
  };
};

@Controller()
export class MeController {
  private readonly users: SupabaseUsers;
  private readonly memberships: MembershipLookup;
  private readonly bootstrapper: BootstrapService;

  constructor(
    @Inject(SUPABASE_USERS) users: SupabaseUsers,
    @Inject(MEMBERSHIP_LOOKUP) memberships: MembershipLookup,
    bootstrapper: BootstrapService,
  ) {
    this.users = users;
    this.memberships = memberships;
    this.bootstrapper = bootstrapper;
  }

  @Endpoint(routes.me)
  async me(@CurrentUser() user: AuthUser): Promise<Me> {
    return this.build(user, await this.users.fetch(user.token));
  }

  @Endpoint(routes.meBootstrap)
  async bootstrap(
    @CurrentUser() user: AuthUser,
    @Body() input: z.output<typeof MeBootstrapInput>,
    @RequestId() requestId: string,
  ): Promise<Me> {
    // Hỏi Supabase TRƯỚC khi ghi: phiên bị thu hồi thì dừng ở đây (401), và số điện
    // thoại của hồ sơ lấy từ chính tài khoản.
    const account = await this.users.fetch(user.token);
    await this.bootstrapper.run(user, account, input, requestId);
    return this.build(user, account);
  }

  private async build(user: AuthUser, account: SupabaseAccount): Promise<Me> {
    const [memberships, pendingLinks] = await Promise.all([
      this.memberships.listForUser(user.id),
      this.memberships.pendingLinks(user.id),
    ]);
    return { user: meUserFrom(account), memberships, pendingLinks };
  }
}
