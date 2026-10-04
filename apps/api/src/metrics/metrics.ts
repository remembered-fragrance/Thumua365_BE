/**
 * Số đo cho Prometheus — KH backend §6, BE9. `GET /metrics` (ngoài `/v1`, không qua guard của API)
 * chỉ mở khi có `METRICS_TOKEN` và người gọi gửi đúng `Authorization: Bearer <token>`; không cấu
 * hình → 404, như không có gì ở đó.
 *
 * Nhãn `route` là MẪU đường dẫn (`/v1/orders/:id/accept`), không phải đường dẫn thật — id trong
 * đường dẫn sẽ làm số chuỗi số đo phình vô hạn.
 *
 * Registry là một bản cho cả tiến trình (test dựng nhiều app trong một tiến trình — đăng ký lại cùng
 * tên số đo sẽ lỗi).
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { collectDefaultMetrics, Counter, Histogram, Registry } from 'prom-client';

export const registry = new Registry();
collectDefaultMetrics({ register: registry });

export const httpDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Thời gian phản hồi theo route mẫu, phương thức, nhóm mã trạng thái',
  labelNames: ['method', 'route', 'status'] as const,
  buckets: [0.025, 0.05, 0.1, 0.2, 0.3, 0.5, 1, 2, 5],
  registers: [registry],
});

export const syncPushOps = new Counter({
  name: 'sync_push_ops_total',
  help: 'Op đồng bộ đã xử lý, theo kết quả (applied | duplicate | rejected)',
  labelNames: ['status'] as const,
  registers: [registry],
});

export const syncPushRejected = new Counter({
  name: 'sync_push_rejected_total',
  help: 'Op đồng bộ bị từ chối, theo mã lỗi',
  labelNames: ['code'] as const,
  registers: [registry],
});

export const syncPushBatch = new Histogram({
  name: 'sync_push_batch_size',
  help: 'Số op trong một lô /sync/push',
  buckets: [1, 5, 10, 25, 50, 100, 200],
  registers: [registry],
});

export const analyticsEvents = new Counter({
  name: 'analytics_events_total',
  help: 'Sự kiện đo lường nhận về, theo kết quả (accepted | dropped)',
  labelNames: ['result'] as const,
  registers: [registry],
});

export const notificationFailures = new Counter({
  name: 'notification_failures_total',
  help: 'Listener thông báo / đo lường hỏng (việc chính vẫn đã xong)',
  labelNames: ['kind'] as const,
  registers: [registry],
});

const sameToken = (given: string, expected: string): boolean =>
  timingSafeEqual(createHash('sha256').update(given).digest(), createHash('sha256').update(expected).digest());

/** `GET /metrics` cho Prometheus. Gắn trước Nest (configureApp). */
export const metricsEndpoint =
  (token: string | undefined) =>
  (req: Request, res: Response, next: NextFunction): void => {
    if (req.path !== '/metrics') {
      next();
      return;
    }
    const given = (req.header('authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!token || req.method !== 'GET' || given === '' || !sameToken(given, token)) {
      res.status(404).end();
      return;
    }
    registry
      .metrics()
      .then((body) => {
        res.setHeader('content-type', registry.contentType);
        res.end(body);
      })
      .catch(next);
  };

/** Mẫu route đã khớp (Express gắn sau khi định tuyến) — chưa khớp route nào thì `unmatched`. */
export const routeLabel = (req: Request): string => {
  const path = (req.route as { path?: unknown } | undefined)?.path;
  return typeof path === 'string' ? path : 'unmatched';
};
