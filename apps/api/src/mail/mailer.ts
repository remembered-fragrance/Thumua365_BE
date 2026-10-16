/**
 * Gửi thư (0.16.0) — chỉ hai loại: link xác nhận email khôi phục, link đặt lại mật khẩu.
 *
 * Brevo qua HTTPS (gói free 300 thư/ngày): Render free chặn cổng SMTP, và thư có sẵn của Supabase Auth
 * đi tới email ĐĂNG NHẬP — với người đăng ký bằng SĐT đó là email nội bộ `84…@id.thumua365.vn`,
 * không ai nhận. Máy dev không có khoá: thư in ra log để bấm thử link.
 */

import type { Logger } from 'winston';
import { z } from 'zod';
import type { Env } from '../config/env';

export interface Mail {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

export interface Mailer {
  /** false ⇒ không gửi được thư nào: API trả EMAIL_UNAVAILABLE thay vì giả vờ đã gửi. */
  readonly configured: boolean;
  /** Ném lỗi nếu nhà cung cấp không nhận thư. */
  send(mail: Mail): Promise<void>;
}

export const MAILER = Symbol('MAILER');

const BrevoError = z.object({ code: z.string().optional(), message: z.string().optional() }).partial();

export class BrevoMailer implements Mailer {
  readonly configured = true;
  private readonly apiKey: string;
  private readonly from: { readonly name: string; readonly email: string };

  constructor(apiKey: string, fromEmail: string, fromName: string) {
    this.apiKey = apiKey;
    this.from = { name: fromName, email: fromEmail };
  }

  async send(mail: Mail): Promise<void> {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': this.apiKey, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        sender: this.from,
        to: [{ email: mail.to }],
        subject: mail.subject,
        htmlContent: mail.html,
        textContent: mail.text,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      // Không ghi địa chỉ người nhận vào lỗi — lỗi đi vào log / Sentry.
      const body = BrevoError.safeParse(await res.json().catch(() => ({})));
      const code = body.success ? (body.data.code ?? '') : '';
      throw new Error(`Brevo trả ${res.status}${code ? ` (${code})` : ''}`);
    }
  }
}

/** Máy dev: không gửi, in thư ra log (có link) để bấm thử. */
export class LogMailer implements Mailer {
  readonly configured = true;
  private readonly logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  async send(mail: Mail): Promise<void> {
    this.logger.info('mail_dev', { to: mail.to, subject: mail.subject, text: mail.text });
  }
}

/** Staging / production chưa có khoá Brevo. */
export class NoMailer implements Mailer {
  readonly configured = false;

  async send(): Promise<void> {
    throw new Error('Chưa cấu hình gửi thư (BREVO_API_KEY)');
  }
}

export const buildMailer = (env: Env, logger: Logger): Mailer => {
  if (env.BREVO_API_KEY && env.MAIL_FROM) return new BrevoMailer(env.BREVO_API_KEY, env.MAIL_FROM, env.MAIL_FROM_NAME);
  if (env.APP_ENV === 'development') return new LogMailer(logger);
  return new NoMailer();
};

/** Địa chỉ web app cho link trong thư. Máy dev không đặt APP_URL ⇒ Vite mặc định. */
export const appUrlOf = (env: Pick<Env, 'APP_URL'>): string => env.APP_URL ?? 'http://localhost:5173';
