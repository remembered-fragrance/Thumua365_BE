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
 *   4. Lần trả ĐẦU của tổ chức có chủ được giới thiệu → thưởng 1 tháng cho tổ chức này và tổ chức có sổ
 *      của người mời, đúng một lần (`referral_rewarded_at`). Doanh nghiệp đang dùng nhiều chi nhánh hơn
 *      gói mới cho → ghi nhật ký `branch.over_limit` (C2 phương án C: không khoá chi nhánh đang có).
 * Cả các bước trong MỘT transaction: hai lời gọi cùng mã chạy song song thì lời gọi sau đợi khoá
 * chính rồi thấy mã đã có.
 */

import { extendPeriod } from '@mambo/core/subscription';
import { hasBook, type OrgType, type PlanSummary } from '@mambo/contracts';
import { planSummary } from '../auth/prisma-memberships';
import type { Tx } from '../db/database';
import type { Subscription as Sub } from '../generated/prisma/client';

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

  const limit = a.branchLimit !== undefined ? { branchLimit: a.branchLimit } : {};
  let sub = await extend(tx, a.organizationId, a.months, now, limit);

  await tx.notification.create({
    data: { organizationId: a.organizationId, kind: 'plan.activated', payload: { periodEnd: iso(sub.currentPeriodEnd) } },
    select: { id: true },
  });
  await tx.auditLog.create({
    data: {
      organizationId: a.organizationId,
      actorUserId: null,
      action: 'plan.activated',
      entity: 'subscription',
      entityId: sub.id,
      after: { months: a.months, periodEnd: iso(sub.currentPeriodEnd), source: a.source, bankTxId: a.bankTxId, amount: a.amount },
    },
    select: { id: true },
  });

  sub = (await rewardReferral(tx, a.organizationId, sub, now)) ?? sub;
  await auditOverLimit(tx, a.organizationId, sub.branchLimit);

  const plan = planSummary(sub, now);
  if (!plan) throw new Error('Gói vừa gia hạn không đọc lại được');
  return plan;
};

const iso = (d: Date | null): string | null => d?.toISOString() ?? null;

/** Cộng `months` vào gói của tổ chức (chưa có gói thì tạo) — `extendPeriod` giữ ngày dùng thử còn lại. */
const extend = async (tx: Tx, orgId: string, months: number, now: Date, extra: { branchLimit?: number | null } = {}): Promise<Sub> => {
  const current = await tx.subscription.findFirst({
    where: { organizationId: orgId, deletedAt: null },
    orderBy: { createdAt: 'asc' },
  });
  const periodEnd = new Date(
    extendPeriod(current?.currentPeriodEnd?.toISOString(), now, months, current?.trialEndsAt?.toISOString()),
  );
  return current
    ? tx.subscription.update({ where: { id: current.id }, data: { status: 'active', currentPeriodEnd: periodEnd, ...extra } })
    : tx.subscription.create({ data: { organizationId: orgId, status: 'active', currentPeriodEnd: periodEnd, ...extra } });
};

const REFERRAL_MONTHS = 1;

/**
 * Thưởng giới thiệu. Chỉ khi: đây là lần trả đầu của tổ chức (một dòng `bank_transactions` đã áp — dòng
 * vừa ghi), chủ tổ chức có `referred_by`, và gói chưa từng được thưởng. Người mời không có sổ nào (chỉ là
 * nông dân, hoặc đã xoá tài khoản) thì chỉ bên được giới thiệu nhận. Trả về gói đã cộng, hoặc `null`.
 */
const rewardReferral = async (tx: Tx, orgId: string, sub: Sub, now: Date): Promise<Sub | null> => {
  if (sub.referralRewardedAt) return null;
  const paid = await tx.bankTransaction.count({ where: { organizationId: orgId, outcome: 'applied' } });
  if (paid !== 1) return null;
  const owner = await tx.membership.findFirst({
    where: { organizationId: orgId, role: 'owner', status: 'active' },
    select: { userId: true },
  });
  const profile = owner && (await tx.profile.findUnique({ where: { id: owner.userId }, select: { referredBy: true } }));
  if (!profile?.referredBy) return null;

  await extend(tx, orgId, REFERRAL_MONTHS, now);
  const rewarded = await tx.subscription.update({ where: { id: sub.id }, data: { referralRewardedAt: now } });
  await bonusTrail(tx, orgId, rewarded, { role: 'referred', inviterId: profile.referredBy });

  const inviterOrgs = await tx.organization.findMany({
    where: { deletedAt: null, memberships: { some: { userId: profile.referredBy, role: 'owner', status: 'active' } } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, type: true },
  });
  const inviterOrg = inviterOrgs.find((o) => hasBook(o.type as OrgType) && o.id !== orgId);
  if (inviterOrg) {
    const inviterSub = await extend(tx, inviterOrg.id, REFERRAL_MONTHS, now);
    await bonusTrail(tx, inviterOrg.id, inviterSub, { role: 'inviter', referredOrgId: orgId });
  }
  return rewarded;
};

/** Thông báo dùng lại loại `plan.activated` (app cũ đã hiểu) + nhật ký `plan.referral_bonus`. */
const bonusTrail = async (tx: Tx, orgId: string, sub: Sub, detail: Record<string, string>): Promise<void> => {
  await tx.notification.create({
    data: { organizationId: orgId, kind: 'plan.activated', payload: { periodEnd: iso(sub.currentPeriodEnd) } },
    select: { id: true },
  });
  await tx.auditLog.create({
    data: {
      organizationId: orgId,
      actorUserId: null,
      action: 'plan.referral_bonus',
      entity: 'subscription',
      entityId: sub.id,
      after: { months: REFERRAL_MONTHS, periodEnd: iso(sub.currentPeriodEnd), ...detail },
    },
    select: { id: true },
  });
};

/** C2 phương án C: gói mới cho ít chi nhánh hơn số đang dùng → không khoá gì, chỉ ghi lại để đối soát. */
const auditOverLimit = async (tx: Tx, orgId: string, limit: number | null): Promise<void> => {
  if (limit === null) return;
  const used = await tx.branch.count({ where: { organizationId: orgId, deletedAt: null } });
  if (used <= limit) return;
  await tx.auditLog.create({
    data: { organizationId: orgId, actorUserId: null, action: 'branch.over_limit', entity: 'subscription', after: { used, limit } },
    select: { id: true },
  });
};
