import { planFor } from '@mambo/core/subscription';
import { Feature, type MeMembership, MemberRole, OrgType, type PlanSummary, hasBook, permissionsOf } from '@mambo/contracts';
import { GRACE_DAYS } from '../config/plans';
import type { Database } from '../db/database';
import type { MembershipContext, MembershipLookup } from './membership';

const iso = (d: Date | null): string | undefined => d?.toISOString();

interface SubscriptionRow {
  readonly id: string;
  readonly status: string;
  readonly trialEndsAt: Date | null;
  readonly currentPeriodEnd: Date | null;
  readonly branchLimit: number | null;
}

/** Bậc gói suy từ ngày tháng bằng đúng hàm của frontend (`@mambo/core/subscription`). */
export const planSummary = (sub: SubscriptionRow | undefined, now: Date): PlanSummary | null => {
  if (!sub) return null;
  const status = sub.status as PlanSummary['status'];
  const plan = planFor(
    { id: sub.id, status, trialEndsAt: iso(sub.trialEndsAt), currentPeriodEnd: iso(sub.currentPeriodEnd) },
    now,
    GRACE_DAYS,
  );
  return { tier: plan.tier, status, periodEnd: plan.endsAt ?? null, branchLimit: sub.branchLimit };
};

/**
 * Membership đọc từ Postgres. Mọi truy vấn chạy trong `scoped({ userId, orgId: null })`:
 * policy của memberships cho thấy đúng hàng của chính người đó, còn tổ chức / gói /
 * chi nhánh hiện ra qua `app_is_member()`. Người khác không lọt vào được dù truy vấn
 * có sai điều kiện.
 */
export class PrismaMemberships implements MembershipLookup {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  async find(userId: string, organizationId: string): Promise<MembershipContext | null> {
    const row = await this.db.scoped({ userId, orgId: null }, (tx) =>
      tx.membership.findFirst({
        where: { userId, organizationId, status: 'active', organization: { deletedAt: null } },
        select: { role: true, branchId: true, organization: { select: { type: true } } },
      }),
    );
    if (!row) return null;
    return {
      organizationId,
      orgType: OrgType.parse(row.organization.type),
      role: MemberRole.parse(row.role),
      branchId: row.branchId,
    };
  }

  async listForUser(userId: string): Promise<MeMembership[]> {
    const rows = await this.db.scoped({ userId, orgId: null }, (tx) =>
      tx.membership.findMany({
        where: { userId, status: 'active', organization: { deletedAt: null } },
        orderBy: { createdAt: 'asc' },
        select: {
          role: true,
          branch: { select: { id: true, name: true } },
          organization: {
            select: {
              id: true,
              type: true,
              name: true,
              subscriptions: {
                where: { deletedAt: null },
                select: { id: true, status: true, trialEndsAt: true, currentPeriodEnd: true, branchLimit: true },
                take: 1,
              },
              features: { select: { feature: true }, orderBy: { feature: 'asc' } },
            },
          },
        },
      }),
    );

    const now = new Date();
    return rows.map((row) => {
      const type = OrgType.parse(row.organization.type);
      const role = MemberRole.parse(row.role);
      return {
        organization: { id: row.organization.id, type, name: row.organization.name },
        role,
        branch: row.branch,
        permissions: [...permissionsOf(type, role)],
        plan: hasBook(type) ? planSummary(row.organization.subscriptions[0], now) : null,
        features: row.organization.features.map((f) => Feature.parse(f.feature)),
      };
    });
  }

  async pendingLinks(userId: string): Promise<number> {
    return this.db.scoped({ userId, orgId: null }, (tx) =>
      tx.partnerLink.count({
        where: {
          status: 'pending',
          linked: { memberships: { some: { userId, status: 'active' } }, deletedAt: null },
        },
      }),
    );
  }
}
