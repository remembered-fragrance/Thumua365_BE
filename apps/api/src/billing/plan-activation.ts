/**
 * Mở / gia hạn gói khi tiền đã vào — dùng chung cho webhook ngân hàng và quản trị viên. Chạy trong
 * transaction của `PrivilegedDatabase` (không có người gọi để đặt ngữ cảnh RLS).
 *
 * Thứ tự là chốt chống cộng tiền hai lần (giữ từ `payment-webhook` của bản cũ):
 *   1. GHI SỔ ĐỐI SOÁT TRƯỚC — `bank_transactions`, khoá chính chính là mã giao dịch ngân hàng.
 *      Mã đã gia hạn (`outcome = 'applied'`) → dừng, không gia hạn (Casso / SePay gọi lại nhiều lần là
 *      chuyện thường). Mã đã ghi mà CHƯA gia hạn (chuyển thiếu…) → quản trị viên mở gói bằng mã đó được.
 *   2. Gia hạn bằng `extendPeriod` của `@mambo/core` — cùng hàm app dùng để hiện ngày hết hạn. Ngày
 *      dùng thử còn lại được giữ: trả tiền giữa kỳ dùng thử thì kỳ trả tiền nối tiếp sau dùng thử.
 *   3. Thông báo + nhật ký — cùng transaction: gói đã mở thì chắc chắn có dấu vết.
 * Cả bốn bước trong MỘT transaction: hai lời gọi cùng mã chạy song song thì lời gọi sau đợi khoá
 * chính rồi thấy mã đã có.
 */

import { extendPeriod } from '@mambo/core/subscription';
import type { PlanSummary } from '@mambo/contracts';
import { planSummary } from '../auth/prisma-memberships';
import type { Tx } from '../db/database';

export interface Activation {
  readonly organizationId: string;
  readonly months: number;
  /** Doanh nghiệp: giới hạn chi nhánh mới; bỏ trống = giữ nguyên. */
  readonly branchLimit?: number | null;
  readonly source: 'webhook' | 'admin';
  readonly bankTxId: string;
  readonly amount: number;
  readonly paymentIntentId?: string | null;
  readonly description?: string | null;
}

/** Gói sau khi gia hạn; `null` khi mã giao dịch ngân hàng ĐÃ được xử lý trước đó. */
export const activatePlan = async (tx: Tx, a: Activation, now: Date): Promise<PlanSummary | null> => {
  const ledger = await tx.$executeRaw`
    insert into bank_transactions (bank_tx_id, organization_id, payment_intent_id, amount, description, source)
    values (${a.bankTxId}, ${a.organizationId}::uuid, ${a.paymentIntentId ?? null}::uuid, ${a.amount}, ${a.description ?? null}, ${a.source})
    on conflict (bank_tx_id) do update
      set outcome = 'applied', organization_id = excluded.organization_id, amount = excluded.amount, source = excluded.source,
          payment_intent_id = coalesce(excluded.payment_intent_id, bank_transactions.payment_intent_id),
          description = coalesce(excluded.description, bank_transactions.description)
      where bank_transactions.outcome <> 'applied'`;
  if (ledger === 0) return null;

  const current = await tx.subscription.findFirst({
    where: { organizationId: a.organizationId, deletedAt: null },
    orderBy: { createdAt: 'asc' },
  });
  const periodEnd = new Date(
    extendPeriod(current?.currentPeriodEnd?.toISOString(), now, a.months, current?.trialEndsAt?.toISOString()),
  );
  const limit = a.branchLimit !== undefined ? { branchLimit: a.branchLimit } : {};
  const sub = current
    ? await tx.subscription.update({ where: { id: current.id }, data: { status: 'active', currentPeriodEnd: periodEnd, ...limit } })
    : await tx.subscription.create({ data: { organizationId: a.organizationId, status: 'active', currentPeriodEnd: periodEnd, ...limit } });

  await tx.notification.create({
    data: { organizationId: a.organizationId, kind: 'plan.activated', payload: { periodEnd: periodEnd.toISOString() } },
    select: { id: true },
  });
  await tx.auditLog.create({
    data: {
      organizationId: a.organizationId,
      actorUserId: null,
      action: 'plan.activated',
      entity: 'subscription',
      entityId: sub.id,
      after: { months: a.months, periodEnd: periodEnd.toISOString(), source: a.source, bankTxId: a.bankTxId, amount: a.amount },
    },
    select: { id: true },
  });

  const plan = planSummary(sub, now);
  if (!plan) throw new Error('Gói vừa gia hạn không đọc lại được');
  return plan;
};
