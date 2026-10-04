/**
 * Quản trị — KH backend §6, BE6. Thay hai script `admin-activate.ts`, `admin-reset-password.ts`
 * của bản cũ. Chỉ quản trị viên (`ADMIN_USER_IDS`) gọi được; mỗi lần chạm dữ liệu người dùng ghi
 * một dòng `admin_access_log` với NGƯỜI DUYỆT gõ tay — là thứ làm câu "quản trị viên chỉ truy cập
 * khi được yêu cầu, có ghi nhận" trên trang Quyền riêng tư thành thật.
 */

import { normalizePhone } from '@mambo/core/identifier';
import type {
  AdminActivatePlanInput,
  AdminActivatePlanResult,
  AdminFunnel,
  AdminFunnelQuery,
  AdminResetPasswordInput,
} from '@mambo/contracts';
import { OrgType } from '@mambo/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { z } from 'zod';
import type { AuthUser } from '../auth/auth-user';
import { planSummary } from '../auth/prisma-memberships';
import { SUPABASE_ADMIN, type SupabaseAdmin } from '../auth/supabase-admin';
import { activatePlan } from '../billing/plan-activation';
import { ApiException } from '../common/api-exception';
import type { Tx } from '../db/database';
import { PRIVILEGED_DATABASE, type PrivilegedDatabase, privileged } from '../db/privileged-database';
import { DomainEvents } from '../events/domain-events';

type ActivateInput = z.output<typeof AdminActivatePlanInput>;
type ResetInput = z.output<typeof AdminResetPasswordInput>;

const phoneOrFail = (raw: string, field: string): string => {
  const phone = normalizePhone(raw);
  if (!phone) throw new ApiException('VALIDATION_FAILED', 'Số điện thoại chưa đúng', { fields: { [field]: 'Số điện thoại chưa đúng' } });
  return phone;
};

const userByPhone = async (tx: Tx, phone: string): Promise<string | null> =>
  (await tx.$queryRaw<{ id: string | null }[]>`select public.find_login_user(${phone}) as id`)[0]?.id ?? null;

/** Người duyệt + tài khoản quản trị đã bấm — cả hai vào nhật ký. */
const operatorOf = (admin: AuthUser, approvedBy: string): string => `${approvedBy} · qua ${admin.id}`;

@Injectable()
export class AdminService {
  private readonly db: PrivilegedDatabase | null;
  private readonly auth: SupabaseAdmin;
  private readonly events: DomainEvents;

  constructor(@Inject(PRIVILEGED_DATABASE) db: PrivilegedDatabase | null, @Inject(SUPABASE_ADMIN) auth: SupabaseAdmin, events: DomainEvents) {
    this.db = db;
    this.auth = auth;
    this.events = events;
  }

  /** Gọi lại cùng mã giao dịch → `alreadyProcessed`, không cộng thêm kỳ nào. */
  async activatePlan(admin: AuthUser, input: ActivateInput): Promise<AdminActivatePlanResult> {
    const result = await privileged(this.db).run(async (tx) => {
      const org = await this.findOrganization(tx, input);
      if (org.type === 'farmer') {
        throw new ApiException('VALIDATION_FAILED', 'Nông dân dùng miễn phí — không có gói', { fields: { organizationId: 'Tổ chức nông dân' } });
      }
      const now = new Date();
      const activated = await activatePlan(
        tx,
        {
          organizationId: org.id,
          months: input.months,
          ...(input.branchLimit !== undefined ? { branchLimit: input.branchLimit } : {}),
          source: 'admin',
          bankTxId: input.bankTxId,
          amount: input.amount,
          description: input.reason ?? null,
        },
        now,
      );
      await tx.adminAccessLog.create({
        data: {
          organizationId: org.id,
          userId: null,
          action: 'activate-plan',
          operator: operatorOf(admin, input.approvedBy),
          reason: input.reason ?? `${input.months} tháng · ${input.amount}đ · ${input.bankTxId}`,
        },
        select: { id: true },
      });
      const plan =
        activated ??
        planSummary(
          (await tx.subscription.findFirst({ where: { organizationId: org.id, deletedAt: null }, orderBy: { createdAt: 'asc' } })) ?? undefined,
          now,
        );
      if (!plan) throw new Error('Tổ chức chưa có gói dù mã giao dịch đã xử lý');
      return {
        organization: { id: org.id, name: org.name, type: OrgType.parse(org.type) },
        plan,
        alreadyProcessed: activated === null,
      };
    });
    if (!result.alreadyProcessed) {
      this.events.emit('plan.activated', { organizationId: result.organization.id, months: input.months, source: 'admin' });
    }
    return result;
  }

  /**
   * Chỉ cho người KHÔNG khai email khôi phục — có email thì họ tự đặt lại được. Nhật ký ghi trong
   * transaction, đổi mật khẩu ngay trước commit: Auth hỏng thì nhật ký rollback theo.
   */
  async resetPassword(admin: AuthUser, input: ResetInput): Promise<{ ok: true }> {
    const phone = phoneOrFail(input.phone, 'phone');
    await privileged(this.db).run(async (tx) => {
      const userId = await userByPhone(tx, phone);
      if (!userId) throw new ApiException('NOT_FOUND', 'Không có tài khoản với số này');
      const profile = await tx.profile.findUnique({ where: { id: userId }, select: { recoveryEmail: true } });
      if (profile?.recoveryEmail) {
        throw new ApiException('VALIDATION_FAILED', 'Người này có email khôi phục — tự đặt lại mật khẩu được', {
          reason: 'HAS_RECOVERY_EMAIL',
        });
      }
      await tx.adminAccessLog.create({
        data: { organizationId: null, userId, action: 'reset-password', operator: operatorOf(admin, input.approvedBy), reason: input.reason ?? null },
        select: { id: true },
      });
      await this.auth.setPassword(userId, input.newPassword);
    });
    return { ok: true };
  }

  /** Phễu đo lường theo loại tổ chức (BE9) — đọc `analytics_events`, bảng api_service không đọc được. */
  funnel(query: AdminFunnelQuery): Promise<AdminFunnel> {
    return privileged(this.db).run(async (tx) => {
      const rows = await tx.$queryRaw<
        { org_type: string | null; name: string; events: number; organizations: number; devices: number; first_at: Date; last_at: Date }[]
      >`
        select org_type, name, count(*)::int as events,
               count(distinct organization_id)::int as organizations,
               count(distinct anon_id)::int as devices,
               min(created_at) as first_at, max(created_at) as last_at
        from analytics_events
        where created_at >= ${new Date(query.from)} and created_at < ${new Date(query.to)}
        group by org_type, name
        order by min(created_at), name`;
      return {
        from: new Date(query.from).toISOString(),
        to: new Date(query.to).toISOString(),
        rows: rows.map((r) => ({
          orgType: r.org_type ? OrgType.parse(r.org_type) : null,
          name: r.name,
          events: r.events,
          organizations: r.organizations,
          devices: r.devices,
          firstAt: r.first_at.toISOString(),
          lastAt: r.last_at.toISOString(),
        })),
      };
    });
  }

  /** Theo id, hoặc theo số của CHỦ — chỉ khi người đó chủ đúng một tổ chức (không đoán hộ). */
  private async findOrganization(tx: Tx, input: ActivateInput) {
    const select = { id: true, name: true, type: true } as const;
    if (input.organizationId) {
      const org = await tx.organization.findFirst({ where: { id: input.organizationId, deletedAt: null }, select });
      if (!org) throw new ApiException('NOT_FOUND', 'Không có tổ chức này');
      return org;
    }
    const userId = await userByPhone(tx, phoneOrFail(input.ownerPhone ?? '', 'ownerPhone'));
    if (!userId) throw new ApiException('NOT_FOUND', 'Không có tài khoản với số này');
    const owned = await tx.membership.findMany({
      where: { userId, role: 'owner', status: 'active', organization: { deletedAt: null, type: { not: 'farmer' } } },
      select: { organization: { select } },
    });
    if (owned.length === 0) throw new ApiException('NOT_FOUND', 'Số này không chủ tổ chức nào có gói');
    if (owned.length > 1) {
      throw new ApiException('VALIDATION_FAILED', 'Số này chủ nhiều tổ chức — gửi organizationId', {
        organizations: owned.map((o) => ({ id: o.organization.id, name: o.organization.name })),
      });
    }
    const [only] = owned;
    if (!only) throw new ApiException('NOT_FOUND', 'Không có tổ chức này');
    return only.organization;
  }
}
