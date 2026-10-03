/**
 * Ba sự kiện đo lường do SERVER bắn (KH BE9) — đáng tin hơn để app tự báo: `plan_activated` (tiền
 * đã vào), `order_fulfilled` (phiếu theo đơn đã lên), `link_accepted` (kết nối đã đồng ý). Chạy sau
 * commit; hỏng không làm hỏng việc chính.
 */

import type { ServerEventName } from '@mambo/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import * as Sentry from '@sentry/node';
import type { Logger } from 'winston';
import { DATABASE, type Database } from '../db/database';
import { type DomainEventMap, LOGGER, type OrderChanged } from '../events/domain-events';
import type { Prisma } from '../generated/prisma/client';
import { notificationFailures } from '../metrics/metrics';

const ON = { async: true, suppressErrors: true } as const;

@Injectable()
export class AnalyticsListener {
  private readonly db: Database;
  private readonly logger: Logger;

  constructor(@Inject(DATABASE) db: Database, @Inject(LOGGER) logger: Logger) {
    this.db = db;
    this.logger = logger;
  }

  @OnEvent('plan.activated', ON)
  onPlan(e: DomainEventMap['plan.activated']): Promise<void> {
    return this.record('plan_activated', e.organizationId, { months: e.months, source: e.source });
  }

  @OnEvent('order.fulfilled', ON)
  onFulfilled(e: OrderChanged): Promise<void> {
    return this.record('order_fulfilled', e.actorOrgId, {});
  }

  @OnEvent('link.accepted', ON)
  onLink(e: DomainEventMap['link.accepted']): Promise<void> {
    return this.record('link_accepted', e.linkedOrgId, {});
  }

  private async record(name: ServerEventName, orgId: string, props: Prisma.InputJsonValue): Promise<void> {
    try {
      await this.db.system(orgId, async (tx) => {
        const org = await tx.organization.findUnique({ where: { id: orgId }, select: { type: true } });
        // createMany: api_service chỉ có INSERT trên bảng này — create() cần RETURNING (quyền đọc).
        await tx.analyticsEvent.createMany({
          data: [{ organizationId: orgId, orgType: org?.type ?? null, anonId: 'server', name, props, platform: 'server' }],
        });
      });
    } catch (err) {
      notificationFailures.inc({ kind: name });
      this.logger.error('analytics.failed', { name, orgId, error: err instanceof Error ? err.message : String(err) });
      if (Sentry.isInitialized()) Sentry.captureException(err, { tags: { name } });
    }
  }
}
