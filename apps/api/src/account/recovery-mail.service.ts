/**
 * Email khôi phục (0.16.0): gửi link xác nhận, bấm link, quên mật khẩu.
 *
 * Chỉ email ĐÃ XÁC NHẬN nhận link đặt lại mật khẩu — email chưa xác nhận chỉ là chữ người dùng gõ,
 * gửi tới đó là trao tài khoản cho chủ hộp thư (có thể là người lạ). Mã xác nhận: 32 byte ngẫu
 * nhiên trong link, database chỉ giữ sha256. Mỗi tài khoản một thư / 60 giây (`auth_mail_sent_at`,
 * chung cho cả hai loại thư) — chặn dùng API để dội thư vào hộp thư người khác.
 */

import { createHash, randomBytes } from 'node:crypto';
import type { RecoveryEmailConfirmResult, RecoveryEmailVerifyResult } from '@mambo/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { Logger } from 'winston';
import { SUPABASE_ADMIN, type SupabaseAdmin } from '../auth/supabase-admin';
import { ApiException } from '../common/api-exception';
import { ENV, type Env } from '../config/env';
import { DATABASE, type Database, type Tx } from '../db/database';
import { LOGGER } from '../events/domain-events';
import { MAILER, type Mailer, appUrlOf } from '../mail/mailer';
import { resetPasswordMail, verifyEmailMail } from '../mail/templates';

const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
export const MAIL_COOLDOWN_MS = 60 * 1000;

export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

const unavailable = (): ApiException =>
  new ApiException('EMAIL_UNAVAILABLE', 'Chưa gửi được thư lúc này — thử lại sau, hoặc liên hệ kỹ thuật viên');

/**
 * Email đã là email khôi phục ĐÃ XÁC NHẬN của tài khoản khác (C4). Email chưa xác nhận không giữ chỗ:
 * hai người cùng khai được, ai bấm link trước thì giữ — người sau nhận lỗi này, không lặng lẽ thành công.
 */
export const emailTaken = (): ApiException =>
  new ApiException('VALIDATION_FAILED', 'Email này đã được tài khoản khác xác nhận — dùng email khác', {
    reason: 'EMAIL_TAKEN',
    fields: { recoveryEmail: 'Email này đã thuộc tài khoản khác' },
  });

/** Chủ của email nếu email đã được xác nhận (`find_login_user` chỉ khớp email đã xác nhận). */
export const verifiedOwnerOf = async (tx: Tx, email: string): Promise<string | null> =>
  (await tx.$queryRaw<{ id: string | null }[]>`select public.find_login_user(${email})::text as id`)[0]?.id ?? null;

/** Bấm link khi email đã có người xác nhận trước: index `profiles_recovery_email_verified` chặn. */
const isTakenViolation = (err: unknown): boolean =>
  err instanceof Error && err.message.includes('profiles_recovery_email_verified');

@Injectable()
export class RecoveryMailService {
  private readonly db: Database;
  private readonly admin: SupabaseAdmin;
  private readonly mailer: Mailer;
  private readonly appUrl: string;
  private readonly logger: Logger;

  constructor(
    @Inject(DATABASE) db: Database,
    @Inject(SUPABASE_ADMIN) admin: SupabaseAdmin,
    @Inject(MAILER) mailer: Mailer,
    @Inject(ENV) env: Env,
    @Inject(LOGGER) logger: Logger,
  ) {
    this.db = db;
    this.admin = admin;
    this.mailer = mailer;
    this.appUrl = appUrlOf(env);
    this.logger = logger;
  }

  /**
   * Gửi (lại) thư xác nhận cho email khôi phục của chính người gọi. Mã mới thay mã cũ. Ghi mã rồi
   * mới gửi; gửi hỏng thì gỡ mã và mốc gửi — người dùng thử lại ngay được, không phải chờ 60 giây.
   */
  async sendVerification(userId: string): Promise<RecoveryEmailVerifyResult> {
    if (!this.mailer.configured) throw unavailable();
    const token = randomBytes(32).toString('base64url');
    const tokenHash = hashToken(token);
    const now = new Date();

    const claimed = await this.db.scoped({ userId, orgId: null }, async (tx) => {
      const row = await tx.profile.findFirst({
        where: { id: userId, deletedAt: null },
        select: { recoveryEmail: true, recoveryEmailVerifiedAt: true },
      });
      if (!row) throw new ApiException('NOT_FOUND', 'Chưa có hồ sơ — làm bước "Bạn là ai?" trước');
      if (!row.recoveryEmail) return 'no_email' as const;
      if (row.recoveryEmailVerifiedAt) return 'already_verified' as const;
      const owner = await verifiedOwnerOf(tx, row.recoveryEmail);
      if (owner && owner !== userId) throw emailTaken();
      const { count } = await tx.profile.updateMany({
        where: {
          id: userId,
          deletedAt: null,
          OR: [{ authMailSentAt: null }, { authMailSentAt: { lt: new Date(now.getTime() - MAIL_COOLDOWN_MS) } }],
        },
        data: { recoveryEmailTokenHash: tokenHash, recoveryEmailTokenExpiresAt: new Date(now.getTime() + VERIFY_TTL_MS), authMailSentAt: now },
      });
      return count === 0 ? ('too_soon' as const) : { email: row.recoveryEmail };
    });
    if (typeof claimed === 'string') return { status: claimed };

    try {
      await this.mailer.send(verifyEmailMail(claimed.email, `${this.appUrl}/xac-nhan-email?token=${token}`));
    } catch (err) {
      this.logger.error('mail_verify_failed', { userId, error: err instanceof Error ? err.message : String(err) });
      await this.db
        .scoped({ userId, orgId: null }, (tx) =>
          tx.profile.updateMany({
            where: { id: userId, recoveryEmailTokenHash: tokenHash },
            data: { recoveryEmailTokenHash: null, recoveryEmailTokenExpiresAt: null, authMailSentAt: null },
          }),
        )
        .catch(() => undefined);
      throw unavailable();
    }
    return { status: 'sent' };
  }

  /**
   * Sau khi hồ sơ có email mới (đăng ký, sửa hồ sơ): gửi thư xác nhận nếu được. Không bao giờ ném —
   * việc chính đã xong; người dùng bấm "Gửi lại thư xác nhận" sau cũng được.
   */
  async sendVerificationQuietly(userId: string): Promise<void> {
    if (!this.mailer.configured) return;
    try {
      await this.sendVerification(userId);
    } catch (err) {
      if (!(err instanceof ApiException)) this.logger.error('mail_verify_failed', { userId, error: err instanceof Error ? err.message : String(err) });
    }
  }

  /**
   * Bấm link xác nhận — chưa đăng nhập cũng được. Mã sai / đã dùng / hết hạn → `email: null`. Email đã có
   * tài khoản khác xác nhận trước → 422 `EMAIL_TAKEN` (mã giữ nguyên, đổi email rồi gửi lại).
   */
  async confirm(token: string): Promise<RecoveryEmailConfirmResult> {
    let rows: { email: string | null }[];
    try {
      rows = await this.db.anonymous((tx) =>
        tx.$queryRaw<{ email: string | null }[]>`select public.confirm_recovery_email(${hashToken(token)}) as email`,
      );
    } catch (err) {
      throw isTakenViolation(err) ? emailTaken() : err;
    }
    return { email: rows[0]?.email ?? null };
  }

  /**
   * Quên mật khẩu. Không có tài khoản, chưa có email đã xác nhận, hay vừa gửi trong 60 giây đều trả
   * `{ ok: true }` như nhau — không cho dò ai có tài khoản. Chỉ khi hệ thống gửi thư hỏng mới 503.
   */
  async requestPasswordReset(identifier: string): Promise<{ ok: true }> {
    if (!this.mailer.configured) throw unavailable();
    const claimed = await this.db.anonymous(async (tx) => {
      const found = await tx.$queryRaw<{ id: string | null }[]>`select public.find_login_user(${identifier})::text as id`;
      const userId = found[0]?.id;
      if (!userId) return null;
      const rows = await tx.$queryRaw<{ email: string | null }[]>`select public.claim_password_reset_mail(${userId}::uuid) as email`;
      const email = rows[0]?.email;
      return email ? { userId, email } : null;
    });
    if (!claimed) return { ok: true };

    try {
      const loginEmail = await this.admin.loginEmail(claimed.userId);
      if (!loginEmail) return { ok: true };
      const tokenHash = await this.admin.recoveryToken(loginEmail);
      const link = `${this.appUrl}/dat-lai-mat-khau?token_hash=${encodeURIComponent(tokenHash)}&type=recovery`;
      await this.mailer.send(resetPasswordMail(claimed.email, link));
    } catch (err) {
      this.logger.error('mail_reset_failed', { userId: claimed.userId, error: err instanceof Error ? err.message : String(err) });
      throw unavailable();
    }
    return { ok: true };
  }
}
