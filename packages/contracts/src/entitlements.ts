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
import type { PlanTier as PlanTierSchema } from './me.js';
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
] as const;

export const Entitlement = z.enum(ENTITLEMENTS);
export type Entitlement = z.infer<typeof Entitlement>;

type PlanTier = z.infer<typeof PlanTierSchema>;

const PAID_TIERS: readonly PlanTier[] = ['trial', 'premium', 'grace'];

/** Dùng thử, đang trả tiền, ân hạn: đủ quyền lợi. Hết gói, chưa có gói, nông dân: không có gì. */
export const entitlementsFor = (type: OrgType, tier: PlanTier | null | undefined): readonly Entitlement[] =>
  hasBook(type) && tier && PAID_TIERS.includes(tier) ? ENTITLEMENTS : [];

export const entitled = (type: OrgType, tier: PlanTier | null | undefined, entitlement: Entitlement): boolean =>
  entitlementsFor(type, tier).includes(entitlement);

/**
 * Số người (không tính chủ) tối đa trong một tổ chức có gói. Vựa: 3 người cân (§10 mục 2, chốt 24/10/2026).
 * Doanh nghiệp không giới hạn số người — giới hạn theo chi nhánh (`branchLimit`).
 */
export const STAFF_LIMIT: Readonly<Partial<Record<OrgType, number>>> = { trader: 3 };
