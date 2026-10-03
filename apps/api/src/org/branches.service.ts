/**
 * Chi nhánh — KH backend §1.7, §6, BE7. Giới hạn theo gói: `subscriptions.branch_limit` (null =
 * không giới hạn). Đếm và tạo trong CÙNG transaction có khoá advisory theo tổ chức — hai người bấm
 * "Tạo" cùng lúc không vượt được giới hạn. Chi nhánh không xoá, chỉ lưu trữ (`deleted_at`): phiếu cũ
 * vẫn trỏ tới nó (khoá ngoại ghép, BE3).
 */

import type { OrgBranch, OrgBranchCreateInput, OrgBranchesList, OrgBranchPatch } from '@mambo/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { z } from 'zod';
import { recordAudit } from '../audit/audit';
import type { AuthUser } from '../auth/auth-user';
import type { MembershipContext } from '../auth/membership';
import { ApiException } from '../common/api-exception';
import { DATABASE, type Database, type Tx } from '../db/database';
import type { Branch } from '../generated/prisma/client';

type CreateInput = z.output<typeof OrgBranchCreateInput>;
type PatchInput = z.output<typeof OrgBranchPatch>;
type BranchRow = Pick<Branch, 'id' | 'name' | 'address' | 'deletedAt' | 'createdAt'>;

const SELECT = { id: true, name: true, address: true, deletedAt: true, createdAt: true } as const;

const toBranch = (row: BranchRow, memberCount: number): OrgBranch => ({
  id: row.id,
  name: row.name,
  address: row.address,
  archived: row.deletedAt !== null,
  memberCount,
  createdAt: row.createdAt.toISOString(),
});

const limitOf = async (tx: Tx, orgId: string): Promise<number | null> =>
  (await tx.subscription.findFirst({ where: { organizationId: orgId, deletedAt: null }, select: { branchLimit: true } }))
    ?.branchLimit ?? null;

const membersIn = (tx: Tx, orgId: string, branchId: string): Promise<number> =>
  tx.membership.count({ where: { organizationId: orgId, branchId, status: 'active' } });

/** Còn chỗ cho thêm một chi nhánh đang dùng không — gọi SAU khi đã giữ khoá. */
const assertRoom = async (tx: Tx, orgId: string): Promise<void> => {
  const limit = await limitOf(tx, orgId);
  if (limit === null) return;
  const used = await tx.branch.count({ where: { organizationId: orgId, deletedAt: null } });
  if (used >= limit) {
    throw new ApiException('BRANCH_LIMIT', `Gói hiện tại cho tối đa ${limit} chi nhánh`, { limit });
  }
};

const lock = (tx: Tx, orgId: string) => tx.$executeRaw`select pg_advisory_xact_lock(hashtextextended(${orgId}, 2))`;

@Injectable()
export class BranchesService {
  private readonly db: Database;

  constructor(@Inject(DATABASE) db: Database) {
    this.db = db;
  }

  list(user: AuthUser, m: MembershipContext): Promise<OrgBranchesList> {
    const orgId = m.organizationId;
    return this.db.scoped({ userId: user.id, orgId }, async (tx) => {
      const rows = await tx.branch.findMany({ where: { organizationId: orgId }, select: SELECT, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
      const assigned = await tx.membership.findMany({
        where: { organizationId: orgId, status: 'active', branchId: { not: null } },
        select: { branchId: true },
      });
      const countOf = new Map<string | null, number>();
      for (const { branchId } of assigned) countOf.set(branchId, (countOf.get(branchId) ?? 0) + 1);
      return {
        branches: rows.map((r) => toBranch(r, countOf.get(r.id) ?? 0)),
        limit: await limitOf(tx, orgId),
        used: rows.filter((r) => r.deletedAt === null).length,
      };
    });
  }

  create(user: AuthUser, m: MembershipContext, input: CreateInput, requestId: string): Promise<OrgBranch> {
    const orgId = m.organizationId;
    return this.db.scoped({ userId: user.id, orgId }, async (tx) => {
      await lock(tx, orgId);
      await assertRoom(tx, orgId);
      const row = await tx.branch.create({ data: { organizationId: orgId, name: input.name, address: input.address ?? null }, select: SELECT });
      await recordAudit(tx, {
        organizationId: orgId,
        actorUserId: user.id,
        action: 'branch.created',
        entity: 'branch',
        entityId: row.id,
        after: { name: row.name },
        requestId,
      });
      return toBranch(row, 0);
    });
  }

  update(user: AuthUser, m: MembershipContext, id: string, patch: PatchInput, requestId: string): Promise<OrgBranch> {
    const orgId = m.organizationId;
    return this.db.scoped({ userId: user.id, orgId }, async (tx) => {
      await lock(tx, orgId);
      const row = await tx.branch.findFirst({ where: { id, organizationId: orgId }, select: SELECT });
      if (!row) throw new ApiException('NOT_FOUND', 'Không có chi nhánh này');

      let deletedAt: Date | null | undefined;
      if (patch.archived === true && row.deletedAt === null) {
        if ((await membersIn(tx, orgId, id)) > 0) {
          throw new ApiException('VALIDATION_FAILED', 'Còn người gắn với chi nhánh này — chuyển họ sang chi nhánh khác trước', {
            fields: { archived: 'Còn người gắn với chi nhánh' },
          });
        }
        deletedAt = new Date();
      }
      if (patch.archived === false && row.deletedAt !== null) {
        await assertRoom(tx, orgId);
        deletedAt = null;
      }

      const updated = await tx.branch.update({
        where: { id },
        data: {
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.address !== undefined ? { address: patch.address } : {}),
          ...(deletedAt !== undefined ? { deletedAt } : {}),
        },
        select: SELECT,
      });
      await recordAudit(tx, {
        organizationId: orgId,
        actorUserId: user.id,
        action: 'branch.updated',
        entity: 'branch',
        entityId: id,
        before: { name: row.name, address: row.address, archived: row.deletedAt !== null },
        after: { name: updated.name, address: updated.address, archived: updated.deletedAt !== null },
        requestId,
      });
      return toBranch(updated, await membersIn(tx, orgId, id));
    });
  }
}
