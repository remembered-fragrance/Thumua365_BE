/**
 * Đọc tài khoản từ Supabase Auth, thay mặt chính người dùng (token của họ +
 * publishable key) — không cần `service_role`.
 *
 * Gọi thêm một vòng mạng vì JWT không mang `phone_confirmed_at`, mà đó là điều
 * kiện để dò kết nối (KH §1.4). Lợi ích kèm theo: phiên đã bị thu hồi (đăng xuất
 * mọi thiết bị) bị phát hiện ngay dù JWT chưa hết hạn.
 */

import { z } from 'zod';
import { ApiException } from '../common/api-exception';

export const SupabaseAccount = z.object({
  id: z.string(),
  email: z.string().nullish(),
  phone: z.string().nullish(),
  phone_confirmed_at: z.string().nullish(),
  user_metadata: z.record(z.string(), z.unknown()).nullish(),
});
export type SupabaseAccount = z.infer<typeof SupabaseAccount>;

export interface SupabaseUsers {
  fetch(token: string): Promise<SupabaseAccount>;
}

export const SUPABASE_USERS = Symbol('SUPABASE_USERS');

export class SupabaseUsersHttp implements SupabaseUsers {
  private readonly url: string;
  private readonly publishableKey: string;

  constructor(supabaseUrl: string, publishableKey: string) {
    this.url = `${supabaseUrl}/auth/v1/user`;
    this.publishableKey = publishableKey;
  }

  async fetch(token: string): Promise<SupabaseAccount> {
    const res = await fetch(this.url, {
      headers: { apikey: this.publishableKey, authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5_000),
    });
    if (res.status === 401 || res.status === 403) {
      throw new ApiException('UNAUTHENTICATED', 'Phiên đăng nhập không còn hiệu lực');
    }
    if (!res.ok) throw new Error(`Supabase Auth trả ${res.status}`);
    return SupabaseAccount.parse(await res.json());
  }
}
