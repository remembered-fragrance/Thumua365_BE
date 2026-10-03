/**
 * POST /v1/events — đo lường first-party, KH backend §6, BE9 (R5).
 *
 * Route công khai (sự kiện trước khi đăng nhập: mở app, đăng nhập hỏng). Có token hợp lệ +
 * `X-Organization-Id` của một tổ chức người đó thuộc → gắn tổ chức và `orgType` THẬT từ membership;
 * token sai hay không thuộc tổ chức → coi như chưa đăng nhập (đo lường không bao giờ chặn app).
 *
 * Từng sự kiện kiểm bằng danh mục có kiểu (`TrackedEvent`); sai → bỏ riêng nó. Giờ xảy ra lấy từ máy
 * (đúng thứ tự cả khi gửi muộn lúc có mạng), kẹp trong [−30 ngày, +5 phút] so với giờ server.
 */

import { type EventsTrackResult, type OrgType, TrackedEvent } from '@mambo/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { Logger } from 'winston';
import { JWKS, type Jwks, verifySupabaseToken } from '../auth/auth-user';
import { MEMBERSHIP_LOOKUP, type MembershipLookup } from '../auth/membership';
import { ENV, type Env } from '../config/env';
import { DATABASE, type Database, type Tx } from '../db/database';
import { LOGGER } from '../events/domain-events';
import type { Prisma } from '../generated/prisma/client';
import { analyticsEvents } from '../metrics/metrics';

const PAST_MS = 30 * 24 * 60 * 60 * 1000;
const FUTURE_MS = 5 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Identity {
  readonly userId: string;
  readonly organizationId: string;
  readonly orgType: OrgType;
}

const clamp = (at: string, now: number): Date => new Date(Math.min(Math.max(Date.parse(at), now - PAST_MS), now + FUTURE_MS));

@Injectable()
export class EventsService {
  private readonly db: Database;
  private readonly env: Env;
  private readonly jwks: Jwks;
  private readonly memberships: MembershipLookup;
  private readonly logger: Logger;

  constructor(
    @Inject(DATABASE) db: Database,
    @Inject(ENV) env: Env,
    @Inject(JWKS) jwks: Jwks,
    @Inject(MEMBERSHIP_LOOKUP) memberships: MembershipLookup,
    @Inject(LOGGER) logger: Logger,
  ) {
    this.db = db;
    this.env = env;
    this.jwks = jwks;
    this.memberships = memberships;
    this.logger = logger;
  }

  async track(rawEvents: readonly unknown[], authorization: string | undefined, orgHeader: string | undefined): Promise<EventsTrackResult> {
    const who = await this.identify(authorization, orgHeader);
    const now = Date.now();
    const rows: Prisma.AnalyticsEventCreateManyInput[] = [];
    for (const raw of rawEvents) {
      const parsed = TrackedEvent.safeParse(raw);
      if (!parsed.success) continue;
      const e = parsed.data;
      rows.push({
        organizationId: who?.organizationId ?? null,
        orgType: who?.orgType ?? e.orgType ?? null,
        anonId: e.anonId,
        name: e.name,
        props: e.props as Prisma.InputJsonValue,
        appVersion: e.appVersion ?? null,
        platform: e.platform,
        createdAt: clamp(e.at, now),
      });
    }

    if (rows.length > 0) {
      const insert = (tx: Tx) => tx.analyticsEvent.createMany({ data: rows });
      await (who ? this.db.scoped({ userId: who.userId, orgId: who.organizationId }, insert) : this.db.anonymous(insert));
    }
    const dropped = rawEvents.length - rows.length;
    analyticsEvents.inc({ result: 'accepted' }, rows.length);
    if (dropped > 0) analyticsEvents.inc({ result: 'dropped' }, dropped);
    return { accepted: rows.length, dropped };
  }

  /** Người + tổ chức nếu xác thực được; mọi trường hợp khác → chưa đăng nhập. */
  private async identify(authorization: string | undefined, orgHeader: string | undefined): Promise<Identity | null> {
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
    const orgId = orgHeader?.trim().toLowerCase() ?? '';
    if (!token || !UUID.test(orgId)) return null;
    try {
      const user = await verifySupabaseToken(token, this.jwks, this.env.SUPABASE_URL);
      const m = await this.memberships.find(user.id, orgId);
      return m ? { userId: user.id, organizationId: m.organizationId, orgType: m.orgType } : null;
    } catch (err) {
      this.logger.debug('events.anonymous', { reason: err instanceof Error ? err.message : String(err) });
      return null;
    }
  }
}
