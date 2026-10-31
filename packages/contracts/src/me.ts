/**
 * `GET /v1/me` — thứ frontend dùng để chọn vỏ giao diện và ẩn/hiện chức năng
 * (KH backend §3.2). `permissions` chỉ để ẩn/hiện; server luôn kiểm lại.
 */

import { isPhoneLike } from '@mambo/core/identifier';
import type { PlanTier as CorePlanTier, SubscriptionStatus as CoreSubscriptionStatus } from '@mambo/core/subscription';
import { z } from 'zod';
import { MemberRole, OrgType } from './organization.js';
import { Permission } from './permissions.js';

/** Trạng thái gói lưu trong DB — cùng tập giá trị với `@mambo/core/subscription`. */
export const SubscriptionStatus = z.enum(['trialing', 'active', 'past_due', 'canceled']);

/** Bậc gói suy ra từ ngày tháng — cùng tập giá trị với `@mambo/core/subscription`. */
export const PlanTier = z.enum(['trial', 'premium', 'grace', 'free']);

// Lệch với core là lỗi biên dịch, không phải lỗi lúc chạy.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const statusMatchesCore: Same<z.infer<typeof SubscriptionStatus>, CoreSubscriptionStatus> = true;
const tierMatchesCore: Same<z.infer<typeof PlanTier>, CorePlanTier> = true;
void statusMatchesCore;
void tierMatchesCore;

/** Tính năng bật theo tổ chức — cách mở dần tính năng mới cho nhóm pilot (KH §3.3). */
export const Feature = z.enum(['orders', 'links']);
export type Feature = z.infer<typeof Feature>;

/**
 * Gói của tài khoản vựa (0.28.0): Thương lái làm một mình, Vựa có người cân. Cùng một `OrgType` `trader` —
 * `trader` đã dùng ở kết nối, bản đồ, đơn hàng nên không tách loại tổ chức. Doanh nghiệp không có mã gói (null).
 */
export const PlanCode = z.enum(['thuong_lai', 'vua']);
export type PlanCode = z.infer<typeof PlanCode>;

export const PlanSummary = z.object({
  tier: PlanTier,
  status: SubscriptionStatus,
  periodEnd: z.iso.datetime({ offset: true }).nullable(),
  /** Chỉ doanh nghiệp có; null = không giới hạn theo gói. */
  branchLimit: z.number().int().positive().nullable(),
  /** 0.28.0 — gói vựa đã chọn; doanh nghiệp null. Bậc (`tier`) vẫn suy từ ngày tháng, mã gói chỉ nói "gói nào". */
  plan: PlanCode.nullable(),
  /** 0.28.0 — số người cân mua thêm ngoài 3 người gói Vựa có sẵn (0–5). */
  extraStaff: z.number().int().nonnegative(),
  /** 0.28.0 — số người (không tính chủ) tối đa: `staffLimit(plan, extraStaff)`; null = không giới hạn theo người. */
  staffLimit: z.number().int().nonnegative().nullable(),
});
export type PlanSummary = z.infer<typeof PlanSummary>;

export const MeMembership = z.object({
  organization: z.object({ id: z.uuid(), type: OrgType, name: z.string() }),
  role: MemberRole,
  branch: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  permissions: z.array(Permission),
  /** Nông dân không có gói — luôn null. */
  plan: PlanSummary.nullable(),
  features: z.array(Feature),
});
export type MeMembership = z.infer<typeof MeMembership>;

export const MeUser = z.object({
  id: z.uuid(),
  name: z.string().nullable(),
  /** E.164, có dấu `+`. */
  phone: z.string().nullable(),
  email: z.string().nullable(),
  /** Số điện thoại đã xác thực OTP — điều kiện để dò kết nối (KH §1.4). */
  phoneVerified: z.boolean(),
});
export type MeUser = z.infer<typeof MeUser>;

export const Me = z.object({
  user: MeUser,
  memberships: z.array(MeMembership),
  /** Số lời mời kết nối đang chờ người này đồng ý. */
  pendingLinks: z.number().int().nonnegative(),
});
export type Me = z.infer<typeof Me>;

/**
 * `POST /v1/me/bootstrap` — bước "Bạn là ai?" ngay sau khi đăng ký (KH §6).
 *
 * Tạo hồ sơ + tổ chức + membership `owner` (+ gói dùng thử 30 ngày cho vựa và
 * doanh nghiệp) trong MỘT transaction. Idempotent: người đã có tổ chức gọi lại
 * nhận về `Me` hiện tại, không tạo tổ chức thứ hai.
 */
/**
 * Tên đăng nhập: 3–32 ký tự a-z, 0-9, `.`, `_`, không phân biệt hoa thường — và KHÔNG được giống số
 * điện thoại: đăng nhập một ô tra SĐT trước, tên "0912345678" sẽ chen vào việc đăng nhập bằng số đó.
 * Database giữ cùng luật (`profiles_username_not_phone`).
 */
export const Username = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._]{3,32}$/)
  .refine((u) => !isPhoneLike(u), 'Tên đăng nhập không được giống số điện thoại');

export const MeBootstrapInput = z
  .strictObject({
    orgType: OrgType,
    /** Tên hiển thị của tổ chức: "Vựa Tư Hùng", "Hộ cô Mai". */
    orgName: z.string().trim().min(1).max(120),
    /** Tên người đăng ký. */
    name: z.string().trim().min(1).max(80),
    /**
     * Chỉ dùng khi đăng ký bằng email thật. Tài khoản đăng ký bằng số điện thoại
     * (email nội bộ `84…@id.thumua365.vn`) lấy số từ chính tài khoản — trường này bị bỏ qua.
     */
    phone: z.string().trim().min(1).max(20).optional(),
    /** Tên đăng nhập tuỳ chọn — xem `Username`. */
    username: Username.optional(),
    /**
     * 0.28.0 — gói đã chọn ở màn đăng ký, chỉ cho `trader`. Dùng thử 30 ngày có đúng tính năng của gói này
     * (Thương lái: không thêm người cân). Bỏ trống → `vua` (app cũ chưa gửi trường này).
     */
    plan: PlanCode.optional(),
  })
  .refine((v) => v.plan === undefined || v.orgType === 'trader', {
    message: 'Chỉ tài khoản vựa chọn gói lúc đăng ký',
    path: ['plan'],
  });
export type MeBootstrapInput = z.input<typeof MeBootstrapInput>;
