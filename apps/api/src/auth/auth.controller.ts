import { createHmac } from 'node:crypto';
import { detectIdentifierKind, normalizePhone } from '@mambo/core/identifier';
import { type ResolveIdentifierInput, type ResolveIdentifierResult, routes } from '@mambo/contracts';
import { Body, Controller, Inject } from '@nestjs/common';
import type { z } from 'zod';
import { Endpoint } from '../common/endpoint';
import { ENV, type Env } from '../config/env';
import { DATABASE, type Database } from '../db/database';
import { INTERNAL_EMAIL_DOMAIN, internalEmailOf } from './login-email';
import { SUPABASE_ADMIN, type SupabaseAdmin } from './supabase-admin';

/**
 * Email "mồi" khi không có tài khoản nào khớp — cùng HÌNH DẠNG với email thật, để
 * câu trả lời không nói được tài khoản có tồn tại hay không:
 *   - số điện thoại → đúng email nội bộ của số đó (y hệt tài khoản thật chỉ có SĐT)
 *   - email         → chính nó
 *   - tên tài khoản → `849` + 8 chữ số rút từ HMAC(khoá bí mật, tên): cố định cho
 *                     cùng một tên, người ngoài không tự tính ra được
 */
export const decoyEmail = (identifier: string, secret: string): string => {
  const kind = detectIdentifierKind(identifier);
  if (kind === 'email') return identifier.trim().toLowerCase();
  if (kind === 'phone') return internalEmailOf(normalizePhone(identifier));
  const digest = createHmac('sha256', secret).update(`username:${identifier.trim().toLowerCase()}`).digest();
  const digits = (digest.readBigUInt64BE(0) % 100_000_000n).toString().padStart(8, '0');
  return `849${digits}${INTERNAL_EMAIL_DOMAIN}`;
};

@Controller()
export class AuthController {
  private readonly db: Database;
  private readonly admin: SupabaseAdmin;
  private readonly decoyKey: string;

  constructor(@Inject(DATABASE) db: Database, @Inject(SUPABASE_ADMIN) admin: SupabaseAdmin, @Inject(ENV) env: Env) {
    this.db = db;
    this.admin = admin;
    this.decoyKey = env.SUPABASE_SECRET_KEY;
  }

  /**
   * Chưa đăng nhập ⇒ transaction không có ngữ cảnh RLS; chỉ gọi được hàm
   * `find_login_user` (security definer, trả đúng một id). Email đọc qua Auth Admin API.
   */
  @Endpoint(routes.resolveIdentifier)
  async resolve(@Body() input: z.output<typeof ResolveIdentifierInput>): Promise<ResolveIdentifierResult> {
    const rows = await this.db.anonymous((tx) =>
      tx.$queryRaw<{ id: string | null }[]>`select public.find_login_user(${input.identifier})::text as id`,
    );
    const userId = rows[0]?.id;
    if (userId) {
      const email = await this.admin.loginEmail(userId);
      if (email) return { email };
    }
    return { email: decoyEmail(input.identifier, this.decoyKey) };
  }
}
