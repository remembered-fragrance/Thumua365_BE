/**
 * Auth Admin API của Supabase — bằng khoá SECRET, nên chỉ dùng cho đúng việc cần
 * nhìn tài khoản của NGƯỜI KHÁC: đổi id người dùng thành email đăng nhập
 * (/v1/auth/resolve-identifier). Việc của chính người gọi đi qua `SupabaseUsers`
 * (token của họ), không qua đây.
 */

import { z } from 'zod';

const AdminUser = z.object({ id: z.string(), email: z.string().nullish() });

export interface SupabaseAdmin {
  /** Email đăng nhập của tài khoản; null nếu không có tài khoản đó. */
  loginEmail(userId: string): Promise<string | null>;
}

export const SUPABASE_ADMIN = Symbol('SUPABASE_ADMIN');

export class SupabaseAdminHttp implements SupabaseAdmin {
  private readonly url: string;
  private readonly secretKey: string;

  constructor(supabaseUrl: string, secretKey: string) {
    this.url = `${supabaseUrl}/auth/v1/admin/users`;
    this.secretKey = secretKey;
  }

  async loginEmail(userId: string): Promise<string | null> {
    const res = await fetch(`${this.url}/${encodeURIComponent(userId)}`, {
      headers: { apikey: this.secretKey, authorization: `Bearer ${this.secretKey}` },
      signal: AbortSignal.timeout(5_000),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Supabase Auth Admin trả ${res.status}`);
    return AdminUser.parse(await res.json()).email ?? null;
  }
}
