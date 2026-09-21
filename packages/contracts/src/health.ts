import { z } from 'zod';

export const AppEnv = z.enum(['development', 'staging', 'production']);
export type AppEnv = z.infer<typeof AppEnv>;

/** `GET /v1/health` — nơi chạy container dùng để biết bản mới đã lên chưa. */
export const Health = z.object({
  status: z.literal('ok'),
  version: z.string(),
  /** Commit đang chạy, để biết chắc bản nào đang ở staging. */
  commit: z.string().nullable(),
  env: AppEnv,
});
export type Health = z.infer<typeof Health>;
