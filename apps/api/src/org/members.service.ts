/**
 * Người trong tổ chức — KH backend §6, BE7. Hợp đồng: `@mambo/contracts/org`.
 *
 * Chủ tạo tài khoản cho nhân viên: tài khoản Supabase (Auth Admin API, email đăng nhập nội bộ từ số
 * điện thoại) → membership + hồ sơ trong CÙNG transaction. Bước database hỏng thì xoá tài khoản vừa
 * tạo, để lần thử lại không vấp "số đã có tài khoản". Tên/số của người khác chỉ đọc qua hàm
 * `org_members()`; trigger `memberships_guard` chặn mọi đường làm thay đổi vai trò `owner`.
 */

import { normalizePhone } from '@mambo/core/identifier';
import {
  type AssignableRole,
  MemberRole,
  MemberStatus,
  type OrgMember,
  type OrgMemberCreateInput,
  type OrgMemberPatch,
  type OrgType,
} from '@mambo/contracts';
import { Inject, Injectable } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import type { Logger } from 'winston';
import type { z } from 'zod';
import { type AuditAction, recordAudit } from '../audit/audit';
import type { AuthUser } from '../auth/auth-user';
import { internalEmailOf } from '../auth/login-email';
import type { MembershipContext } from '../auth/membership';
import { SUPABASE_ADMIN, type SupabaseAdmin } from '../auth/supabase-admin';
import { ApiException } from '../common/api-exception';
import { DATABASE, type Database, type Tx } from '../db/database';
import { LOGGER } from '../events/domain-events';
import type { Prisma } from '../generated/prisma/client';

type CreateInput = z.output<typeof OrgMemberCreateInput>;
type PatchInput = z.output<typeof OrgMemberPatch>;

interface MemberRow {
  id: string;
  user_id: string;
  role: string;
  status: string;
  branch_id: string | null;
  branch_name: string | null;
  name: string | null;
  phone: string | null;
  created_at: Date;
}

/** Vựa chỉ có chủ và người cân; doanh nghiệp có thêm quản lý (ma trận §1.6). */
const ASSIGNABLE: Readonly<Record<OrgType, readonly AssignableRole[]>> = {
  farmer: [],
  trader: ['staff'],
  enterprise: ['manager', 'staff'],
};

const toMember = (row: MemberRow, me: string): OrgMember => ({
  id: row.id,
  userId: row.user_id,
  name: row.name,
  phone: row.phone,
  role: MemberRole.parse(row.role),
  branch: row.branch_id && row.branch_name ? { id: row.branch_id, name: row.branch_name } : null,
  status: MemberStatus.parse(row.status),
  isMe: row.user_id === me,
  createdAt: row.created_at.toISOString(),
});

const accountExists = (): ApiException =>
  new ApiException('VALIDATION_FAILED', 'Số này đã có tài khoản ở nơi khác — chưa thêm được người có sẵn tài khoản', {
    reason: 'ACCOUNT_EXISTS',
    fields: { phone: 'Số này đã có tài khoản' },
  });

const notFound = (): ApiException => new ApiException('NOT_FOUND', 'Không có người này trong tổ chức');

const assertRole = (orgType: OrgType, role: AssignableRole): void => {
  if (!ASSIGNABLE[orgType].includes(role)) {
    throw new ApiException('VALIDATION_FAILED', 'Vai trò này không có ở loại tổ chức của bạn', {
      fields: { role: `Chọn một trong: ${ASSIGNABLE[orgType].join(', ') || '(không có)'}` },
    });
  }
};

/** Chi nhánh còn dùng của CHÍNH tổ chức này. */
const assertBranch = async (tx: Tx, orgId: string, branchId: string | null | undefined): Promise<void> => {
  if (!branchId) return;
  const branch = await tx.branch.findFirst({ where: { id: branchId, organizationId: orgId, deletedAt: null }, select: { id: true } });
  if (!branch) {
    throw new ApiException('VALIDATION_FAILED', 'Không có chi nhánh này, hoặc chi nhánh đã lưu trữ', {
      fields: { branchId: 'Không có chi nhánh này' },
    });
  }
};

const findMember = async (tx: Tx, id: string, me: string): Promise<OrgMember> => {
  const row = (await tx.$queryRaw<MemberRow[]>`select * from public.org_members()`).find((r) => r.id === id);
  if (!row) throw notFound();
  return toMember(row, me);
};

@Injectable()
export class MembersService {
  private readonly db: Database;
  private readonly admin: SupabaseAdmin;
  private readonly logger: Logger;

  constructor(@Inject(DATABASE) db: Database, @Inject(SUPABASE_ADMIN) admin: SupabaseAdmin, @Inject(LOGGER) logger: Logger) {
    this.db = db;
    this.admin = admin;
    this.logger = logger;
  }

  async list(user: AuthUser, m: MembershipContext): Promise<OrgMember[]> {
    const rows = await this.db.scoped({ userId: user.id, orgId: m.organizationId }, (tx) =>
      tx.$queryRaw<MemberRow[]>`select * from public.org_members()`,
    );
    return rows.map((r) => toMember(r, user.id));
  }

  async create(user: AuthUser, m: MembershipContext, input: CreateInput, requestId: string): Promise<OrgMember> {
    assertRole(m.orgType, input.role);
    const phone = normalizePhone(input.phone);
    if (!phone) {
      throw new ApiException('VALIDATION_FAILED', 'Số điện thoại Việt Nam chưa đúng', { fields: { phone: 'Số điện thoại chưa đúng' } });
    }
    const scope = { userId: user.id, orgId: m.organizationId };

    const existing = await this.db.scoped(scope, async (tx) => {
      await assertBranch(tx, m.organizationId, input.branchId);
      const rows = await tx.$queryRaw<{ id: string | null }[]>`select public.find_login_user(${phone}) as id`;
      return rows[0]?.id ?? null;
    });
    if (existing) return this.reactivate(user, m, existing, input, requestId);

    const created = await this.admin.createUser({ email: internalEmailOf(phone), password: input.password, name: input.name });
    if (created === 'exists') throw accountExists();

    try {
      return await this.db.scoped(scope, async (tx) => {
        const membership = await tx.membership.create({
          data: {
            userId: created.id,
            organizationId: m.organizationId,
            role: input.role,
            branchId: input.branchId ?? null,
            status: 'active',
          },
          select: { id: true },
        });
        await tx.$executeRaw`select public.create_member_profile(${created.id}::uuid, ${input.name}, ${phone})`;
        await audit(tx, user, m, 'member.added', membership.id, requestId, { role: input.role, branchId: input.branchId ?? null });
        return findMember(tx, membership.id, user.id);
      });
    } catch (err) {
      await this.admin.deleteUser(created.id).catch((cleanup: unknown) => {
        this.logger.error('member.cleanup_failed', { requestId, error: cleanup instanceof Error ? cleanup.message : String(cleanup) });
        if (Sentry.isInitialized()) Sentry.captureException(cleanup, { tags: { requestId } });
      });
      throw err;
    }
  }

  /** Số đã có tài khoản: chỉ bật lại được người từng bị gỡ khỏi CHÍNH tổ chức này. Mật khẩu của họ giữ nguyên. */
  private reactivate(user: AuthUser, m: MembershipContext, userId: string, input: CreateInput, requestId: string): Promise<OrgMember> {
    return this.db.scoped({ userId: user.id, orgId: m.organizationId }, async (tx) => {
      const row = await tx.membership.findFirst({
        where: { userId, organizationId: m.organizationId },
        select: { id: true, status: true },
      });
      if (!row) throw accountExists();
      if (row.status !== 'removed') {
        throw new ApiException('VALIDATION_FAILED', 'Người này đã ở trong tổ chức', {
          reason: 'ALREADY_MEMBER',
          fields: { phone: 'Người này đã ở trong tổ chức' },
        });
      }
      await tx.membership.update({
        where: { id: row.id },
        data: { status: 'active', role: input.role, branchId: input.branchId ?? null },
        select: { id: true },
      });
      await audit(tx, user, m, 'member.added', row.id, requestId, { role: input.role, branchId: input.branchId ?? null, reactivated: true });
      return findMember(tx, row.id, user.id);
    });
  }

  update(user: AuthUser, m: MembershipContext, id: string, patch: PatchInput, requestId: string): Promise<OrgMember> {
    return this.db.scoped({ userId: user.id, orgId: m.organizationId }, async (tx) => {
      const row = await this.editable(tx, user, m, id);
      if (row.status !== 'active') {
        throw new ApiException('VALIDATION_FAILED', 'Người này đã bị gỡ khỏi tổ chức — thêm lại trước', { fields: { id: 'Đã bị gỡ' } });
      }
      if (patch.role) assertRole(m.orgType, patch.role);
      await assertBranch(tx, m.organizationId, patch.branchId);

      await tx.membership.update({
        where: { id },
        data: { ...(patch.role ? { role: patch.role } : {}), ...(patch.branchId !== undefined ? { branchId: patch.branchId } : {}) },
        select: { id: true },
      });
      await recordAudit(tx, {
        organizationId: m.organizationId,
        actorUserId: user.id,
        action: 'member.role_changed',
        entity: 'membership',
        entityId: id,
        before: { role: row.role, branchId: row.branchId },
        after: { role: patch.role ?? row.role, branchId: patch.branchId !== undefined ? patch.branchId : row.branchId },
        requestId,
      });
      return findMember(tx, id, user.id);
    });
  }

  /** Mất quyền ngay: guard chỉ nhận membership `active`. Gọi lại an toàn. */
  remove(user: AuthUser, m: MembershipContext, id: string, requestId: string): Promise<OrgMember> {
    return this.db.scoped({ userId: user.id, orgId: m.organizationId }, async (tx) => {
      const row = await this.editable(tx, user, m, id);
      if (row.status !== 'removed') {
        await tx.membership.update({ where: { id }, data: { status: 'removed' }, select: { id: true } });
        await audit(tx, user, m, 'member.removed', id, requestId, { role: row.role, branchId: row.branchId });
      }
      return findMember(tx, id, user.id);
    });
  }

  /** Không ai sửa / gỡ được chủ, và không tự sửa / gỡ chính mình. */
  private async editable(tx: Tx, user: AuthUser, m: MembershipContext, id: string) {
    const row = await tx.membership.findFirst({
      where: { id, organizationId: m.organizationId },
      select: { role: true, status: true, userId: true, branchId: true },
    });
    if (!row) throw notFound();
    if (row.role === 'owner') throw new ApiException('FORBIDDEN', 'Không sửa, không gỡ được chủ tổ chức');
    if (row.userId === user.id) throw new ApiException('FORBIDDEN', 'Không tự sửa, tự gỡ chính mình');
    return row;
  }
}

const audit = (
  tx: Tx,
  user: AuthUser,
  m: MembershipContext,
  action: AuditAction,
  membershipId: string,
  requestId: string,
  after: Prisma.InputJsonValue,
): Promise<void> =>
  recordAudit(tx, { organizationId: m.organizationId, actorUserId: user.id, action, entity: 'membership', entityId: membershipId, after, requestId });
