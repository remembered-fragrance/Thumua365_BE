import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { Logger } from 'winston';
import type { AuthUser } from '../auth/auth-user';
import type { MembershipContext } from '../auth/membership';

/** Những gì các guard gắn vào request trên đường đi. */
export interface ApiRequest extends Request {
  requestId: string;
  /** IP dùng để tính hạn mức — xem `CLIENT_IP_HEADER`. Không ghi vào log. */
  clientIp: string;
  user?: AuthUser;
  membership?: MembershipContext;
}

/** Nhận `X-Request-Id` từ client nếu hợp lệ — để nối log hai phía khi hỗ trợ từ xa. */
const INCOMING_ID = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * Gắn mã request và ghi một dòng log truy cập khi phản hồi xong.
 *
 * Là middleware chứ không phải interceptor: interceptor chạy SAU guard, nên
 * request bị guard chặn (401, 403, 429) sẽ không có dòng log nào — đúng những
 * request cần xem nhất khi có sự cố. Không bao giờ ghi header Authorization.
 */
export const requestContext =
  (logger: Logger, clientIpHeader: string | undefined) =>
  (req: Request, res: Response, next: NextFunction): void => {
    const request = req as ApiRequest;
    const fromProxy = clientIpHeader ? req.header(clientIpHeader)?.split(',')[0]?.trim() : undefined;
    request.clientIp = fromProxy || req.ip || 'unknown';
    const incoming = req.header('x-request-id');
    request.requestId = incoming && INCOMING_ID.test(incoming) ? incoming : randomUUID();
    res.setHeader('x-request-id', request.requestId);

    const started = process.hrtime.bigint();
    res.on('finish', () => {
      logger.info('request', {
        requestId: request.requestId,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: Number((process.hrtime.bigint() - started) / 1_000_000n),
        userId: request.user?.id,
        orgId: request.membership?.organizationId,
      });
    });
    next();
  };
