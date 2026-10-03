/**
 * DELETE /v1/me — xoá tài khoản THẬT (KH §6; trang Quyền riêng tư hứa điều này). Thứ tự bắt buộc,
 * giữ từ `data/account.ts` của bản cũ:
 *
 *   1. ẢNH trên Storage trước — chúng không đi theo database; tài khoản mất rồi thì không ai biết
 *      thư mục nào để dọn. Bước này hỏng thì DỪNG.
 *   2. DỮ LIỆU — một transaction bằng `api_privileged`: tổ chức mình là chủ (và không còn ai khác)
 *      bị xoá hẳn, cùng sổ, đơn, kết nối; tổ chức mình chỉ làm thuê thì rời đi; hồ sơ bị xoá.
 *   3. TÀI KHOẢN ĐĂNG NHẬP (Supabase Auth) sau cùng.
 *
 * Giữ lại, cố ý: `bank_transactions` (sổ đối soát — không thì xoá tài khoản thành cách dùng lại một
 * mã giao dịch ngân hàng), `audit_log`, `admin_access_log` (dấu vết không xoá được). Ba bảng này
 * không có khoá ngoại tới tổ chức.
 */

import type { AccountDeleteResult } from '@mambo/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { Logger } from 'winston';
import type { AuthUser } from '../auth/auth-user';
import { SUPABASE_ADMIN, type SupabaseAdmin } from '../auth/supabase-admin';
import { ApiException } from '../common/api-exception';
import type { Tx } from '../db/database';
import { PRIVILEGED_DATABASE, type PrivilegedDatabase, privileged } from '../db/privileged-database';
import { LOGGER } from '../events/domain-events';
import { ATTACHMENTS_BUCKET, STORAGE_ADMIN, type StorageAdmin } from '../storage/storage-admin';

/** Xoá hẳn một tổ chức — theo thứ tự khoá ngoại, con trước cha. */
const purgeOrganization = async (tx: Tx, orgId: string): Promise<void> => {
  const where = { organizationId: orgId };
  // Sổ.
  await tx.payment.deleteMany({ where });
  await tx.transaction.deleteMany({ where });
  await tx.draft.deleteMany({ where });
  await tx.note.deleteMany({ where });
  await tx.pricingRule.deleteMany({ where });
  await tx.product.deleteMany({ where });
  await tx.supplier.deleteMany({ where });
  await tx.buyer.deleteMany({ where });
  await tx.syncOp.deleteMany({ where });
  // Chuỗi: đơn và kết nối với tổ chức khác. Phiếu của bên kia gắn đơn này → order_id về null
  // (khoá ngoại ON DELETE SET NULL) — sổ của họ còn nguyên.
  const orders = { OR: [{ sellerOrgId: orgId }, { buyerOrgId: orgId }, { createdByOrgId: orgId }] };
  await tx.orderEvent.deleteMany({ where: { order: orders } });
  await tx.order.deleteMany({ where: orders });
  await tx.partnerLink.deleteMany({ where: { OR: [{ ownerOrgId: orgId }, { linkedOrgId: orgId }] } });
  // Hệ thống của tổ chức.
  await tx.notification.deleteMany({ where });
  await tx.paymentIntent.deleteMany({ where });
  await tx.subscription.deleteMany({ where });
  await tx.organizationFeature.deleteMany({ where });
  await tx.membership.deleteMany({ where });
  await tx.branch.deleteMany({ where });
  await tx.organization.delete({ where: { id: orgId } });
};

@Injectable()
export class AccountDeletionService {
  private readonly db: PrivilegedDatabase | null;
  private readonly storage: StorageAdmin;
  private readonly admin: SupabaseAdmin;
  private readonly logger: Logger;

  constructor(
    @Inject(PRIVILEGED_DATABASE) db: PrivilegedDatabase | null,
    @Inject(STORAGE_ADMIN) storage: StorageAdmin,
    @Inject(SUPABASE_ADMIN) admin: SupabaseAdmin,
    @Inject(LOGGER) logger: Logger,
  ) {
    this.db = db;
    this.storage = storage;
    this.admin = admin;
    this.logger = logger;
  }

  async delete(user: AuthUser, requestId: string): Promise<AccountDeleteResult> {
    const db = privileged(this.db);

    const plan = await db.run(async (tx) => {
      const mine = await tx.membership.findMany({
        where: { userId: user.id, status: { not: 'removed' } },
        select: { organizationId: true, role: true },
      });
      const owned = mine.filter((m) => m.role === 'owner').map((m) => m.organizationId);
      const busy = await tx.membership.findMany({
        where: { organizationId: { in: owned }, userId: { not: user.id }, status: 'active' },
        select: { organizationId: true },
        distinct: ['organizationId'],
      });
      return { owned, left: mine.filter((m) => m.role !== 'owner').map((m) => m.organizationId), busy: busy.map((b) => b.organizationId) };
    });
    if (plan.busy.length > 0) {
      throw new ApiException('VALIDATION_FAILED', 'Tổ chức của bác còn người đang làm — gỡ họ trước rồi xoá tài khoản', {
        reason: 'ORG_HAS_MEMBERS',
        organizations: plan.busy,
      });
    }

    // 1. Ảnh — hỏng là dừng, chưa xoá gì.
    for (const orgId of plan.owned) await this.storage.removeFolder(ATTACHMENTS_BUCKET, orgId);

    // 2. Dữ liệu.
    await db.run(async (tx) => {
      for (const orgId of plan.owned) await purgeOrganization(tx, orgId);
      await tx.membership.updateMany({ where: { userId: user.id, status: { not: 'removed' } }, data: { status: 'removed' } });
      await tx.notification.deleteMany({ where: { userId: user.id } });
      await tx.profile.deleteMany({ where: { id: user.id } });
      await tx.auditLog.create({
        data: {
          organizationId: null,
          actorUserId: user.id,
          action: 'account.deleted',
          entity: 'user',
          entityId: user.id,
          after: { deletedOrganizations: plan.owned, leftOrganizations: plan.left },
          requestId,
        },
        select: { id: true },
      });
    });

    // 3. Tài khoản đăng nhập — dữ liệu đã xoá; hỏng ở đây thì người đó đăng nhập vào được một tài
    //    khoản rỗng. Báo lỗi để app thử lại (bước 1–2 gọi lại an toàn: không còn gì để xoá).
    try {
      await this.admin.deleteUser(user.id);
    } catch (err) {
      this.logger.error('account.auth_delete_failed', { requestId, error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
    return { deletedOrganizations: plan.owned, leftOrganizations: plan.left };
  }
}
