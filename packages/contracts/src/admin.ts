/**
 * Trang quản trị đầy đủ (0.32.0) — tổng quan, tổ chức, mã sáng lập, cờ tính năng, người dùng, phản hồi, nhật ký.
 * Ba route quản trị cũ (mở gói tay, đặt lại mật khẩu, giao dịch) vẫn ở `account.ts`, phễu ở `events.ts`.
 *
 * Mọi route ở đây `auth: 'admin'`. Xem dữ liệu của một người / một tổ chức, hay đổi gì, đều ghi `admin_access_log`.
 */

import { z } from 'zod';
import { AdminPaymentRow, PromoRedeemInput } from './account.js';
import { Feature, PlanCode, PlanSummary, SubscriptionStatus } from './me.js';
import { MemberStatus } from './org.js';
import { MemberRole, OrgType } from './organization.js';

const Time = z.iso.datetime({ offset: true });
const Money = z.number().int().nonnegative();
const Count = z.number().int().nonnegative();

/** Người duyệt — gõ tay, bắt buộc với mọi việc ĐỔI dữ liệu. Vào `admin_access_log` như các route quản trị cũ. */
const Approval = {
  approvedBy: z.string().trim().min(2).max(80),
  reason: z.string().trim().max(300).optional(),
};

const OrgRef = z.object({ id: z.uuid(), name: z.string(), type: OrgType });

// ─── Tổng quan ───────────────────────────────────────────────────────────────

/** Số trong ngày theo giờ Việt Nam (`YYYY-MM-DD`). */
export const AdminDayCount = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), count: Count });
export type AdminDayCount = z.infer<typeof AdminDayCount>;

export const AdminMonthRevenue = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/), amount: Money, count: Count });
export type AdminMonthRevenue = z.infer<typeof AdminMonthRevenue>;

/**
 * Số liệu chung lúc `generatedAt`. Tổ chức đã xoá không tính. Doanh thu = tiền đã mở gói (`bank_transactions`
 * `applied`, cả webhook lẫn mở tay) — tiền kẹt (chuyển thiếu, sai mã) đếm riêng ở `payments.needsReview`.
 */
export const AdminOverview = z.object({
  generatedAt: Time,
  organizations: z.object({ total: Count, farmer: Count, trader: Count, enterprise: Count }),
  /** Tổ chức mới trong 7 / 30 ngày qua. */
  newOrganizations: z.object({ last7Days: Count, last30Days: Count }),
  /** Tổ chức mới theo ngày, 30 ngày gần nhất, đủ cả ngày 0. */
  signupsByDay: z.array(AdminDayCount),
  users: Count,
  /** Vựa + doanh nghiệp theo bậc gói (nông dân không có gói). */
  plans: z.object({ trial: Count, premium: Count, grace: Count, free: Count }),
  /** Đang trả tiền theo gói: Thương lái / Vựa / doanh nghiệp. */
  premiumByPlan: z.object({ thuong_lai: Count, vua: Count, enterprise: Count }),
  /** Gói trả tiền hoặc dùng thử hết hạn trong 7 ngày tới. */
  expiringSoon: Count,
  revenue: z.object({ total: Money, last30Days: Money, byMonth: z.array(AdminMonthRevenue) }),
  payments: z.object({
    /** Tiền đã vào sổ đối soát mà chưa mở gói — cần xem và mở tay. */
    needsReview: Count,
    /** Ý định chuyển khoản còn chờ tiền. */
    pendingIntents: Count,
  }),
  feedback: z.object({ count: Count, averageRating: z.number().min(1).max(5).nullable() }),
});
export type AdminOverview = z.infer<typeof AdminOverview>;

// ─── Tổ chức ─────────────────────────────────────────────────────────────────

export const ADMIN_ORGANIZATIONS_MAX = 500;

export const AdminOrganizationsQuery = z.strictObject({
  /** Tìm theo tên tổ chức, hoặc số điện thoại / tên của chủ. */
  q: z.string().trim().max(100).optional(),
  type: OrgType.optional(),
});
export type AdminOrganizationsQuery = z.output<typeof AdminOrganizationsQuery>;

const AdminPerson = z.object({ userId: z.uuid(), name: z.string().nullable(), phone: z.string().nullable() });

export const AdminOrganizationRow = z.object({
  id: z.uuid(),
  name: z.string(),
  type: OrgType,
  createdAt: Time,
  /** Chủ đang hoạt động; null khi không còn chủ nào. */
  owner: AdminPerson.nullable(),
  /** Người đang hoạt động trong tổ chức, kể cả chủ. */
  members: Count,
  /** null với nông dân và tổ chức chưa có hàng gói. */
  plan: PlanSummary.nullable(),
  features: z.array(Feature),
});
export type AdminOrganizationRow = z.infer<typeof AdminOrganizationRow>;

/** Mới tạo trước, tối đa `ADMIN_ORGANIZATIONS_MAX` dòng. */
export const AdminOrganizations = z.object({ rows: z.array(AdminOrganizationRow).max(ADMIN_ORGANIZATIONS_MAX) });
export type AdminOrganizations = z.infer<typeof AdminOrganizations>;

export const AdminOrganizationParams = z.strictObject({ id: z.uuid() });
export type AdminOrganizationParams = z.infer<typeof AdminOrganizationParams>;

export const AdminOrganizationMember = z.object({
  userId: z.uuid(),
  name: z.string().nullable(),
  phone: z.string().nullable(),
  username: z.string().nullable(),
  role: MemberRole,
  status: MemberStatus,
  branch: z.string().nullable(),
  joinedAt: Time,
});
export type AdminOrganizationMember = z.infer<typeof AdminOrganizationMember>;

export const AdminPromoRow = z.object({
  code: z.string(),
  plan: PlanCode,
  monthlyAmount: Money,
  periods: z.number().int().positive(),
  periodsUsed: Count,
  /** Tổ chức đã nhập mã; null = mã chưa phát / chưa ai dùng. */
  organization: OrgRef.nullable(),
  redeemedAt: Time.nullable(),
  note: z.string().nullable(),
  createdAt: Time,
});
export type AdminPromoRow = z.infer<typeof AdminPromoRow>;

/** Số giao dịch gần nhất của một tổ chức trong trang chi tiết. */
export const ADMIN_ORGANIZATION_PAYMENTS = 50;

export const AdminOrganizationDetail = z.object({
  id: z.uuid(),
  name: z.string(),
  type: OrgType,
  phone: z.string().nullable(),
  address: z.string().nullable(),
  createdAt: Time,
  plan: PlanSummary.nullable(),
  subscription: z
    .object({
      status: SubscriptionStatus,
      trialEndsAt: Time.nullable(),
      currentPeriodEnd: Time.nullable(),
      plan: PlanCode.nullable(),
      extraStaff: Count,
      billingMonths: z.number().int().nullable(),
      branchLimit: z.number().int().nullable(),
    })
    .nullable(),
  members: z.array(AdminOrganizationMember),
  features: z.array(Feature),
  promo: AdminPromoRow.nullable(),
  /** Bản ghi chưa xoá trong sổ của tổ chức. */
  usage: z.object({
    transactions: Count,
    suppliers: Count,
    buyers: Count,
    products: Count,
    orders: Count,
    /** Phiếu được sửa / tạo gần nhất. */
    lastActivityAt: Time.nullable(),
  }),
  payments: z.array(AdminPaymentRow).max(ADMIN_ORGANIZATION_PAYMENTS),
});
export type AdminOrganizationDetail = z.infer<typeof AdminOrganizationDetail>;

/** Bật / tắt một cờ tính năng cho một tổ chức. Gọi lại an toàn. */
export const AdminFeatureInput = z.strictObject({ feature: Feature, enabled: z.boolean(), ...Approval });
export type AdminFeatureInput = z.input<typeof AdminFeatureInput>;

export const AdminFeatures = z.object({ features: z.array(Feature) });
export type AdminFeatures = z.infer<typeof AdminFeatures>;

// ─── Mã sáng lập ─────────────────────────────────────────────────────────────

export const AdminPromoCodes = z.object({ rows: z.array(AdminPromoRow) });
export type AdminPromoCodes = z.infer<typeof AdminPromoCodes>;

/** Thêm một mã. Mã trùng → 422 `details.reason = 'PROMO_EXISTS'`. */
export const AdminPromoCreateInput = z.strictObject({
  code: PromoRedeemInput.shape.code,
  plan: PlanCode,
  monthlyAmount: z.number().int().positive(),
  periods: z.number().int().min(1).max(36),
  note: z.string().trim().max(200).optional(),
  ...Approval,
});
export type AdminPromoCreateInput = z.input<typeof AdminPromoCreateInput>;

/** Mã đường dẫn — cùng luật với ô nhập mã. */
export const AdminPromoParams = z.strictObject({ code: PromoRedeemInput.shape.code });
export type AdminPromoParams = z.output<typeof AdminPromoParams>;

/** Xoá mã CHƯA ai dùng (mã gõ sai, mã thu hồi). Mã đã gắn tổ chức → 422 `details.reason = 'PROMO_REDEEMED'`. */
export const AdminPromoDeleteQuery = z.strictObject({
  approvedBy: Approval.approvedBy,
  reason: Approval.reason,
});
export type AdminPromoDeleteQuery = z.output<typeof AdminPromoDeleteQuery>;

// ─── Người dùng ──────────────────────────────────────────────────────────────

export const ADMIN_USERS_MAX = 50;

export const AdminUsersQuery = z.strictObject({
  /** Số điện thoại (gõ kiểu nào cũng được), tên đăng nhập, hoặc một phần tên. */
  q: z.string().trim().min(2).max(100),
});
export type AdminUsersQuery = z.output<typeof AdminUsersQuery>;

export const AdminUserRow = z.object({
  id: z.uuid(),
  name: z.string(),
  username: z.string().nullable(),
  phone: z.string().nullable(),
  /** Có email khôi phục ĐÃ XÁC NHẬN — người này tự đặt lại mật khẩu được, quản trị viên không đặt hộ. */
  hasVerifiedRecoveryEmail: z.boolean(),
  createdAt: Time,
  memberships: z.array(z.object({ organization: OrgRef, role: MemberRole, status: MemberStatus })),
});
export type AdminUserRow = z.infer<typeof AdminUserRow>;

export const AdminUsers = z.object({ rows: z.array(AdminUserRow).max(ADMIN_USERS_MAX) });
export type AdminUsers = z.infer<typeof AdminUsers>;

// ─── Phản hồi ────────────────────────────────────────────────────────────────

export const ADMIN_FEEDBACK_MAX = 500;

export const AdminFeedbackQuery = z.strictObject({ from: Time, to: Time });
export type AdminFeedbackQuery = z.output<typeof AdminFeedbackQuery>;

export const AdminFeedbackRow = z.object({
  id: z.uuid(),
  createdAt: Time,
  rating: z.number().int().min(1).max(5),
  comment: z.string().nullable(),
  appVersion: z.string().nullable(),
  platform: z.string(),
  /** null khi tổ chức / người đã xoá tài khoản. */
  organization: OrgRef.nullable(),
  user: z.object({ name: z.string(), phone: z.string().nullable() }).nullable(),
});
export type AdminFeedbackRow = z.infer<typeof AdminFeedbackRow>;

export const AdminFeedback = z.object({ from: Time, to: Time, rows: z.array(AdminFeedbackRow).max(ADMIN_FEEDBACK_MAX) });
export type AdminFeedback = z.infer<typeof AdminFeedback>;

// ─── Nhật ký quản trị ────────────────────────────────────────────────────────

export const ADMIN_ACCESS_LOG_MAX = 300;

export const AdminAccessLogRow = z.object({
  id: z.uuid(),
  createdAt: Time,
  /** `activate-plan`, `reset-password`, `list-payments`, `view-organization`, `set-feature`, … */
  action: z.string(),
  /** Người duyệt + tài khoản quản trị đã bấm (việc đổi dữ liệu), hoặc chỉ id tài khoản (việc xem). */
  operator: z.string(),
  reason: z.string().nullable(),
  organization: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  userId: z.uuid().nullable(),
});
export type AdminAccessLogRow = z.infer<typeof AdminAccessLogRow>;

/** Mới nhất trước, tối đa `ADMIN_ACCESS_LOG_MAX` dòng. */
export const AdminAccessLog = z.object({ rows: z.array(AdminAccessLogRow).max(ADMIN_ACCESS_LOG_MAX) });
export type AdminAccessLog = z.infer<typeof AdminAccessLog>;
