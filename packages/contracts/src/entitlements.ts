/**
 * Quyền lợi theo gói — KE_HOACH_GOI_PRO §7.1. Bản DUY NHẤT: server (EntitlementGuard, chặn trong
 * service), frontend (khoá nút, màn so sánh gói) và test cùng đọc bảng này.
 *
 * Khác `permissions.ts`: quyền là "vai trò này được làm việc này", quyền lợi là "gói đang có cho làm
 * việc này". Cần cả hai. Bậc gói suy ra từ ngày tháng (`planFor`), không lưu trong DB.
 *
 * Chỉ khai mã đã có chỗ chặn thật. Tính năng Pro mới thêm mã của nó cùng PR có code chặn.
 */

import { z } from 'zod';
import type { PlanCode, PlanTier as PlanTierSchema } from './me.js';
import { hasBook, type OrgType } from './organization.js';

export const ENTITLEMENTS = [
  /** V1 — ghi phiếu không giới hạn. App chặn (hạn mức chỉ chạy ở máy). */
  'receipts:unlimited',
  /** V2 — gửi sổ lên mạng. Máy chủ chặn bằng `PLAN_EXPIRED` ở `/sync/push` (giữ mã cũ). */
  'sync',
  /** V3, D2 — thêm người cân / quản lý / nhân viên. */
  'members:add',
  /** V5 — tải ảnh chứng từ mới lên. Ảnh đã có vẫn xem được. */
  'attachments',
  /** D1 — tạo hoặc dùng lại chi nhánh. Đổi tên, lưu trữ vẫn được. */
  'branches:add',
  /**
   * V19 — quy tắc giá theo chỉ tiêu chất lượng (dung trọng, ẩm, tạp chất, KOR, bậc độ mủ) và tự áp lên
   * phiếu. App chặn (quy tắc chỉ chạy ở máy); quy tắc đã khai vẫn giữ, chỉ thôi tự áp khi hết gói.
   */
  'quality:pricing',
  /** V20 — mặt hàng mủ tạp tính theo DRC. App chặn khi tạo / đổi mặt hàng; mặt hàng đã có vẫn cân được. */
  'rubber:grades',
  /** V6, D4 — đọc nhật ký thao tác (`GET /v1/audit`). Nhật ký GHI ở mọi bậc gói; gói chỉ quyết định đọc. */
  'audit:view',
  /** V7 — sao kê công nợ gửi khách (ảnh / PDF sinh ở máy). App chặn; xem công nợ trong app vẫn Free. */
  'debt:statement',
  /**
   * D3 — báo cáo tổng phía server (`/reports/summary`, `/reports/members`) cho vựa / doanh nghiệp. Chặn
   * trong service, không ở route: nông dân dùng `summary` để xem phiếu đã kết nối (Free).
   */
  'reports:org',
  /** V12, V17 — bảng kê thu mua dạng 02/TNDN. App chặn (file sinh ở máy); báo cáo thuế tổng vẫn Free. */
  'tax:docs',
  /** V13 — trả nông hộ bằng chuyển khoản: chép số tiền + nội dung `PM-…`. App chặn; ghi trả tiền vẫn Free. */
  'pay:qr',
  /** V8 — phân tích lời theo mặt hàng, giá bình quân, so kỳ trước. App chặn (tính ở máy); báo cáo thuế tổng vẫn Free. */
  'analytics',
  /** V21 — đối chiếu độ mủ vựa đo với độ nhà máy đo, độ trung bình theo hộ. App chặn (tính ở máy). */
  'rubber:reconcile',
  /**
   * V9 — giá thu mua trên điểm bản đồ. Máy chủ chặn khi khai giá (`/org/places`), và không trả giá của điểm có
   * chủ hết gói.
   */
  'map:prices',
] as const;

export const Entitlement = z.enum(ENTITLEMENTS);
export type Entitlement = z.infer<typeof Entitlement>;

type PlanTier = z.infer<typeof PlanTierSchema>;

const PAID_TIERS: readonly PlanTier[] = ['trial', 'premium', 'grace'];

/**
 * Quyền lợi gói vựa KHÔNG có (0.28.0, chốt 30/10/2026): Thương lái làm một mình — không người cân, không nhật ký,
 * không báo cáo tổng. Áp cho cả dùng thử: chọn Thương lái lúc đăng ký thì 30 ngày thử cũng không có ba thứ này.
 */
export const PLAN_EXCLUDES: Readonly<Record<PlanCode, readonly Entitlement[]>> = {
  thuong_lai: ['members:add', 'audit:view', 'reports:org'],
  vua: [],
};

/**
 * Dùng thử, đang trả tiền, ân hạn: đủ quyền lợi, trừ phần gói đã chọn không có (`PLAN_EXCLUDES`). Hết gói, chưa có
 * gói, nông dân: không có gì. `plan` null (doanh nghiệp) = không bớt gì.
 */
export const entitlementsFor = (
  type: OrgType,
  tier: PlanTier | null | undefined,
  plan: PlanCode | null | undefined,
): readonly Entitlement[] => {
  if (!hasBook(type) || !tier || !PAID_TIERS.includes(tier)) return [];
  const excluded = plan ? PLAN_EXCLUDES[plan] : [];
  return excluded.length === 0 ? ENTITLEMENTS : ENTITLEMENTS.filter((e) => !excluded.includes(e));
};

export const entitled = (
  type: OrgType,
  tier: PlanTier | null | undefined,
  plan: PlanCode | null | undefined,
  entitlement: Entitlement,
): boolean => entitlementsFor(type, tier, plan).includes(entitlement);

/** Người cân gói Vựa có sẵn (chốt 31/10/2026). */
export const STAFF_INCLUDED = 3;
/** Người cân mua thêm tối đa — tổng 8, giá vẫn dưới gói doanh nghiệp. */
export const EXTRA_STAFF_MAX = 5;

/**
 * Số người (không tính chủ) tối đa theo gói: Thương lái 0, Vựa 3 + số mua thêm. `plan` null (doanh nghiệp) =
 * không giới hạn theo người — doanh nghiệp giới hạn theo chi nhánh (`branchLimit`).
 */
export const staffLimit = (plan: PlanCode | null | undefined, extraStaff: number): number | null =>
  plan === 'thuong_lai' ? 0 : plan === 'vua' ? STAFF_INCLUDED + extraStaff : null;

/** @deprecated 0.28.0 — giới hạn theo gói: `staffLimit(plan, extraStaff)` hoặc `PlanSummary.staffLimit`. */
export const STAFF_LIMIT: Readonly<Partial<Record<OrgType, number>>> = { trader: STAFF_INCLUDED };
