/**
 * Nhật ký thao tác nhạy cảm (KH §1.8, kiến trúc v2 "Quản trị · Audit").
 *
 * Ghi TRONG CÙNG transaction với thao tác: thao tác rollback thì dòng nhật ký cũng
 * mất, thao tác thành công thì chắc chắn có nhật ký. Bảng `audit_log` chỉ ghi thêm —
 * api_service không có quyền UPDATE hay DELETE trên nó.
 *
 * Không ghi mật khẩu, token, số tiền chi tiết của người khác vào `before`/`after`.
 */

import type { Prisma } from '../generated/prisma/client';
import type { Tx } from '../db/database';

/** Tên hành động: `đối_tượng.hành_động`, thể đã xong. Thêm tên mới ở đây. */
export type AuditAction =
  | 'organization.bootstrapped'
  | 'receipt.deleted'
  | 'payment.voided'
  | 'member.role_changed'
  | 'link.accepted'
  | 'link.revoked';

export interface AuditEntry {
  readonly organizationId: string;
  readonly actorUserId: string;
  readonly action: AuditAction;
  readonly entity: string;
  readonly entityId?: string;
  readonly before?: Prisma.InputJsonValue;
  readonly after?: Prisma.InputJsonValue;
  readonly requestId?: string;
}

export const recordAudit = async (tx: Tx, entry: AuditEntry): Promise<void> => {
  await tx.auditLog.create({
    data: {
      organizationId: entry.organizationId,
      actorUserId: entry.actorUserId,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId ?? null,
      ...(entry.before !== undefined ? { before: entry.before } : {}),
      ...(entry.after !== undefined ? { after: entry.after } : {}),
      requestId: entry.requestId ?? null,
    },
    select: { id: true },
  });
};
