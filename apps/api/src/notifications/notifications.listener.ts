/**
 * Việc của bên này → thông báo cho bên kia (KH §1.8). Chạy SAU KHI việc chính đã commit, trong
 * ngữ cảnh của tổ chức GÂY RA việc; hàm `notify_order()` / `notify_link()` tự tìm bên kia và chỉ
 * ghi được cho đúng bên kia. Hỏng ở đây KHÔNG làm hỏng việc chính: lỗi vào log + Sentry.
 *
 * Email (kênh thứ hai, qua hàng đợi job) thêm ở đây khi đã chọn nhà cung cấp gửi thư.
 */

import { Inject, Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import * as Sentry from '@sentry/node';
import type { Logger } from 'winston';
import { DATABASE, type Database, type Tx } from '../db/database';
import { notificationFailures } from '../metrics/metrics';
import { type DomainEventMap, LOGGER, type OrderChanged, type OrderEventName } from '../events/domain-events';

const ON = { async: true, suppressErrors: true } as const;

@Injectable()
export class NotificationsListener {
  private readonly db: Database;
  private readonly logger: Logger;

  constructor(@Inject(DATABASE) db: Database, @Inject(LOGGER) logger: Logger) {
    this.db = db;
    this.logger = logger;
  }

  @OnEvent('order.submitted', ON)
  onSubmitted(e: OrderChanged): Promise<void> {
    return this.order('order.submitted', e);
  }

  @OnEvent('order.accepted', ON)
  onAccepted(e: OrderChanged): Promise<void> {
    return this.order('order.accepted', e);
  }

  @OnEvent('order.scheduled', ON)
  onScheduled(e: OrderChanged): Promise<void> {
    return this.order('order.scheduled', e);
  }

  @OnEvent('order.cancelled', ON)
  onCancelled(e: OrderChanged): Promise<void> {
    return this.order('order.cancelled', e);
  }

  @OnEvent('order.fulfilled', ON)
  onFulfilled(e: OrderChanged): Promise<void> {
    return this.order('order.fulfilled', e);
  }

  @OnEvent('link.accepted', ON)
  onLinkAccepted(e: DomainEventMap['link.accepted']): Promise<void> {
    return this.link('link.accepted', e.linkId, e.linkedOrgId, e.actorUserId);
  }

  @OnEvent('link.revoked', ON)
  onLinkRevoked(e: DomainEventMap['link.revoked']): Promise<void> {
    const actorOrgId = e.by === 'owner' ? e.ownerOrgId : e.linkedOrgId;
    if (!actorOrgId) return Promise.resolve();
    return this.link('link.revoked', e.linkId, actorOrgId, e.actorUserId);
  }

  private order(kind: OrderEventName, e: OrderChanged): Promise<void> {
    return this.safely(kind, e.actorOrgId, e.actorUserId, async (tx) => {
      await tx.$queryRaw`select public.notify_order(${e.orderId}::uuid, ${kind}) as id`;
    });
  }

  private link(kind: 'link.accepted' | 'link.revoked', linkId: string, actorOrgId: string, actorUserId: string): Promise<void> {
    return this.safely(kind, actorOrgId, actorUserId, async (tx) => {
      await tx.$queryRaw`select public.notify_link(${linkId}::uuid, ${kind}) as id`;
    });
  }

  private async safely(kind: string, orgId: string, userId: string, work: (tx: Tx) => Promise<void>): Promise<void> {
    try {
      await this.db.scoped({ userId, orgId }, work);
    } catch (err) {
      notificationFailures.inc({ kind });
      this.logger.error('notification.failed', { kind, orgId, error: err instanceof Error ? err.message : String(err) });
      if (Sentry.isInitialized()) Sentry.captureException(err, { tags: { kind } });
    }
  }
}
