/**
 * Tổ chức đang làm việc — đổi tên. Chỉ CHỦ: kiểm ở đây chứ không thêm quyền vào ma trận
 * (`permissions.ts`, đổi ma trận cần hai người duyệt). RLS `org_update` giữ cho chỉ ghi được
 * tổ chức trong `app.org_id`.
 */

import type { OrgPatch, OrgProfile } from '@mambo/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { z } from 'zod';
import { recordAudit } from '../audit/audit';
import type { AuthUser } from '../auth/auth-user';
import type { MembershipContext } from '../auth/membership';
import { ApiException } from '../common/api-exception';
import { DATABASE, type Database } from '../db/database';

type PatchInput = z.output<typeof OrgPatch>;

@Injectable()
export class OrganizationService {
  private readonly db: Database;

  constructor(@Inject(DATABASE) db: Database) {
    this.db = db;
  }

  update(user: AuthUser, m: MembershipContext, patch: PatchInput, requestId: string): Promise<OrgProfile> {
    if (m.role !== 'owner') throw new ApiException('FORBIDDEN', 'Chỉ chủ đổi được tên tổ chức');
    return this.db.scoped({ userId: user.id, orgId: m.organizationId }, async (tx) => {
      const before = await tx.organization.findUniqueOrThrow({ where: { id: m.organizationId }, select: { name: true } });
      const saved = await tx.organization.update({
        where: { id: m.organizationId },
        data: { name: patch.name },
        select: { id: true, type: true, name: true },
      });
      if (before.name !== saved.name) {
        await recordAudit(tx, {
          organizationId: m.organizationId,
          actorUserId: user.id,
          action: 'organization.updated',
          entity: 'organization',
          entityId: m.organizationId,
          before: { name: before.name },
          after: { name: saved.name },
          requestId,
        });
      }
      return { id: saved.id, type: m.orgType, name: saved.name };
    });
  }
}
