/**
 * DELETE /v1/me — xoá tài khoản THẬT (KH §6; trang Quyền riêng tư hứa điều này). Thứ tự bắt buộc,
 * giữ từ `data/account.ts` của bản cũ:
 *
 *   1. ẢNH trên Storage trước — chúng không đi theo database; tài khoản mất rồi thì không ai biết
 *      thư mục nào để dọn. Bước này hỏng thì DỪNG.
 *   2. DỮ LIỆU — một transaction bằng `api_privileged`: tổ chức mình là chủ (và không còn ai khác)
 *      bị xoá hẳn cùng sổ của nó; hồ sơ bị xoá. Đơn và kết nối với tổ chức khác thì xét theo bên
 *      kia (quyết định 18/10/2026: sổ là của vựa, nông dân chỉ vào xem): bên kia còn sổ ⇒ đơn và
 *      lịch sử đơn ở lại trong sổ họ, chỉ gỡ tổ chức này ra; kết nối thành `revoked`. Xem
 *      `detachOrders`, `detachLinks`.
 *
 * Người làm thuê còn trong tổ chức nào thì KHÔNG xoá được (`STILL_MEMBER`): người làm không tự rời,
 * chủ gỡ ra trước (0.13.0). Xoá tài khoản từng là một đường tự rời — nay đóng lại.
 *   3. TÀI KHOẢN ĐĂNG NHẬP (Supabase Auth) sau cùng.
 *
 * Giữ lại, cố ý: `bank_transactions` (sổ đối soát — không thì xoá tài khoản thành cách dùng lại một
 * mã giao dịch ngân hàng), `audit_log`, `admin_access_log` (dấu vết không xoá được). Ba bảng này
 * không có khoá ngoại tới tổ chức.
 */

import { type AccountDeleteResult, hasBook, OrgType } from '@mambo/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { Logger } from 'winston';
import type { AuthUser } from '../auth/auth-user';
import { SUPABASE_ADMIN, type SupabaseAdmin } from '../auth/supabase-admin';
import { ApiException } from '../common/api-exception';
import type { Tx } from '../db/database';
import { PRIVILEGED_DATABASE, type PrivilegedDatabase, privileged } from '../db/privileged-database';
import { LOGGER } from '../events/domain-events';
import { logStep } from '../orders/order-records';
import { ATTACHMENTS_BUCKET, STORAGE_ADMIN, type StorageAdmin } from '../storage/storage-admin';

const OPEN_ORDER = ['submitted', 'accepted', 'scheduled'];

/** Ghi ở mốc huỷ trong lịch sử đơn của bên còn lại. */
export const ORDER_DETACHED_NOTE = 'Bên kia đã xoá tài khoản — đơn tự huỷ';

interface Gone {
  readonly id: string;
  readonly name: string;
  readonly type: string;
}

interface Detached {
  readonly keptOrders: number;
  readonly revokedLinks: number;
}

/**
 * Đơn có tổ chức này. GIỮ khi bên kia còn tài khoản, có sổ (vựa / DN) và có dòng danh bạ ứng với
 * tổ chức này (`seller_partner_id` / `buyer_partner_id` — tên hiện cho đơn về sau). Giữ = gỡ tổ chức
 * này về null; đơn còn mở thì huỷ (không còn ai ở đầu kia để nhận, hẹn, giao) và báo bên kia như mọi
 * lần huỷ. Còn lại — bên kia là nông dân (không có sổ, mất quyền xem là đúng) hay cũng đã xoá — đơn
 * chỉ còn là của tổ chức này ⇒ xoá cùng lịch sử. Phiếu bên kia gắn đơn bị xoá → order_id về null
 * (khoá ngoại ON DELETE SET NULL); gắn đơn được giữ thì vẫn gắn.
 */
const detachOrders = async (tx: Tx, gone: Gone, actorUserId: string): Promise<number> => {
  const orders = await tx.order.findMany({
    where: { OR: [{ sellerOrgId: gone.id }, { buyerOrgId: gone.id }, { createdByOrgId: gone.id }] },
    select: {
      id: true,
      sellerOrgId: true,
      buyerOrgId: true,
      createdByOrgId: true,
      sellerPartnerId: true,
      buyerPartnerId: true,
      branchId: true,
      status: true,
      pickupAt: true,
    },
  });
  // Chi nhánh của tổ chức này bị xoá sau cùng; khoá ngoại SET NULL lúc đó sẽ bị orders_guard chặn
  // (đổi đơn mà không tăng version) ⇒ gỡ ngay trong lần gỡ tổ chức.
  const branches = new Set(
    (await tx.branch.findMany({ where: { organizationId: gone.id }, select: { id: true } })).map((b) => b.id),
  );
  const otherOf = (o: (typeof orders)[number]): string | null => (o.sellerOrgId === gone.id ? o.buyerOrgId : o.sellerOrgId);
  const others = await tx.organization.findMany({
    where: { id: { in: orders.map(otherOf).filter((id): id is string => id !== null) }, deletedAt: null },
    select: { id: true, type: true },
  });
  const withBook = new Set(others.filter((g) => hasBook(OrgType.parse(g.type))).map((g) => g.id));

  const kept: { order: (typeof orders)[number]; other: string }[] = [];
  const dropped: string[] = [];
  for (const o of orders) {
    const other = otherOf(o);
    // Dòng danh bạ của BÊN KIA ứng với tổ chức này.
    const theirPartner = o.sellerOrgId === gone.id ? o.sellerPartnerId : o.buyerPartnerId;
    if (other !== null && withBook.has(other) && theirPartner !== null) kept.push({ order: o, other });
    else dropped.push(o.id);
  }
  await tx.orderEvent.deleteMany({ where: { orderId: { in: dropped } } });
  await tx.order.deleteMany({ where: { id: { in: dropped } } });

  for (const { order: o, other } of kept) {
    const open = OPEN_ORDER.includes(o.status);
    await tx.order.update({
      where: { id: o.id },
      data: {
        ...(o.sellerOrgId === gone.id ? { sellerOrgId: null } : {}),
        ...(o.buyerOrgId === gone.id ? { buyerOrgId: null } : {}),
        ...(o.createdByOrgId === gone.id ? { createdByOrgId: null } : {}),
        ...(o.branchId !== null && branches.has(o.branchId) ? { branchId: null } : {}),
        ...(open ? { status: 'cancelled', version: { increment: 1 } } : {}),
      },
      select: { id: true },
    });
    if (!open) continue;
    await logStep(tx, o.id, o.status, 'cancelled', actorUserId, gone.id, ORDER_DETACHED_NOTE);
    // Cùng payload với notify_order(): bên còn lại thấy "<tên> đã huỷ đơn" như mọi lần huỷ.
    await tx.notification.create({
      data: {
        organizationId: other,
        kind: 'order.cancelled',
        payload: {
          orderId: o.id,
          orderStatus: 'cancelled',
          pickupAt: o.pickupAt?.toISOString() ?? null,
          fromOrgId: gone.id,
          fromOrgName: gone.name,
          fromOrgType: gone.type,
        },
      },
      select: { id: true },
    });
  }
  return kept.length;
};

/**
 * Kết nối. Tổ chức này giữ sổ ⇒ xoá (sổ không còn; bên được xem mất quyền xem — đúng). Tổ chức này
 * là bên được xem ⇒ kết nối ở lại trong sổ bên kia thành `revoked`, gỡ tổ chức này về null; bên sổ
 * thấy "đã ngừng kết nối" và mời lại được bằng lời mời mới. Đang active thì báo bên sổ như mọi lần huỷ.
 */
const detachLinks = async (tx: Tx, gone: Gone, actorUserId: string): Promise<number> => {
  // Bên được xem của kết nối đang active nhận `link.revoked` như mọi lần huỷ — không thì sổ họ đang
  // xem biến mất mà không ai báo.
  const watched = await tx.partnerLink.findMany({
    where: { ownerOrgId: gone.id, status: 'active', linkedOrgId: { not: null } },
    select: { id: true, linkedOrgId: true },
  });
  for (const l of watched) {
    await tx.notification.create({
      data: {
        organizationId: l.linkedOrgId as string,
        kind: 'link.revoked',
        payload: { linkId: l.id, fromOrgId: gone.id, fromOrgName: gone.name, fromOrgType: gone.type },
      },
      select: { id: true },
    });
  }
  await tx.partnerLink.deleteMany({ where: { ownerOrgId: gone.id } });

  const live = await tx.partnerLink.findMany({
    where: { linkedOrgId: gone.id, status: { not: 'revoked' } },
    select: { id: true, ownerOrgId: true, status: true },
  });
  await tx.partnerLink.updateMany({
    where: { id: { in: live.map((l) => l.id) } },
    data: { status: 'revoked', linkedOrgId: null, decidedBy: actorUserId, decidedAt: new Date() },
  });
  // Kết nối đã huỷ từ trước: chỉ gỡ tổ chức này ra.
  await tx.partnerLink.updateMany({ where: { linkedOrgId: gone.id }, data: { linkedOrgId: null } });

  for (const l of live) {
    if (l.status !== 'active') continue;
    await tx.notification.create({
      data: {
        organizationId: l.ownerOrgId,
        kind: 'link.revoked',
        payload: { linkId: l.id, fromOrgId: gone.id, fromOrgName: gone.name, fromOrgType: gone.type },
      },
      select: { id: true },
    });
  }
  return live.length;
};

/** Xoá hẳn một tổ chức — theo thứ tự khoá ngoại, con trước cha. */
const purgeOrganization = async (tx: Tx, orgId: string, actorUserId: string): Promise<Detached> => {
  const gone = await tx.organization.findUniqueOrThrow({ where: { id: orgId }, select: { id: true, name: true, type: true } });
  const where = { organizationId: orgId };
  // Sổ.
  await tx.payment.deleteMany({ where });
  await tx.transaction.deleteMany({ where });
  await tx.draft.deleteMany({ where });
  await tx.note.deleteMany({ where });
  await tx.seasonContract.deleteMany({ where });
  await tx.pricingRule.deleteMany({ where });
  await tx.product.deleteMany({ where });
  await tx.supplier.deleteMany({ where });
  await tx.buyer.deleteMany({ where });
  await tx.syncOp.deleteMany({ where });
  // Chuỗi: đơn và kết nối với tổ chức khác — sổ bên kia giữ nguyên.
  const keptOrders = await detachOrders(tx, gone, actorUserId);
  const revokedLinks = await detachLinks(tx, gone, actorUserId);
  // Hệ thống của tổ chức.
  await tx.notification.deleteMany({ where });
  await tx.paymentIntent.deleteMany({ where });
  await tx.subscription.deleteMany({ where });
  await tx.organizationFeature.deleteMany({ where });
  await tx.membership.deleteMany({ where });
  await tx.place.deleteMany({ where });
  await tx.branch.deleteMany({ where });
  await tx.organization.delete({ where: { id: orgId } });
  return { keptOrders, revokedLinks };
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
    if (plan.left.length > 0) {
      throw new ApiException('VALIDATION_FAILED', 'Bạn còn làm cho tổ chức khác — nhờ chủ gỡ bạn ra trước rồi mới xoá tài khoản', {
        reason: 'STILL_MEMBER',
        organizations: plan.left,
      });
    }
    if (plan.busy.length > 0) {
      throw new ApiException('VALIDATION_FAILED', 'Tổ chức của bạn còn người đang làm — gỡ họ trước rồi xoá tài khoản', {
        reason: 'ORG_HAS_MEMBERS',
        organizations: plan.busy,
      });
    }

    // 1. Ảnh — hỏng là dừng, chưa xoá gì.
    for (const orgId of plan.owned) await this.storage.removeFolder(ATTACHMENTS_BUCKET, orgId);

    // 2. Dữ liệu. Xét lại ngay trong transaction xoá, sau khi khoá hàng của từng tổ chức: thêm người
    //    vào tổ chức (insert membership) phải chờ khoá này, nên người được thêm giữa bước kiểm và bước
    //    xoá hoặc hiện ra ở lần xét lại (dừng), hoặc chỉ thêm được khi tổ chức đã không còn.
    await db.run(async (tx) => {
      if (plan.owned.length > 0) {
        await tx.$queryRaw`select id from organizations where id = any(${plan.owned}::uuid[]) for update`;
      }
      const joined = await tx.membership.findMany({
        where: {
          OR: [
            { organizationId: { in: plan.owned }, userId: { not: user.id }, status: 'active' },
            { userId: user.id, status: { not: 'removed' }, role: { not: 'owner' } },
          ],
        },
        select: { organizationId: true, userId: true },
      });
      if (joined.length > 0) {
        const busy = [...new Set(joined.filter((j) => j.userId !== user.id).map((j) => j.organizationId))];
        throw busy.length > 0
          ? new ApiException('VALIDATION_FAILED', 'Tổ chức của bạn còn người đang làm — gỡ họ trước rồi xoá tài khoản', {
              reason: 'ORG_HAS_MEMBERS',
              organizations: busy,
            })
          : new ApiException('VALIDATION_FAILED', 'Bạn còn làm cho tổ chức khác — nhờ chủ gỡ bạn ra trước rồi mới xoá tài khoản', {
              reason: 'STILL_MEMBER',
              organizations: [...new Set(joined.map((j) => j.organizationId))],
            });
      }

      let keptOrders = 0;
      let revokedLinks = 0;
      for (const orgId of plan.owned) {
        const detached = await purgeOrganization(tx, orgId, user.id);
        keptOrders += detached.keptOrders;
        revokedLinks += detached.revokedLinks;
      }
      await tx.membership.updateMany({ where: { userId: user.id, status: { not: 'removed' } }, data: { status: 'removed' } });
      await tx.notification.deleteMany({ where: { userId: user.id } });
      await tx.feedback.deleteMany({ where: { userId: user.id } });
      await tx.profile.deleteMany({ where: { id: user.id } });
      await tx.auditLog.create({
        data: {
          organizationId: null,
          actorUserId: user.id,
          action: 'account.deleted',
          entity: 'user',
          entityId: user.id,
          after: { deletedOrganizations: plan.owned, leftOrganizations: plan.left, keptOrders, revokedLinks },
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
