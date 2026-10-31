/**
 * Gói và ý định thanh toán — KH backend §1.7, BE6. Đọc / ghi qua RLS như thường (`org_rows`).
 *
 * Tầng này KHÔNG mở được gói: chỉ webhook ngân hàng và quản trị viên làm việc đó (role
 * `api_privileged`). Ý định thanh toán chỉ là "tôi định chuyển khoản số tiền này, với mã này".
 */

import { newTransferCode, transferContent } from '@mambo/core/transferCode';
import {
  EXTRA_STAFF_MAX,
  type PaymentIntentCreateInput,
  PaymentIntentStatus,
  type PaymentIntentView,
  type PlanCode,
  type PlanSummary,
  type StaffTopUp,
  type SubscriptionView,
  staffLimit,
} from '@mambo/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { z } from 'zod';
import type { AuthUser } from '../auth/auth-user';
import type { MembershipContext } from '../auth/membership';
import { planSummary } from '../auth/prisma-memberships';
import { ApiException } from '../common/api-exception';
import { PLAN_PRICES, STAFF_PRICES } from '../config/plans';
import { DATABASE, type Database, type Tx } from '../db/database';
import { Prisma, type PaymentIntent, type Subscription } from '../generated/prisma/client';
import { planAmount, purchaseOf, staffTopUpAmount } from './pricing';

const HISTORY = 12;
/** Ý định đang chờ cùng nội dung và cùng số tiền, tạo trong khoảng này → trả lại nó, không sinh mã mới. */
const REUSE_MS = 24 * 60 * 60 * 1000;

type CreateInput = z.output<typeof PaymentIntentCreateInput>;

/** Thứ ghi vào ý định — số tiền do máy chủ tính. */
interface Quote {
  readonly amount: number;
  readonly kind: 'plan' | 'staff';
  readonly plan: PlanCode | null;
  readonly months: 1 | 12 | null;
  readonly extraStaff: number;
}

const toView = (row: PaymentIntent): PaymentIntentView => {
  const code = row.providerRef ?? '';
  const amount = Number(row.amount);
  const bought = purchaseOf({ kind: row.kind, plan: row.plan, months: row.months, extraStaff: row.extraStaff, amount });
  return {
    id: row.id,
    amount,
    months: bought.kind === 'plan' ? bought.months : 1,
    kind: bought.kind,
    plan: bought.kind === 'plan' ? (bought.plan ?? null) : null,
    extraStaff: bought.extraStaff,
    code,
    transferContent: transferContent(code),
    status: PaymentIntentStatus.parse(row.status),
    createdAt: row.createdAt.toISOString(),
  };
};

const refused = (message: string, reason: string, extra: Record<string, unknown> = {}): ApiException =>
  new ApiException('VALIDATION_FAILED', message, { reason, ...extra });

/** Gói Vựa đã trả tiền và còn hạn — điều kiện duy nhất để mua thêm người cân giữa kỳ. */
const paidVua = (sub: Subscription | null, plan: PlanSummary | null): sub is Subscription & { currentPeriodEnd: Date } =>
  Boolean(sub?.currentPeriodEnd) && plan?.plan === 'vua' && plan.tier === 'premium';

const billingMonths = (sub: Subscription): 1 | 12 => (sub.billingMonths === 12 ? 12 : 1);

/** Giá mua thêm 1…(5 − đang có) người cân ngay lúc này; rỗng khi không mua thêm được. */
const staffTopUps = (sub: Subscription | null, plan: PlanSummary | null, now: Date): StaffTopUp[] => {
  if (!paidVua(sub, plan)) return [];
  return Array.from({ length: EXTRA_STAFF_MAX - sub.extraStaff }, (_, i) => ({
    extraStaff: i + 1,
    amount: staffTopUpAmount(i + 1, billingMonths(sub), sub.currentPeriodEnd, now),
  }));
};

/**
 * Báo giá theo gói đang có. Từ chối (422, `details.reason`):
 *  - `STAFF_NOT_AVAILABLE` — mua người cân khi không phải gói Vựa đã trả tiền còn hạn;
 *  - `EXTRA_STAFF_MAX` — quá 5 người cân thêm;
 *  - `DOWNGRADE_LOCKED` — mua Thương lái khi gói Vựa đã trả còn hạn (hạ gói chỉ khi hết hạn, chốt 30/10);
 *  - `STAFF_IN_USE` — gói / số người cân mới ít chỗ hơn số người đang làm: khoá bớt người cân trước.
 */
const quote = async (tx: Tx, orgId: string, sub: Subscription | null, input: CreateInput, now: Date): Promise<Quote> => {
  const current = planSummary(sub ?? undefined, now);

  if (input.kind === 'staff') {
    if (!paidVua(sub, current)) {
      throw refused('Chỉ mua thêm người cân khi đang dùng gói Vựa đã trả tiền và còn hạn', 'STAFF_NOT_AVAILABLE');
    }
    if (sub.extraStaff + input.extraStaff > EXTRA_STAFF_MAX) {
      throw refused(`Gói Vựa mua thêm tối đa ${EXTRA_STAFF_MAX} người cân — đang có thêm ${sub.extraStaff}`, 'EXTRA_STAFF_MAX', {
        extraStaff: sub.extraStaff,
      });
    }
    const amount = staffTopUpAmount(input.extraStaff, billingMonths(sub), sub.currentPeriodEnd, now);
    return { amount, kind: 'staff', plan: null, months: null, extraStaff: input.extraStaff };
  }

  if (input.plan === 'thuong_lai' && current?.plan === 'vua' && current.tier === 'premium') {
    throw refused('Gói Vựa còn hạn — mua gói Thương lái được sau ngày hết hạn', 'DOWNGRADE_LOCKED', { periodEnd: current.periodEnd });
  }
  // Cùng cách đếm với `assertStaffRoom` của màn người cân: mọi người đang làm, không tính chủ.
  const used = await tx.membership.count({ where: { organizationId: orgId, status: 'active', role: { not: 'owner' } } });
  const limit = staffLimit(input.plan, input.extraStaff) ?? 0;
  if (used > limit) {
    throw refused(`Đang có ${used} người cân, gói này cho ${limit} — khoá bớt người cân trước`, 'STAFF_IN_USE', { used, limit });
  }
  return {
    amount: planAmount(input.plan, input.months, input.extraStaff),
    kind: 'plan',
    plan: input.plan,
    months: input.months,
    extraStaff: input.extraStaff,
  };
};

@Injectable()
export class BillingService {
  private readonly db: Database;

  constructor(@Inject(DATABASE) db: Database) {
    this.db = db;
  }

  subscription(user: AuthUser, m: MembershipContext): Promise<SubscriptionView> {
    return this.db.scoped({ userId: user.id, orgId: m.organizationId }, async (tx) => {
      const sub = await tx.subscription.findFirst({
        where: { organizationId: m.organizationId, deletedAt: null },
        orderBy: { createdAt: 'asc' },
      });
      const now = new Date();
      const plan = m.orgType === 'farmer' ? null : planSummary(sub ?? undefined, now);
      const selfServe = m.orgType === 'trader';
      return {
        plan,
        trialEndsAt: sub?.trialEndsAt?.toISOString() ?? null,
        currentPeriodEnd: sub?.currentPeriodEnd?.toISOString() ?? null,
        selfServe,
        prices: selfServe ? PLAN_PRICES.map((p) => ({ plan: p.plan, months: p.months, amount: p.amount })) : [],
        staffPrices: selfServe ? STAFF_PRICES.map((p) => ({ months: p.months, amount: p.amount })) : [],
        staffTopUps: selfServe ? staffTopUps(sub, plan, now) : [],
      };
    });
  }

  intents(user: AuthUser, m: MembershipContext): Promise<PaymentIntentView[]> {
    return this.db.scoped({ userId: user.id, orgId: m.organizationId }, async (tx) =>
      (
        await tx.paymentIntent.findMany({
          where: { organizationId: m.organizationId, deletedAt: null },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: HISTORY,
        })
      ).map(toView),
    );
  }

  /**
   * Chỉ chủ tài khoản vựa tự mua; doanh nghiệp giữ như cũ (liên hệ để kích hoạt). Ý định chỉ dùng lại khi cùng
   * gói / số tháng / số người cân VÀ cùng số tiền tính lại — tiền người cân theo ngày nên qua hôm sau là khác số.
   * Mã trùng một mã đang chờ (index duy nhất) thì sinh lại — tối đa 5 lần.
   */
  async createIntent(user: AuthUser, m: MembershipContext, input: CreateInput): Promise<PaymentIntentView> {
    if (m.orgType === 'farmer') throw new ApiException('FORBIDDEN', 'Nông dân dùng miễn phí — không có gói để mua');
    if (m.orgType === 'enterprise') {
      throw new ApiException('FORBIDDEN', 'Gói doanh nghiệp tính theo số chi nhánh — liên hệ để kích hoạt');
    }

    return this.db.scoped({ userId: user.id, orgId: m.organizationId }, async (tx) => {
      const sub = await tx.subscription.findFirst({ where: { organizationId: m.organizationId, deletedAt: null } });
      const q = await quote(tx, m.organizationId, sub, input, new Date());

      const recent = await tx.paymentIntent.findFirst({
        where: {
          organizationId: m.organizationId,
          status: 'pending',
          amount: q.amount,
          kind: q.kind,
          plan: q.plan,
          months: q.months,
          extraStaff: q.extraStaff,
          deletedAt: null,
          createdAt: { gt: new Date(Date.now() - REUSE_MS) },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (recent) return toView(recent);

      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          // Savepoint: trùng mã chỉ làm hỏng lần thử này, không làm hỏng cả transaction.
          await tx.$executeRaw`savepoint intent_code`;
          const row = await tx.paymentIntent.create({
            data: {
              organizationId: m.organizationId,
              subscriptionId: sub?.id ?? null,
              createdBy: user.id,
              amount: q.amount,
              kind: q.kind,
              plan: q.plan,
              months: q.months,
              extraStaff: q.extraStaff,
              status: 'pending',
              provider: 'vietqr',
              providerRef: newTransferCode(),
            },
          });
          return toView(row);
        } catch (err) {
          if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
          await tx.$executeRaw`rollback to savepoint intent_code`;
        }
      }
      throw new Error('Không sinh được mã chuyển khoản sau 5 lần');
    });
  }
}
