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
 *      Đổi gói (0.28.0, Thương lái ↔ Vựa): ngày ĐÃ TRẢ còn lại quy đổi theo giá (`convertDays`) rồi mới cộng tháng
 *      vừa mua; ngày dùng thử của gói cũ không mang sang. Mua thêm người cân: chỉ cộng `extra_staff`, không đổi hạn.
 *   3. Thông báo + nhật ký — cùng transaction: gói đã mở thì chắc chắn có dấu vết.
 *   4. Lần trả ĐẦU của tổ chức có chủ được giới thiệu → thưởng 1 tháng cho tổ chức này và tổ chức có sổ
 *      của người mời, đúng một lần (`referral_rewarded_at`). Doanh nghiệp đang dùng nhiều chi nhánh hơn
 *      gói mới cho → ghi nhật ký `branch.over_limit` (C2 phương án C: không khoá chi nhánh đang có).
 * Cả các bước trong MỘT transaction: hai lời gọi cùng mã chạy song song thì lời gọi sau đợi khoá
 * chính rồi thấy mã đã có.
 */

import { daysBetween, extendPeriod } from '@mambo/core/subscription';
import { EXTRA_STAFF_MAX, hasBook, type OrgType, type PlanCode, type PlanSummary } from '@mambo/contracts';
import { planCodeOf, planSummary } from '../auth/prisma-memberships';
import type { Tx } from '../db/database';
import type { Subscription as Sub } from '../generated/prisma/client';
import { billingMonthsOf, convertDays, type Purchase } from './pricing';

const DAY_MS = 86_400_000;

export interface Activation {
  readonly organizationId: string;
  readonly purchase: Purchase;
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

  const p = a.purchase;
  let sub =
    p.kind === 'staff'
      ? await addStaff(tx, a.organizationId, p.extraStaff)
      : await extend(tx, a.organizationId, p.months, now, {
          ...(a.branchLimit !== undefined ? { branchLimit: a.branchLimit } : {}),
          ...(p.plan !== undefined ? { plan: p.plan } : {}),
          ...(p.extraStaff !== undefined ? { extraStaff: p.extraStaff } : {}),
          billingMonths: billingMonthsOf(p.months),
        });

  await tx.notification.create({
    data: { organizationId: a.organizationId, kind: 'plan.activated', payload: { periodEnd: iso(sub.currentPeriodEnd) } },
    select: { id: true },
  });
  await tx.auditLog.create({
    data: {
      organizationId: a.organizationId,
      actorUserId: null,
      action: p.kind === 'staff' ? 'plan.staff_added' : 'plan.activated',
      entity: 'subscription',
      entityId: sub.id,
      after: {
        ...(p.kind === 'plan' ? { months: p.months } : {}),
        plan: sub.plan,
        extraStaff: sub.extraStaff,
        periodEnd: iso(sub.currentPeriodEnd),
        source: a.source,
        bankTxId: a.bankTxId,
        amount: a.amount,
      },
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

interface PlanChange {
  readonly branchLimit?: number | null;
  readonly plan?: PlanCode;
  readonly extraStaff?: number;
  readonly billingMonths?: 1 | 12;
}

/** Khoá gói trước khi đọc: thưởng giới thiệu và mua người cân cũng ghi vào hàng này từ transaction khác. */
const lockedSubscription = async (tx: Tx, orgId: string): Promise<Sub | null> => {
  await tx.$executeRaw`select 1 from subscriptions where organization_id = ${orgId}::uuid and deleted_at is null for update`;
  return tx.subscription.findFirst({ where: { organizationId: orgId, deletedAt: null }, orderBy: { createdAt: 'asc' } });
};

/**
 * Đổi gói: ngày đã trả còn lại (chỉ khi đang `premium` — dùng thử, ân hạn không có ngày để quy đổi) đổi sang ngày gói
 * mới theo giá, rồi cộng tháng vừa mua. 10/11, hạn Thương lái 1/12 (21 ngày) → 10 ngày Vựa → 20/11 + 1 tháng = 20/12.
 */
const switchedPeriodEnd = (current: Sub, from: PlanCode, to: PlanCode, months: number, now: Date): Date => {
  const paidEnd = planSummary(current, now)?.tier === 'premium' ? current.currentPeriodEnd : null;
  const paidDays = paidEnd ? daysBetween(now.getTime(), paidEnd.getTime()) : 0;
  const base = new Date(now.getTime() + convertDays(paidDays, from, to) * DAY_MS);
  return new Date(extendPeriod(base.toISOString(), now, months));
};

/**
 * Cộng `months` vào gói của tổ chức (chưa có gói thì tạo) — `extendPeriod` giữ ngày dùng thử còn lại; đổi gói thì
 * quy đổi ngày (`switchedPeriodEnd`). Gói Thương lái không có người cân thêm.
 */
const extend = async (tx: Tx, orgId: string, months: number, now: Date, change: PlanChange = {}): Promise<Sub> => {
  // Khoá gói trước khi đọc ngày hết hạn: thưởng giới thiệu cộng vào gói của NGƯỜI MỜI trong transaction của tổ chức
  // khác — người mời trả tiền cùng lúc thì hai bên đọc cùng một ngày cũ, bên ghi sau xoá mất tháng bên kia vừa cộng.
  const current = await lockedSubscription(tx, orgId);
  const from = current ? planCodeOf(current.plan) : null;
  const periodEnd =
    current && from && change.plan && change.plan !== from
      ? switchedPeriodEnd(current, from, change.plan, months, now)
      : new Date(extendPeriod(current?.currentPeriodEnd?.toISOString(), now, months, current?.trialEndsAt?.toISOString()));
  const data = {
    status: 'active',
    currentPeriodEnd: periodEnd,
    ...change,
    ...((change.plan ?? from) === 'thuong_lai' ? { extraStaff: 0 } : {}),
  };
  return current
    ? tx.subscription.update({ where: { id: current.id }, data })
    : tx.subscription.create({ data: { organizationId: orgId, ...data } });
};

/**
 * Mua thêm người cân giữa kỳ: cộng `extra_staff`, hạn giữ nguyên. Hai lần mua cùng trả song song mà vượt 5 (mỗi lần
 * báo giá đều hợp lệ lúc tạo) → giữ ở 5; tiền thừa đối soát tay qua nhật ký `plan.staff_added`.
 */
const addStaff = async (tx: Tx, orgId: string, extraStaff: number): Promise<Sub> => {
  const current = await lockedSubscription(tx, orgId);
  if (!current) throw new Error('Mua thêm người cân cho tổ chức chưa có gói');
  return tx.subscription.update({
    where: { id: current.id },
    data: { extraStaff: Math.min(EXTRA_STAFF_MAX, current.extraStaff + extraStaff) },
  });
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
