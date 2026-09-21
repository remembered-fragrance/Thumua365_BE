/**
 * `GET /v1/me` — thứ frontend dùng để chọn vỏ giao diện và ẩn/hiện chức năng
 * (KH backend §3.2). `permissions` chỉ để ẩn/hiện; server luôn kiểm lại.
 */

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

export const PlanSummary = z.object({
  tier: PlanTier,
  status: SubscriptionStatus,
  periodEnd: z.iso.datetime({ offset: true }).nullable(),
  /** Chỉ doanh nghiệp có; null = không giới hạn theo gói. */
  branchLimit: z.number().int().positive().nullable(),
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
