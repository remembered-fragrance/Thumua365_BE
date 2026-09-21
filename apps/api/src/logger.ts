import { createLogger, format, type Logger, transports } from 'winston';
import type { Env } from './config/env';

/**
 * Log JSON một dòng mỗi sự kiện — nơi chạy container gom và tìm theo `requestId`.
 * Không bao giờ ghi token, mật khẩu hay nội dung phiếu.
 */
export const buildLogger = (env: Pick<Env, 'LOG_LEVEL' | 'APP_ENV'>, silent = false): Logger =>
  createLogger({
    level: env.LOG_LEVEL,
    silent,
    format: format.combine(format.timestamp(), format.errors({ stack: true }), format.json()),
    defaultMeta: { service: 'api', env: env.APP_ENV },
    transports: [new transports.Console()],
  });
