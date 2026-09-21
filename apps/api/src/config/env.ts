/**
 * Biến môi trường — kiểm bằng zod ngay lúc khởi động. Thiếu hay sai là API
 * KHÔNG chạy, kèm câu báo lỗi chỉ đúng biến nào; không có chuyện chạy nửa vời
 * rồi hỏng ở request đầu tiên.
 *
 * Không biến nào ở đây là bí mật tới BE1: URL và publishable key của Supabase
 * vốn công khai trong app web. Bí mật (DATABASE_URL, service_role) thêm từ BE2.
 */

import { AppEnv } from '@mambo/contracts';
import { z } from 'zod';

const csv = z
  .string()
  .default('')
  .transform((raw) =>
    raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s !== ''),
  );

const EnvSchema = z
  .object({
    APP_ENV: AppEnv.default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    SUPABASE_URL: z.url().transform((u) => u.replace(/\/+$/, '')),
    SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
    CORS_ORIGINS: csv,
    RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(120),
    LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
    SENTRY_DSN: z
      .string()
      .optional()
      .transform((v) => (v ? v : undefined))
      .pipe(z.url().optional()),
    /**
     * Header mang IP thật của người gọi, do proxy phía trước GHI ĐÈ (không để client tự
     * đặt). Render đứng sau Cloudflare ⇒ `cf-connecting-ip`. Để trống ở máy dev/CI: khi
     * đó header bị bỏ qua, không ai giả header để lách hạn mức được.
     */
    CLIENT_IP_HEADER: z
      .string()
      .optional()
      .transform((v) => (v ? v.trim().toLowerCase() : undefined)),
    /** Render tự đặt biến này cho mỗi lần deploy. */
    RENDER_GIT_COMMIT: z.string().optional(),
  })
  .refine((env) => env.APP_ENV === 'development' || env.CORS_ORIGINS.length > 0, {
    message: 'CORS_ORIGINS bắt buộc ở staging và production',
    path: ['CORS_ORIGINS'],
  });

export type Env = z.infer<typeof EnvSchema>;

export const ENV = Symbol('ENV');

export const loadEnv = (source: Record<string, string | undefined> = process.env): Env => {
  const parsed = EnvSchema.safeParse(source);
  if (parsed.success) return parsed.data;

  const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.') || '(env)'}: ${i.message}`);
  throw new Error(`Biến môi trường chưa đúng:\n${lines.join('\n')}`);
};
