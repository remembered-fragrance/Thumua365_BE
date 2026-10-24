/**
 * Màn Nhật ký (V6, D4). Hợp đồng: `@mambo/contracts/audit`. Ghi ở `recordAudit` (mọi bậc gói); đọc cần
 * `staff:manage` + `audit:view` (guard). RLS `org_audit`: chỉ dòng của tổ chức đang làm việc.
 */

import type { AuditEntryView, AuditQuery, AuditResult } from '@mambo/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user';
import type { MembershipContext } from '../auth/membership';
import { encodeCursor, olderThan } from '../common/page-cursor';
import { DATABASE, type Database } from '../db/database';
import type { AuditLog } from '../generated/prisma/client';
import type { MemberRow } from '../org/members.service';

const LIST_DEFAULT_LIMIT = 50;
const DELETED_ACCOUNT = 'Tài khoản đã xoá';

const toView = (row: AuditLog, names: ReadonlyMap<string, string | null>): AuditEntryView => ({
  id: row.id,
  at: row.createdAt.toISOString(),
  actor: row.actorUserId ? { id: row.actorUserId, name: names.get(row.actorUserId) ?? DELETED_ACCOUNT } : null,
  action: row.action,
  entity: row.entity,
  entityId: row.entityId,
  before: row.before ?? null,
  after: row.after ?? null,
});

@Injectable()
export class AuditService {
  private readonly db: Database;

  constructor(@Inject(DATABASE) db: Database) {
    this.db = db;
  }

  list(user: AuthUser, m: MembershipContext, query: AuditQuery): Promise<AuditResult> {
    const limit = query.limit ?? LIST_DEFAULT_LIMIT;
    return this.db.scoped({ userId: user.id, orgId: m.organizationId }, async (tx) => {
      const rows = await tx.auditLog.findMany({
        where: {
          AND: [
            { organizationId: m.organizationId },
            query.actor ? { actorUserId: query.actor } : {},
            query.from || query.to
              ? { createdAt: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lt: new Date(query.to) } : {}) } }
              : {},
            olderThan(query.cursor),
          ],
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      });
      // Tên lấy từ danh sách người của tổ chức (cả người đã gỡ) — giống màn Người dùng.
      const members = await tx.$queryRaw<MemberRow[]>`select * from public.org_members()`;
      const names = new Map(members.map((r) => [r.user_id, r.name]));
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      return {
        entries: page.map((row) => toView(row, names)),
        cursor: rows.length > limit && last ? encodeCursor(last) : null,
      };
    });
  }
}
