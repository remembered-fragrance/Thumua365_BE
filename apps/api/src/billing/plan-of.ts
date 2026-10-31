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
    select: { id: true, status: true, trialEndsAt: true, currentPeriodEnd: true, branchLimit: true, plan: true, extraStaff: true },
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
  'audit:view': 'Gói đã hết hạn — nhật ký vẫn được ghi đầy đủ, gia hạn để xem lại',
  'reports:org': 'Gói đã hết hạn — sổ và công nợ trong app vẫn xem được, gia hạn để xem báo cáo tổng',
  // Ba mã dưới chỉ chặn ở app (file và nội dung chuyển khoản sinh ở máy).
  'debt:statement': 'Gói đã hết hạn — công nợ vẫn xem được, gia hạn để gửi sao kê cho khách',
  'tax:docs': 'Gói đã hết hạn — báo cáo thuế tổng vẫn xem được, gia hạn để xuất bảng kê thu mua',
  'pay:qr': 'Gói đã hết hạn — vẫn ghi trả tiền được, gia hạn để chép nội dung chuyển khoản',
  // Hai mã dưới chỉ chặn ở app (tính từ sổ ở máy).
  analytics: 'Gói đã hết hạn — báo cáo thuế tổng vẫn xem được, gia hạn để xem lời theo mặt hàng',
  'rubber:reconcile': 'Gói đã hết hạn — sổ mủ vẫn đầy đủ, gia hạn để đối chiếu độ với nhà máy',
  'map:prices': 'Gói đã hết hạn — điểm trên bản đồ vẫn hiện, gia hạn để khai và hiện giá thu mua',
};

/**
 * Gói còn hạn nhưng gói Thương lái không có quyền lợi này (0.28.0) — câu khác câu "hết hạn": gia hạn không giúp gì,
 * phải lên gói Vựa. Chỉ ba mã trong `PLAN_EXCLUDES.thuong_lai`.
 */
const SOLO_REASON: Readonly<Partial<Record<Entitlement, string>>> = {
  'members:add': 'Gói Thương lái làm một mình — nâng lên gói Vựa để thêm người cân',
  'audit:view': 'Gói Thương lái chưa có nhật ký thao tác — nâng lên gói Vựa để xem',
  'reports:org': 'Gói Thương lái chưa có báo cáo tổng — nâng lên gói Vựa để xem',
};

/** `details.requiredPlan` có khi bị chặn vì gói thấp (không phải hết hạn) — app mời nâng gói thay vì gia hạn. */
export const assertEntitlement = async (tx: Tx, m: MembershipContext, entitlement: Entitlement): Promise<void> => {
  const plan = await planOf(tx, m.organizationId);
  if (entitled(m.orgType, plan?.tier, plan?.plan, entitlement)) return;
  // Bỏ mã gói ra mà có → gói còn hạn, chỉ thiếu vì gói thấp.
  if (entitled(m.orgType, plan?.tier, null, entitlement)) {
    throw new ApiException('PLAN_REQUIRED', SOLO_REASON[entitlement] ?? REASON[entitlement], { entitlement, requiredPlan: 'vua' });
  }
  throw new ApiException('PLAN_REQUIRED', REASON[entitlement], { entitlement });
};
