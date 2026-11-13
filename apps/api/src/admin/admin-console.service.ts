/**
 * Trang quản trị đầy đủ (0.32.0): tổng quan, tổ chức, cờ tính năng, mã sáng lập, người dùng, phản hồi, nhật ký.
 * Đọc qua `api_privileged` (bỏ qua RLS) — chỉ quản trị viên (`ADMIN_USER_IDS`) tới được đây. Xem dữ liệu của một
 * người / một tổ chức, hay đổi gì, đều ghi `admin_access_log` như các route quản trị cũ.
 */

import {
  ADMIN_ACCESS_LOG_MAX,
  ADMIN_FEEDBACK_MAX,
  ADMIN_ORGANIZATION_PAYMENTS,
  ADMIN_ORGANIZATIONS_MAX,
  ADMIN_USER_TIMELINE_MAX,
  ADMIN_USERS_MAX,
  type AdminAccessLog,
  type AdminFeatureInput,
  type AdminFeatures,
  type AdminFeedback,
  type AdminFeedbackQuery,
  type AdminOrganizationDetail,
  type AdminOrganizations,
  type AdminOrganizationsQuery,
  type AdminOverview,
  type AdminPromoCodes,
  type AdminPromoCreateInput,
  type AdminPromoDeleteQuery,
  type AdminPromoRow,
  type AdminUserDetail,
  type AdminUserEvent,
  type AdminUsers,
  type AdminUsersQuery,
  Feature,
  MemberRole,
  MemberStatus,
  OrgType,
  PlanCode,
  type PlanSummary,
  SubscriptionStatus,
} from '@mambo/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { z } from 'zod';
import type { AuthUser } from '../auth/auth-user';
import { planSummary } from '../auth/prisma-memberships';
import { ApiException } from '../common/api-exception';
import { ENV, type Env } from '../config/env';
import type { Tx } from '../db/database';
import { PRIVILEGED_DATABASE, type PrivilegedDatabase, privileged } from '../db/privileged-database';
import type { PromoCode, Subscription } from '../generated/prisma/client';
import { operatorOf } from './admin.service';
import { paymentRows } from './payment-rows';

type FeatureInput = z.output<typeof AdminFeatureInput>;
type PromoInput = z.output<typeof AdminPromoCreateInput>;

const DAY_MS = 86_400_000;
const VN_TZ = 'Asia/Ho_Chi_Minh';

const isFeature = (raw: string): raw is Feature => (Feature.options as readonly string[]).includes(raw);
const featuresOf = (raw: readonly string[]): Feature[] => raw.filter(isFeature).sort();

/** "0905 112 233" → "%905112233%" (số lưu dạng +84…, bỏ số 0 đầu); dưới 3 chữ số → không tìm theo số. */
const phonePattern = (q: string): string | null => {
  const digits = q.replace(/\D/g, '');
  if (digits.length < 3) return null;
  return `%${digits.replace(/^(84|0)/, '')}%`;
};

/** Cột tổ chức đi kèm một dòng truy vấn — `null` khi dòng không gắn tổ chức (hoặc tổ chức đã xoá hẳn). */
interface OrgRow {
  org_id: string | null;
  org_name: string | null;
  org_type: string | null;
}

const orgRef = (r: OrgRow): { id: string; name: string; type: OrgType } | null =>
  r.org_id && r.org_name && r.org_type ? { id: r.org_id, name: r.org_name, type: OrgType.parse(r.org_type) } : null;

/** Việc trong sổ (phiếu, lần trả, địa điểm) — nhóm `work`; việc khác của `audit_log` là nhóm `organization`. */
const WORK_ACTION = /^(receipt|payment|place)\./;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `cursor` = `<created_at UTC đủ micro giây>|<id>` của dòng cuối trang trước. */
const parseUserCursor = (raw: string): { at: string; id: string } => {
  const cut = raw.lastIndexOf('|');
  const at = raw.slice(0, cut);
  const id = raw.slice(cut + 1);
  if (cut <= 0 || !UUID.test(id) || Number.isNaN(Date.parse(at))) {
    throw new ApiException('VALIDATION_FAILED', 'Trang không hợp lệ — tải lại danh sách', { fields: { cursor: 'Không hợp lệ' } });
  }
  return { at, id };
};

/** Ký tự đặc biệt của LIKE trong chữ người dùng gõ thành chữ thường. */
const likePattern = (q: string): string => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** Hàng gói đầu tiên của mỗi tổ chức — đúng hàng `/v1/me` và trang gói đang đọc. */
const firstSubscriptions = async (tx: Tx, organizationIds?: readonly string[]): Promise<Map<string, Subscription>> => {
  const subs = await tx.subscription.findMany({
    where: { deletedAt: null, ...(organizationIds ? { organizationId: { in: [...organizationIds] } } : {}) },
    orderBy: [{ organizationId: 'asc' }, { createdAt: 'asc' }],
    distinct: ['organizationId'],
  });
  return new Map(subs.map((s) => [s.organizationId, s]));
};

const promoRow = (p: PromoCode & { organization: { id: string; name: string; type: string } | null }): AdminPromoRow => ({
  code: p.code,
  plan: PlanCode.parse(p.plan),
  monthlyAmount: p.monthlyAmount,
  periods: p.periods,
  periodsUsed: p.periodsUsed,
  organization: p.organization ? { id: p.organization.id, name: p.organization.name, type: OrgType.parse(p.organization.type) } : null,
  redeemedAt: p.redeemedAt?.toISOString() ?? null,
  note: p.note,
  createdAt: p.createdAt.toISOString(),
});

const promoInclude = { organization: { select: { id: true, name: true, type: true } } } as const;

@Injectable()
export class AdminConsoleService {
  private readonly db: PrivilegedDatabase | null;
  /** Tài khoản quản trị (`ADMIN_USER_IDS`) và tổ chức của họ không tính vào số liệu — chúng không phải khách. */
  private readonly admins: string[];

  constructor(@Inject(PRIVILEGED_DATABASE) db: PrivilegedDatabase | null, @Inject(ENV) env: Env) {
    this.db = db;
    this.admins = env.ADMIN_USER_IDS.map((id) => id.toLowerCase());
  }

  /** Chỉ số đếm, không lộ dữ liệu của ai → không ghi nhật ký. */
  overview(): Promise<AdminOverview> {
    return privileged(this.db).run(async (tx) => {
      const now = new Date();

      const admins = this.admins;
      const orgs = await tx.$queryRaw<{ type: string; total: number; last7: number; last30: number }[]>`
        select type, count(*)::int as total,
               count(*) filter (where created_at >= now() - interval '7 days')::int as last7,
               count(*) filter (where created_at >= now() - interval '30 days')::int as last30
        from organizations
        where deleted_at is null
          and id not in (select organization_id from memberships where user_id = any(${admins}::uuid[]))
        group by type`;
      const organizations = { total: 0, farmer: 0, trader: 0, enterprise: 0 };
      const newOrganizations = { last7Days: 0, last30Days: 0 };
      for (const r of orgs) {
        const type = OrgType.parse(r.type);
        organizations[type] = r.total;
        organizations.total += r.total;
        newOrganizations.last7Days += r.last7;
        newOrganizations.last30Days += r.last30;
      }

      const signups = await tx.$queryRaw<{ date: string; count: number }[]>`
        select to_char(d, 'YYYY-MM-DD') as date, count(o.id)::int as count
        from generate_series((now() at time zone ${VN_TZ})::date - 29, (now() at time zone ${VN_TZ})::date, interval '1 day') d
        left join organizations o on o.deleted_at is null and (o.created_at at time zone ${VN_TZ})::date = d::date
          and o.id not in (select organization_id from memberships where user_id = any(${admins}::uuid[]))
        group by d order by d`;

      // Bậc gói: vựa + doanh nghiệp chưa xoá. Không có hàng gói → coi là hết hạn (free).
      const paying = await tx.organization.findMany({
        where: { deletedAt: null, type: { not: 'farmer' }, memberships: { none: { userId: { in: admins } } } },
        select: { id: true, type: true },
      });
      const subs = await firstSubscriptions(tx, paying.map((o) => o.id));
      const plans = { trial: 0, premium: 0, grace: 0, free: 0 };
      const premiumByPlan = { thuong_lai: 0, vua: 0, enterprise: 0 };
      let expiringSoon = 0;
      for (const org of paying) {
        const plan = planSummary(subs.get(org.id), now);
        const tier = plan?.tier ?? 'free';
        plans[tier] += 1;
        if (plan && tier === 'premium') premiumByPlan[org.type === 'enterprise' ? 'enterprise' : (plan.plan ?? 'vua')] += 1;
        if (plan?.periodEnd && (tier === 'trial' || tier === 'premium') && new Date(plan.periodEnd).getTime() - now.getTime() <= 7 * DAY_MS) {
          expiringSoon += 1;
        }
      }

      const months = await tx.$queryRaw<{ month: string; amount: bigint; count: number }[]>`
        select to_char(created_at at time zone ${VN_TZ}, 'YYYY-MM') as month, sum(amount)::bigint as amount, count(*)::int as count
        from bank_transactions where outcome = 'applied' group by 1 order by 1`;
      const [money] = await tx.$queryRaw<{ total: bigint | null; last30: bigint | null; review: number }[]>`
        select sum(amount) filter (where outcome = 'applied')::bigint as total,
               sum(amount) filter (where outcome = 'applied' and created_at >= now() - interval '30 days')::bigint as last30,
               count(*) filter (where outcome <> 'applied')::int as review
        from bank_transactions`;
      const pendingIntents = await tx.paymentIntent.count({ where: { status: 'pending', deletedAt: null } });
      const [fb] = await tx.$queryRaw<{ count: number; avg: number | null }[]>`
        select count(*)::int as count, round(avg(rating)::numeric, 2)::float8 as avg from feedback`;
      const users = await tx.profile.count({ where: { deletedAt: null, id: { notIn: admins } } });

      return {
        generatedAt: now.toISOString(),
        organizations,
        newOrganizations,
        signupsByDay: signups.map((r) => ({ date: r.date, count: r.count })),
        users,
        plans,
        premiumByPlan,
        expiringSoon,
        revenue: {
          total: Number(money?.total ?? 0),
          last30Days: Number(money?.last30 ?? 0),
          byMonth: months.map((m) => ({ month: m.month, amount: Number(m.amount), count: m.count })),
        },
        payments: { needsReview: money?.review ?? 0, pendingIntents },
        feedback: { count: fb?.count ?? 0, averageRating: fb?.avg ?? null },
      };
    });
  }

  organizations(admin: AuthUser, query: AdminOrganizationsQuery): Promise<AdminOrganizations> {
    const q = query.q ? query.q : null;
    const like = q ? likePattern(q) : null;
    const phone = q ? phonePattern(q) : null;
    return privileged(this.db).run(async (tx) => {
      const rows = await tx.$queryRaw<
        {
          id: string;
          name: string;
          type: string;
          created_at: Date;
          owner_id: string | null;
          owner_name: string | null;
          owner_phone: string | null;
          members: number;
          features: string[];
        }[]
      >`
        select o.id, o.name, o.type, o.created_at,
               ow.user_id as owner_id, p.name as owner_name, p.phone as owner_phone,
               (select count(*)::int from memberships m where m.organization_id = o.id and m.status = 'active') as members,
               coalesce((select array_agg(f.feature) from organization_features f where f.organization_id = o.id), '{}') as features
        from organizations o
        left join lateral (
          select m.user_id from memberships m
          where m.organization_id = o.id and m.role = 'owner' and m.status = 'active'
          order by m.created_at limit 1
        ) ow on true
        left join profiles p on p.id = ow.user_id
        where o.deleted_at is null
          and (${query.type ?? null}::text is null or o.type = ${query.type ?? null})
          and (${q}::text is null or o.name ilike ${like} or p.name ilike ${like} or p.phone like ${phone})
        order by o.created_at desc
        limit ${ADMIN_ORGANIZATIONS_MAX}`;
      const subs = await firstSubscriptions(tx, rows.map((r) => r.id));
      await tx.adminAccessLog.create({
        data: {
          organizationId: null,
          userId: null,
          action: 'list-organizations',
          operator: admin.id,
          reason: [query.type, query.q].filter(Boolean).join(' · ') || null,
        },
        select: { id: true },
      });
      const now = new Date();
      return {
        rows: rows.map((r) => {
          const type = OrgType.parse(r.type);
          return {
            id: r.id,
            name: r.name,
            type,
            createdAt: r.created_at.toISOString(),
            owner: r.owner_id ? { userId: r.owner_id, name: r.owner_name, phone: r.owner_phone } : null,
            members: r.members,
            plan: type === 'farmer' ? null : planSummary(subs.get(r.id), now),
            features: featuresOf(r.features),
          };
        }),
      };
    });
  }

  organization(admin: AuthUser, id: string): Promise<AdminOrganizationDetail> {
    return privileged(this.db).run(async (tx) => {
      const org = await tx.organization.findFirst({
        where: { id, deletedAt: null },
        select: { id: true, name: true, type: true, phone: true, address: true, createdAt: true },
      });
      if (!org) throw new ApiException('NOT_FOUND', 'Không có tổ chức này');
      const type = OrgType.parse(org.type);

      const sub = (await firstSubscriptions(tx, [id])).get(id);
      const members = await tx.$queryRaw<
        {
          user_id: string;
          name: string | null;
          phone: string | null;
          username: string | null;
          role: string;
          status: string;
          branch: string | null;
          created_at: Date;
        }[]
      >`
        select m.user_id, p.name, p.phone, p.username::text as username, m.role, m.status, b.name as branch, m.created_at
        from memberships m
        left join profiles p on p.id = m.user_id
        left join branches b on b.id = m.branch_id
        where m.organization_id = ${id}::uuid
        order by (m.status = 'active') desc, (m.role = 'owner') desc, m.created_at`;
      const features = await tx.organizationFeature.findMany({ where: { organizationId: id }, select: { feature: true } });
      const promo = await tx.promoCode.findUnique({ where: { organizationId: id }, include: promoInclude });
      const [usage] = await tx.$queryRaw<
        { transactions: number; suppliers: number; buyers: number; products: number; orders: number; last_activity: Date | null }[]
      >`
        select (select count(*)::int from transactions where organization_id = ${id}::uuid and deleted_at is null) as transactions,
               (select count(*)::int from suppliers where organization_id = ${id}::uuid and deleted_at is null) as suppliers,
               (select count(*)::int from buyers where organization_id = ${id}::uuid and deleted_at is null) as buyers,
               (select count(*)::int from products where organization_id = ${id}::uuid and deleted_at is null) as products,
               (select count(*)::int from orders where seller_org_id = ${id}::uuid or buyer_org_id = ${id}::uuid) as orders,
               (select max(updated_at) from transactions where organization_id = ${id}::uuid) as last_activity`;
      const payments = await paymentRows(tx, { organizationId: id, limit: ADMIN_ORGANIZATION_PAYMENTS });

      await tx.adminAccessLog.create({
        data: { organizationId: id, userId: null, action: 'view-organization', operator: admin.id, reason: null },
        select: { id: true },
      });

      const plan: PlanSummary | null = type === 'farmer' ? null : planSummary(sub, new Date());
      return {
        id: org.id,
        name: org.name,
        type,
        phone: org.phone,
        address: org.address,
        createdAt: org.createdAt.toISOString(),
        plan,
        subscription: sub
          ? {
              status: SubscriptionStatus.parse(sub.status),
              trialEndsAt: sub.trialEndsAt?.toISOString() ?? null,
              currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
              plan: sub.plan === null ? null : PlanCode.parse(sub.plan),
              extraStaff: sub.extraStaff,
              billingMonths: sub.billingMonths,
              branchLimit: sub.branchLimit,
            }
          : null,
        members: members.map((m) => ({
          userId: m.user_id,
          name: m.name,
          phone: m.phone,
          username: m.username,
          role: MemberRole.parse(m.role),
          status: MemberStatus.parse(m.status),
          branch: m.branch,
          joinedAt: m.created_at.toISOString(),
        })),
        features: featuresOf(features.map((f) => f.feature)),
        promo: promo ? promoRow(promo) : null,
        usage: {
          transactions: usage?.transactions ?? 0,
          suppliers: usage?.suppliers ?? 0,
          buyers: usage?.buyers ?? 0,
          products: usage?.products ?? 0,
          orders: usage?.orders ?? 0,
          lastActivityAt: usage?.last_activity?.toISOString() ?? null,
        },
        payments,
      };
    });
  }

  /** Bật khi đã bật, tắt khi đã tắt → không đổi gì, vẫn ghi nhật ký (người duyệt đã bấm). */
  setFeature(admin: AuthUser, id: string, input: FeatureInput): Promise<AdminFeatures> {
    return privileged(this.db).run(async (tx) => {
      const org = await tx.organization.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
      if (!org) throw new ApiException('NOT_FOUND', 'Không có tổ chức này');
      if (input.enabled) {
        await tx.$executeRaw`
          insert into organization_features (organization_id, feature) values (${id}::uuid, ${input.feature})
          on conflict do nothing`;
      } else {
        await tx.organizationFeature.deleteMany({ where: { organizationId: id, feature: input.feature } });
      }
      await tx.adminAccessLog.create({
        data: {
          organizationId: id,
          userId: null,
          action: 'set-feature',
          operator: operatorOf(admin, input.approvedBy),
          reason: [`${input.feature} ${input.enabled ? 'bật' : 'tắt'}`, input.reason].filter(Boolean).join(' · '),
        },
        select: { id: true },
      });
      const features = await tx.organizationFeature.findMany({ where: { organizationId: id }, select: { feature: true } });
      return { features: featuresOf(features.map((f) => f.feature)) };
    });
  }

  promoCodes(): Promise<AdminPromoCodes> {
    return privileged(this.db).run(async (tx) => ({ rows: await this.listPromo(tx) }));
  }

  createPromo(admin: AuthUser, input: PromoInput): Promise<AdminPromoRow> {
    return privileged(this.db).run(async (tx) => {
      const existing = await tx.promoCode.findUnique({ where: { code: input.code }, select: { code: true } });
      if (existing) throw new ApiException('VALIDATION_FAILED', 'Mã này đã có', { reason: 'PROMO_EXISTS', fields: { code: 'Mã đã có' } });
      const row = await tx.promoCode.create({
        data: { code: input.code, plan: input.plan, monthlyAmount: input.monthlyAmount, periods: input.periods, note: input.note ?? null },
        include: promoInclude,
      });
      await tx.adminAccessLog.create({
        data: {
          organizationId: null,
          userId: null,
          action: 'create-promo',
          operator: operatorOf(admin, input.approvedBy),
          reason: [`${input.code} · ${input.plan} · ${input.monthlyAmount}đ × ${input.periods}`, input.reason].filter(Boolean).join(' · '),
        },
        select: { id: true },
      });
      return promoRow(row);
    });
  }

  deletePromo(admin: AuthUser, code: string, query: AdminPromoDeleteQuery): Promise<AdminPromoCodes> {
    return privileged(this.db).run(async (tx) => {
      const row = await tx.promoCode.findUnique({ where: { code }, select: { organizationId: true } });
      if (!row) throw new ApiException('NOT_FOUND', 'Không có mã này');
      if (row.organizationId) {
        throw new ApiException('VALIDATION_FAILED', 'Mã đã có tổ chức dùng — không xoá được', { reason: 'PROMO_REDEEMED' });
      }
      await tx.promoCode.delete({ where: { code } });
      await tx.adminAccessLog.create({
        data: {
          organizationId: null,
          userId: null,
          action: 'delete-promo',
          operator: operatorOf(admin, query.approvedBy),
          reason: [code, query.reason].filter(Boolean).join(' · '),
        },
        select: { id: true },
      });
      return { rows: await this.listPromo(tx) };
    });
  }

  users(admin: AuthUser, query: AdminUsersQuery): Promise<AdminUsers> {
    const q = query.q ?? null;
    const like = q ? likePattern(q) : null;
    const phone = q ? phonePattern(q) : null;
    const after = query.cursor ? parseUserCursor(query.cursor) : null;
    return privileged(this.db).run(async (tx) => {
      const found = await tx.$queryRaw<
        { id: string; name: string; username: string | null; phone: string | null; verified: boolean; created_at: Date; created_key: string }[]
      >`
        select p.id, p.name, p.username::text as username, p.phone,
               (p.recovery_email is not null and p.recovery_email_verified_at is not null) as verified, p.created_at,
               to_char(p.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_key
        from profiles p
        where p.deleted_at is null
          and (${q}::text is null or p.name ilike ${like} or p.username::text ilike ${like} or p.phone like ${phone})
          and (${after?.at ?? null}::timestamptz is null
               or (p.created_at, p.id) < (${after?.at ?? null}::timestamptz, ${after?.id ?? null}::uuid))
        order by p.created_at desc, p.id desc
        limit ${ADMIN_USERS_MAX + 1}`;
      const people = found.slice(0, ADMIN_USERS_MAX);
      const last = people.at(-1);
      const memberships = await tx.membership.findMany({
        where: { userId: { in: people.map((p) => p.id) }, organization: { deletedAt: null } },
        select: { userId: true, role: true, status: true, organization: { select: { id: true, name: true, type: true } } },
        orderBy: { createdAt: 'asc' },
      });
      await tx.adminAccessLog.create({
        data: { organizationId: null, userId: null, action: q ? 'search-users' : 'list-users', operator: admin.id, reason: q },
        select: { id: true },
      });
      return {
        rows: people.map((p) => ({
          id: p.id,
          name: p.name,
          username: p.username,
          phone: p.phone,
          hasVerifiedRecoveryEmail: p.verified,
          createdAt: p.created_at.toISOString(),
          memberships: memberships
            .filter((m) => m.userId === p.id)
            .map((m) => ({
              organization: { id: m.organization.id, name: m.organization.name, type: OrgType.parse(m.organization.type) },
              role: MemberRole.parse(m.role),
              status: MemberStatus.parse(m.status),
            })),
        })),
        cursor: found.length > ADMIN_USERS_MAX && last ? `${last.created_key}|${last.id}` : null,
      };
    });
  }

  /**
   * Một tài khoản và nhật ký gộp của nó, mới nhất trước. Nguồn: hồ sơ (tạo tài khoản), `memberships` (vào tổ chức),
   * phiếu + lần trả người này đã ghi gộp theo ngày (giờ Việt Nam — số lượng, không kèm tiền), `audit_log` (việc người này
   * làm, và việc người khác làm với chỗ của người này trong tổ chức), `admin_access_log` (trừ các lần chỉ xem).
   */
  user(admin: AuthUser, id: string): Promise<AdminUserDetail> {
    const take = ADMIN_USER_TIMELINE_MAX + 1;
    return privileged(this.db).run(async (tx) => {
      const [person] = await tx.$queryRaw<
        { id: string; name: string; username: string | null; phone: string | null; verified: boolean; created_at: Date }[]
      >`
        select p.id, p.name, p.username::text as username, p.phone,
               (p.recovery_email is not null and p.recovery_email_verified_at is not null) as verified, p.created_at
        from profiles p
        where p.id = ${id}::uuid and p.deleted_at is null`;
      if (!person) throw new ApiException('NOT_FOUND', 'Không có tài khoản này');

      const memberships = await tx.$queryRaw<
        (OrgRow & {
          role: string;
          status: string;
          branch: string | null;
          created_at: Date;
          receipts: number;
          payments: number;
          last_activity: Date | null;
        })[]
      >`
        select o.id as org_id, o.name as org_name, o.type as org_type, m.role, m.status, b.name as branch, m.created_at,
               (select count(*)::int from transactions t
                 where t.organization_id = o.id and t.created_by = m.user_id and t.deleted_at is null) as receipts,
               (select count(*)::int from payments pa
                 where pa.organization_id = o.id and pa.created_by = m.user_id and pa.deleted_at is null) as payments,
               greatest(
                 (select max(t.created_at) from transactions t
                   where t.organization_id = o.id and t.created_by = m.user_id and t.deleted_at is null),
                 (select max(pa.created_at) from payments pa
                   where pa.organization_id = o.id and pa.created_by = m.user_id and pa.deleted_at is null)
               ) as last_activity
        from memberships m
        join organizations o on o.id = m.organization_id and o.deleted_at is null
        left join branches b on b.id = m.branch_id
        where m.user_id = ${id}::uuid
        order by (m.status = 'active') desc, m.created_at`;

      const workDays = await tx.$queryRaw<(OrgRow & { receipts: number; payments: number; last_at: Date })[]>`
        select o.id as org_id, o.name as org_name, o.type as org_type,
               sum(w.receipts)::int as receipts, sum(w.payments)::int as payments, max(w.last_at) as last_at
        from (
          select organization_id, (created_at at time zone ${VN_TZ})::date as d, count(*) as receipts, 0::bigint as payments,
                 max(created_at) as last_at
          from transactions where created_by = ${id}::uuid and deleted_at is null group by 1, 2
          union all
          select organization_id, (created_at at time zone ${VN_TZ})::date, 0::bigint, count(*), max(created_at)
          from payments where created_by = ${id}::uuid and deleted_at is null group by 1, 2
        ) w
        left join organizations o on o.id = w.organization_id
        group by o.id, o.name, o.type, w.organization_id, w.d
        order by max(w.last_at) desc
        limit ${take}`;

      const audits = await tx.$queryRaw<
        (OrgRow & { created_at: Date; action: string; before: unknown; after: unknown; actor_user_id: string | null; actor_name: string | null })[]
      >`
        select a.created_at, a.action, a.before, a.after, a.actor_user_id, ap.name as actor_name,
               o.id as org_id, o.name as org_name, o.type as org_type
        from audit_log a
        left join organizations o on o.id = a.organization_id
        left join profiles ap on ap.id = a.actor_user_id
        where a.actor_user_id = ${id}::uuid
           or (a.entity = 'membership' and a.entity_id in (select m.id::text from memberships m where m.user_id = ${id}::uuid))
        order by a.created_at desc
        limit ${take}`;

      const adminActs = await tx.$queryRaw<(OrgRow & { created_at: Date; action: string; operator: string; reason: string | null })[]>`
        select l.created_at, l.action, l.operator, l.reason, o.id as org_id, o.name as org_name, o.type as org_type
        from admin_access_log l
        left join organizations o on o.id = l.organization_id
        where l.user_id = ${id}::uuid and l.action <> 'view-user'
        order by l.created_at desc
        limit ${take}`;

      await tx.adminAccessLog.create({
        data: { organizationId: null, userId: id, action: 'view-user', operator: admin.id, reason: null },
        select: { id: true },
      });

      const events: AdminUserEvent[] = [
        {
          at: person.created_at.toISOString(),
          kind: 'account' as const,
          action: 'account.created',
          organization: null,
          actor: null,
          before: null,
          after: null,
        },
        ...memberships.map((m): AdminUserEvent => ({
          at: m.created_at.toISOString(),
          kind: 'organization',
          action: 'membership.joined',
          organization: orgRef(m),
          actor: null,
          before: null,
          after: { role: m.role },
        })),
        ...workDays.map((w): AdminUserEvent => ({
          at: w.last_at.toISOString(),
          kind: 'work',
          action: 'work.day',
          organization: orgRef(w),
          actor: null,
          before: null,
          after: { receipts: w.receipts, payments: w.payments },
        })),
        ...audits.map((a): AdminUserEvent => ({
          at: a.created_at.toISOString(),
          kind: WORK_ACTION.test(a.action) ? 'work' : 'organization',
          action: a.action,
          organization: orgRef(a),
          actor: a.actor_user_id === id ? null : (a.actor_name ?? 'Máy chủ'),
          before: a.before ?? null,
          after: a.after ?? null,
        })),
        ...adminActs.map((l): AdminUserEvent => ({
          at: l.created_at.toISOString(),
          kind: 'admin',
          action: l.action,
          organization: orgRef(l),
          actor: l.operator,
          before: null,
          after: l.reason ? { reason: l.reason } : null,
        })),
      ].sort((x, y) => y.at.localeCompare(x.at));

      return {
        id: person.id,
        name: person.name,
        username: person.username,
        phone: person.phone,
        hasVerifiedRecoveryEmail: person.verified,
        createdAt: person.created_at.toISOString(),
        memberships: memberships.flatMap((m) => {
          const organization = orgRef(m);
          return organization
            ? [
                {
                  organization,
                  role: MemberRole.parse(m.role),
                  status: MemberStatus.parse(m.status),
                  branch: m.branch,
                  joinedAt: m.created_at.toISOString(),
                  receipts: m.receipts,
                  payments: m.payments,
                  lastActivityAt: m.last_activity?.toISOString() ?? null,
                },
              ]
            : [];
        }),
        timeline: events.slice(0, ADMIN_USER_TIMELINE_MAX),
        timelineTruncated: events.length > ADMIN_USER_TIMELINE_MAX,
      };
    });
  }

  feedback(admin: AuthUser, query: AdminFeedbackQuery): Promise<AdminFeedback> {
    const from = new Date(query.from);
    const to = new Date(query.to);
    return privileged(this.db).run(async (tx) => {
      const rows = await tx.$queryRaw<
        {
          id: string;
          created_at: Date;
          rating: number;
          comment: string | null;
          app_version: string | null;
          platform: string;
          org_id: string | null;
          org_name: string | null;
          org_type: string | null;
          user_name: string | null;
          user_phone: string | null;
        }[]
      >`
        select f.id, f.created_at, f.rating, f.comment, f.app_version, f.platform,
               o.id as org_id, o.name as org_name, o.type as org_type, p.name as user_name, p.phone as user_phone
        from feedback f
        left join organizations o on o.id = f.organization_id and o.deleted_at is null
        left join profiles p on p.id = f.user_id and p.deleted_at is null
        where f.created_at >= ${from} and f.created_at < ${to}
        order by f.created_at desc
        limit ${ADMIN_FEEDBACK_MAX}`;
      await tx.adminAccessLog.create({
        data: { organizationId: null, userId: null, action: 'list-feedback', operator: admin.id, reason: `${query.from} → ${query.to}` },
        select: { id: true },
      });
      return {
        from: from.toISOString(),
        to: to.toISOString(),
        rows: rows.map((r) => ({
          id: r.id,
          createdAt: r.created_at.toISOString(),
          rating: r.rating,
          comment: r.comment,
          appVersion: r.app_version,
          platform: r.platform,
          organization: r.org_id && r.org_name && r.org_type ? { id: r.org_id, name: r.org_name, type: OrgType.parse(r.org_type) } : null,
          user: r.user_name ? { name: r.user_name, phone: r.user_phone } : null,
        })),
      };
    });
  }

  /** Đọc chính nhật ký — không ghi thêm dòng nào. */
  accessLog(): Promise<AdminAccessLog> {
    return privileged(this.db).run(async (tx) => {
      const rows = await tx.$queryRaw<
        {
          id: string;
          created_at: Date;
          action: string;
          operator: string;
          reason: string | null;
          org_id: string | null;
          org_name: string | null;
          user_id: string | null;
        }[]
      >`
        select l.id, l.created_at, l.action, l.operator, l.reason, o.id as org_id, o.name as org_name, l.user_id
        from admin_access_log l
        left join organizations o on o.id = l.organization_id
        order by l.created_at desc
        limit ${ADMIN_ACCESS_LOG_MAX}`;
      return {
        rows: rows.map((r) => ({
          id: r.id,
          createdAt: r.created_at.toISOString(),
          action: r.action,
          operator: r.operator,
          reason: r.reason,
          organization: r.org_id && r.org_name ? { id: r.org_id, name: r.org_name } : null,
          userId: r.user_id,
        })),
      };
    });
  }

  private async listPromo(tx: Tx): Promise<AdminPromoRow[]> {
    const rows = await tx.promoCode.findMany({ include: promoInclude, orderBy: [{ createdAt: 'desc' }, { code: 'asc' }] });
    return rows.map(promoRow);
  }
}
