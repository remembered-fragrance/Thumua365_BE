/**
 * Auth Admin API của Supabase — bằng khoá SECRET, nên chỉ dùng cho đúng việc cần
 * chạm tài khoản của NGƯỜI KHÁC: đổi id người dùng thành email đăng nhập
 * (/v1/auth/resolve-identifier); chủ tạo tài khoản cho nhân viên (/v1/org/members, BE7).
 * Việc của chính người gọi đi qua `SupabaseUsers` (token của họ), không qua đây.
 */

import { z } from 'zod';

const AdminUser = z.object({ id: z.string(), email: z.string().nullish() });

export interface NewAccount {
  /** Email đăng nhập (nội bộ `84…@id.thumua365.vn`). Đã xác nhận sẵn — không gửi thư. */
  readonly email: string;
  readonly password: string;
  readonly name: string;
}

export interface SupabaseAdmin {
  /** Email đăng nhập của tài khoản; null nếu không có tài khoản đó. */
  loginEmail(userId: string): Promise<string | null>;
  /** Tạo tài khoản; `'exists'` khi email đăng nhập đã có người dùng. */
  createUser(account: NewAccount): Promise<{ readonly id: string } | 'exists'>;
  /** Xoá tài khoản — chỉ để dọn tài khoản vừa tạo khi bước ghi database sau đó hỏng. */
  deleteUser(userId: string): Promise<void>;
}

export const SUPABASE_ADMIN = Symbol('SUPABASE_ADMIN');

export class SupabaseAdminHttp implements SupabaseAdmin {
  private readonly url: string;
  private readonly secretKey: string;

  constructor(supabaseUrl: string, secretKey: string) {
    this.url = `${supabaseUrl}/auth/v1/admin/users`;
    this.secretKey = secretKey;
  }

  private get headers(): Record<string, string> {
    return { apikey: this.secretKey, authorization: `Bearer ${this.secretKey}`, 'content-type': 'application/json' };
  }

  async loginEmail(userId: string): Promise<string | null> {
    const res = await fetch(`${this.url}/${encodeURIComponent(userId)}`, {
      headers: this.headers,
      signal: AbortSignal.timeout(5_000),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Supabase Auth Admin trả ${res.status}`);
    return AdminUser.parse(await res.json()).email ?? null;
  }

  async createUser(account: NewAccount): Promise<{ readonly id: string } | 'exists'> {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        email: account.email,
        password: account.password,
        email_confirm: true,
        user_metadata: { name: account.name },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 422 || res.status === 409) {
      const body = (await res.json().catch(() => ({}))) as { error_code?: string; code?: string; msg?: string };
      const code = body.error_code ?? body.code ?? '';
      if (code === 'email_exists' || code === 'user_already_exists' || /already/i.test(body.msg ?? '')) return 'exists';
    }
    if (!res.ok) throw new Error(`Supabase Auth Admin trả ${res.status} khi tạo tài khoản`);
    return { id: AdminUser.parse(await res.json()).id };
  }

  async deleteUser(userId: string): Promise<void> {
    const res = await fetch(`${this.url}/${encodeURIComponent(userId)}`, {
      method: 'DELETE',
      headers: this.headers,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok && res.status !== 404) throw new Error(`Supabase Auth Admin trả ${res.status} khi xoá tài khoản`);
  }
}
