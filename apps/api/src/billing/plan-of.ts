/**
 * Gói của tổ chức đang làm việc và quyền lợi đi kèm — KE_HOACH_GOI_PRO §7.2. Bậc gói luôn suy từ
 * ngày tháng (`planSummary` → `planFor`), không có trạng thái "hết hạn" lưu trong DB.
 */

import { type Entitlement, type PlanSummary, entitled } from '@mambo/contracts';
import type { MembershipContext } from '../auth/membership';
import { planSummary } from '../auth/prisma-memberships';
import { ApiException } from '../common/api-exception';
import type { Tx } from '../db/database';

export const planOf = async (tx: Tx, orgId: string): Promise<PlanSummary | null> => {
  const sub = await tx.subscription.findFirst({
    where: { organizationId: orgId, deletedAt: null },
    select: { id: true, status: true, trialEndsAt: true, currentPeriodEnd: true, branchLimit: true },
  });
  return planSummary(sub ?? undefined, new Date());
};

/** Câu cho người đọc. App rẽ theo `details.entitlement`, không theo câu này. */
const REASON: Readonly<Record<Entitlement, string>> = {
  'receipts:unlimited': 'Gói miễn phí giới hạn số phiếu mỗi tháng',
  sync: 'Gói đã hết hạn — sổ vẫn đọc và xuất file được, nhưng chưa gửi lên mạng được',
  'members:add': 'Gói đã hết hạn — người đang có vẫn giữ nguyên, gia hạn để thêm người mới',
  attachments: 'Gói đã hết hạn — ảnh cũ vẫn xem được, gia hạn để gửi ảnh mới lên',
  'branches:add': 'Gói đã hết hạn — chi nhánh đang có vẫn giữ nguyên, gia hạn để thêm hoặc dùng lại chi nhánh',
  // Hai mã dưới chỉ chặn ở app (quy tắc giá chạy ở máy); máy chủ không ném, câu để bảng đủ mã.
  'quality:pricing': 'Gói đã hết hạn — quy tắc đã khai vẫn giữ, gia hạn để giá tự tính theo chất lượng',
  'rubber:grades': 'Gói đã hết hạn — mặt hàng đang có vẫn cân được, gia hạn để thêm mặt hàng mủ tạp (DRC)',
};

export const assertEntitlement = async (tx: Tx, m: MembershipContext, entitlement: Entitlement): Promise<void> => {
  const plan = await planOf(tx, m.organizationId);
  if (!entitled(m.orgType, plan?.tier, entitlement)) {
    throw new ApiException('PLAN_REQUIRED', REASON[entitlement], { entitlement });
  }
};
