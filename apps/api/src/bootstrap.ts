import { API_BODY_LIMIT_BYTES, ERROR_STATUS, type ErrorBody, type ErrorCode } from '@mambo/contracts';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import type { Logger } from 'winston';
import { ApiExceptionFilter } from './common/exception.filter';
import { type ApiRequest, requestContext } from './common/request-context';
import type { Env } from './config/env';
import { metricsEndpoint } from './metrics/metrics';

/**
 * 1MB. Lô đồng bộ tối đa `SYNC_PUSH_MAX_OPS` (200) thao tác nhưng số op không giữ được lô dưới mức
 * này (200 op nháp to ~1MB) — app cắt lô theo `SYNC_PUSH_MAX_BYTES` và tự chia đôi khi gặp 413.
 */
const JSON_BODY_LIMIT = API_BODY_LIMIT_BYTES;

const ALLOWED_HEADERS = ['authorization', 'content-type', 'x-organization-id', 'x-request-id'];
const EXPOSED_HEADERS = ['x-request-id', 'retry-after'];

/**
 * Lỗi của bộ đọc JSON (quá lớn, sai cú pháp) xảy ra TRƯỚC khi vào Nest, nên
 * exception filter không thấy. Chặn ở đây để vẫn ra đúng định dạng lỗi.
 */
const bodyErrorHandler = (err: unknown, req: Request, res: Response, next: NextFunction): void => {
  const status = (err as { status?: number } | null)?.status;
  if (status !== 413 && status !== 400) {
    next(err);
    return;
  }
  const code: ErrorCode = status === 413 ? 'PAYLOAD_TOO_LARGE' : 'VALIDATION_FAILED';
  const body: ErrorBody = {
    error: {
      code,
      message: code === 'PAYLOAD_TOO_LARGE' ? 'Dữ liệu gửi lên quá lớn' : 'Dữ liệu gửi lên không phải JSON hợp lệ',
      requestId: (req as ApiRequest).requestId,
    },
  };
  res.status(ERROR_STATUS[code]).json(body);
};

/**
 * Mọi cấu hình mức ứng dụng ở một chỗ — main.ts và test dùng chung, nên test
 * chạy đúng app sẽ lên production (helmet, CORS, giới hạn body, định dạng lỗi).
 * App phải được tạo với `bodyParser: false`.
 */
export const configureApp = (app: INestApplication, env: Env, logger: Logger): void => {
  const http = app as NestExpressApplication;

  // IP của người gọi cho hạn mức lấy từ CLIENT_IP_HEADER (xem env.ts). `trust proxy`
  // chỉ để req.ip / req.protocol không trỏ vào proxy của Render.
  http.set('trust proxy', 1);
  http.disable('x-powered-by');

  http.use(requestContext(logger, env.CLIENT_IP_HEADER));
  // Trước helmet / CORS / guard: Prometheus không phải trình duyệt, cũng không có JWT.
  http.use(metricsEndpoint(env.METRICS_TOKEN));
  http.use(helmet());
  http.enableCors({
    origin: (origin, cb) => cb(null, !origin || env.CORS_ORIGINS.includes(origin)),
    allowedHeaders: ALLOWED_HEADERS,
    exposedHeaders: EXPOSED_HEADERS,
    maxAge: 600,
  });
  http.use(express.json({ limit: JSON_BODY_LIMIT }));
  http.use(bodyErrorHandler);

  app.useGlobalFilters(new ApiExceptionFilter(logger));
  app.enableShutdownHooks();
};
