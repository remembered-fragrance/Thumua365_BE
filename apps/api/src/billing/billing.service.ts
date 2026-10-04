/**
 * Gói và ý định thanh toán — KH backend §1.7, BE6. Đọc / ghi qua RLS như thường (`org_rows`).
 *
 * Tầng này KHÔNG mở được gói: chỉ webhook ngân hàng và quản trị viên làm việc đó (role
 * `api_privileged`). Ý định thanh toán chỉ là "tôi định chuyển khoản số tiền này, với mã này".
 */

import { newTransferCode, transferContent } from '@mambo/core/transferCode';
import { type PaymentIntentCreateInput, PaymentIntentStatus, type PaymentIntentView, type SubscriptionView } from '@mambo/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { z } from 'zod';
import type { AuthUser } from '../auth/auth-user';
import type { MembershipContext } from '../auth/membership';
import { planSummary } from '../auth/prisma-memberships';
import { ApiException } from '../common/api-exception';
import { monthsForAmount, PLAN_PRICES } from '../config/plans';
import { DATABASE, type Database } from '../db/database';
import { Prisma, type PaymentIntent } from '../generated/prisma/client';

const HISTORY = 12;
/** Ý định đang chờ cùng số tiền, tạo trong khoảng này → trả lại nó, không sinh mã mới. */
const REUSE_MS = 24 * 60 * 60 * 1000;

const toView = (row: PaymentIntent): PaymentIntentView => {
  const code = row.providerRef ?? '';
  return {
    id: row.id,
    amount: Number(row.amount),
    months: monthsForAmount(Number(row.amount)) ?? 1,
    code,
    transferContent: transferContent(code),
    status: PaymentIntentStatus.parse(row.status),
    createdAt: row.createdAt.toISOString(),
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
      const selfServe = m.orgType === 'trader';
      return {
        plan: m.orgType === 'farmer' ? null : planSummary(sub ?? undefined, new Date()),
        trialEndsAt: sub?.trialEndsAt?.toISOString() ?? null,
        currentPeriodEnd: sub?.currentPeriodEnd?.toISOString() ?? null,
        selfServe,
        prices: selfServe ? PLAN_PRICES.map((p) => ({ months: p.months, amount: p.amount })) : [],
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

  /** Chỉ chủ VỰA tự mua; mã trùng một mã đang chờ (index duy nhất) thì sinh lại — tối đa 5 lần. */
  async createIntent(user: AuthUser, m: MembershipContext, input: z.output<typeof PaymentIntentCreateInput>): Promise<PaymentIntentView> {
    if (m.orgType === 'farmer') throw new ApiException('FORBIDDEN', 'Nông dân dùng miễn phí — không có gói để mua');
    if (m.orgType === 'enterprise') {
      throw new ApiException('FORBIDDEN', 'Gói doanh nghiệp tính theo số chi nhánh — liên hệ để kích hoạt');
    }
    const price = PLAN_PRICES.find((p) => p.months === input.months);
    if (!price) throw new ApiException('VALIDATION_FAILED', 'Không có gói này', { fields: { months: 'Chọn 1 hoặc 12 tháng' } });

    return this.db.scoped({ userId: user.id, orgId: m.organizationId }, async (tx) => {
      const recent = await tx.paymentIntent.findFirst({
        where: {
          organizationId: m.organizationId,
          status: 'pending',
          amount: price.amount,
          deletedAt: null,
          createdAt: { gt: new Date(Date.now() - REUSE_MS) },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (recent) return toView(recent);

      const sub = await tx.subscription.findFirst({ where: { organizationId: m.organizationId, deletedAt: null }, select: { id: true } });
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          // Savepoint: trùng mã chỉ làm hỏng lần thử này, không làm hỏng cả transaction.
          await tx.$executeRaw`savepoint intent_code`;
          const row = await tx.paymentIntent.create({
            data: {
              organizationId: m.organizationId,
              subscriptionId: sub?.id ?? null,
              createdBy: user.id,
              amount: price.amount,
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
