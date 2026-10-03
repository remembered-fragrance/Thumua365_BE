/**
 * Tài khoản, gói, thanh toán, quản trị — KH backend §1.7, §6, BE6.
 *
 * Thu tiền: chủ VỰA tự mua gói (149.000đ/tháng · 1.490.000đ/năm) bằng chuyển khoản kèm mã đối soát;
 * Casso / SePay báo biến động số dư về `/webhooks/bank` → gói tự gia hạn. Doanh nghiệp: gói theo số
 * chi nhánh, bán trực tiếp, quản trị viên kích hoạt. Nông dân: miễn phí, không có màn Gói.
 * KHÔNG có lệnh rút tiền — giữ tiền hộ rồi chi ra là trung gian thanh toán, cần giấy phép NHNN.
 *
 * Xoá tài khoản (`DELETE /v1/me`) là xoá THẬT: ảnh chứng từ → dữ liệu → tài khoản đăng nhập. Chủ tổ
 * chức còn người khác đang làm thì phải gỡ họ trước. Sổ đối soát ngân hàng và nhật ký giữ lại.
 */

import { z } from 'zod';
import { PlanSummary } from './me.js';
import { OrgType } from './organization.js';

const Time = z.iso.datetime({ offset: true });
const Money = z.number().int().nonnegative();

// ─── Hồ sơ ───────────────────────────────────────────────────────────────────

export const MeProfile = z.object({
  name: z.string(),
  /** Tên đăng nhập tuỳ chọn (không phân biệt hoa thường). */
  username: z.string().nullable(),
  /** +84… — là khoá đăng nhập, không đổi ở đây. */
  phone: z.string().nullable(),
  /** Email thật để tự lấy lại mật khẩu. */
  recoveryEmail: z.string().nullable(),
  /** Mã giới thiệu của mình để mời người khác. */
  referralCode: z.string().nullable(),
  /** Đã ghi nhận ai mời mình chưa (ghi một lần, không đổi). */
  referred: z.boolean(),
});
export type MeProfile = z.infer<typeof MeProfile>;

/** Bỏ trường = không đổi; `null` = xoá. Tên đăng nhập đã có người dùng → 422 `fields.username`. */
export const MeProfilePatch = z
  .strictObject({
    name: z.string().trim().min(1).max(80),
    username: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9._]{3,32}$/)
      .nullable(),
    recoveryEmail: z.email().max(200).nullable(),
  })
  .partial()
  .refine((p) => Object.keys(p).length > 0, { message: 'Không có trường nào để sửa' });
export type MeProfilePatch = z.input<typeof MeProfilePatch>;

/** Luôn 200: không cho biết vì sao mã không dùng được — tránh dò xem mã nào có thật. */
export const ReferralClaimInput = z.strictObject({ code: z.string().trim().min(1).max(20) });
export type ReferralClaimInput = z.input<typeof ReferralClaimInput>;
export const ReferralClaimResult = z.object({ claimed: z.boolean() });
export type ReferralClaimResult = z.infer<typeof ReferralClaimResult>;

// ─── Gói ─────────────────────────────────────────────────────────────────────

export const PlanPrice = z.object({ months: z.number().int().positive(), amount: Money });
export type PlanPrice = z.infer<typeof PlanPrice>;

export const SubscriptionView = z.object({
  /** null với nông dân. */
  plan: PlanSummary.nullable(),
  trialEndsAt: Time.nullable(),
  currentPeriodEnd: Time.nullable(),
  /** Vựa tự mua qua chuyển khoản; doanh nghiệp liên hệ để kích hoạt (false). */
  selfServe: z.boolean(),
  prices: z.array(PlanPrice),
});
export type SubscriptionView = z.infer<typeof SubscriptionView>;

// ─── Ý định thanh toán ───────────────────────────────────────────────────────

export const PaymentIntentStatus = z.enum(['pending', 'paid', 'failed', 'expired']);
export type PaymentIntentStatus = z.infer<typeof PaymentIntentStatus>;

export const PaymentIntentView = z.object({
  id: z.uuid(),
  amount: Money,
  months: z.number().int().positive(),
  /** Mã 6 ký tự đối soát. */
  code: z.string(),
  /** Nội dung chuyển khoản phải ghi đúng — `TM365 <mã>`; app đưa vào mã QR. */
  transferContent: z.string(),
  status: PaymentIntentStatus,
  createdAt: Time,
});
export type PaymentIntentView = z.infer<typeof PaymentIntentView>;

/** Mới nhất trước, tối đa 12. */
export const PaymentIntentsList = z.object({ intents: z.array(PaymentIntentView) });
export type PaymentIntentsList = z.infer<typeof PaymentIntentsList>;

/** Gọi lại trong 24 giờ với cùng số tháng → trả lại ý định đang chờ, không sinh mã mới. */
export const PaymentIntentCreateInput = z.strictObject({ months: z.union([z.literal(1), z.literal(12)]) });
export type PaymentIntentCreateInput = z.input<typeof PaymentIntentCreateInput>;

// ─── Webhook ngân hàng ───────────────────────────────────────────────────────

/** Casso gửi `{ data: [...] }`, SePay gửi một giao dịch phẳng — server đọc được cả hai. */
export const BankWebhookBody = z.record(z.string(), z.unknown());
export const BankWebhookResult = z.object({
  /** Mã giao dịch ngân hàng đã mở / gia hạn gói. */
  handled: z.array(z.string()),
  /** Không có mã, không khớp ý định, thiếu tiền, hoặc đã xử lý rồi — để đường thủ công. */
  skipped: z.array(z.string()),
});
export type BankWebhookResult = z.infer<typeof BankWebhookResult>;

// ─── Quản trị ────────────────────────────────────────────────────────────────

const Approval = {
  /** Người duyệt — gõ tay, bắt buộc. Vào `admin_access_log`. */
  approvedBy: z.string().trim().min(2).max(80),
  reason: z.string().trim().max(300).optional(),
};

/**
 * Kích hoạt gói bằng tay: chuyển khoản gõ sai nội dung, hoặc gói doanh nghiệp. Mã giao dịch ngân hàng
 * BẮT BUỘC — vào sổ đối soát làm khoá chống trùng, webhook về sau không cộng thêm kỳ nữa.
 */
export const AdminActivatePlanInput = z
  .strictObject({
    /** Một trong hai: id tổ chức, hoặc số điện thoại của CHỦ (chỉ khi người đó chủ đúng một tổ chức có gói). */
    organizationId: z.uuid().optional(),
    ownerPhone: z.string().trim().min(9).max(20).optional(),
    months: z.number().int().min(1).max(36),
    amount: Money,
    bankTxId: z.string().trim().min(3).max(100),
    /** Doanh nghiệp: số chi nhánh tối đa; bỏ trống = giữ nguyên. */
    branchLimit: z.number().int().positive().nullable().optional(),
    ...Approval,
  })
  .refine((v) => Boolean(v.organizationId) !== Boolean(v.ownerPhone), {
    message: 'Gửi đúng một trong organizationId, ownerPhone',
    path: ['organizationId'],
  });
export type AdminActivatePlanInput = z.input<typeof AdminActivatePlanInput>;

export const AdminActivatePlanResult = z.object({
  organization: z.object({ id: z.uuid(), name: z.string(), type: OrgType }),
  plan: PlanSummary,
  /** Mã giao dịch này đã được xử lý trước đó (webhook hoặc lần chạy trước) — không cộng thêm. */
  alreadyProcessed: z.boolean(),
});
export type AdminActivatePlanResult = z.infer<typeof AdminActivatePlanResult>;

/** Chỉ cho người KHÔNG khai email khôi phục — đã xác minh danh tính qua kênh khác (VAN_HANH §8). */
export const AdminResetPasswordInput = z.strictObject({
  phone: z.string().trim().min(9).max(20),
  newPassword: z.string().min(8).max(72),
  ...Approval,
});
export type AdminResetPasswordInput = z.input<typeof AdminResetPasswordInput>;

export const AdminDoneResult = z.object({ ok: z.literal(true) });
export type AdminDoneResult = z.infer<typeof AdminDoneResult>;

// ─── Xoá tài khoản ───────────────────────────────────────────────────────────

export const AccountDeleteResult = z.object({
  /** Tổ chức bị xoá theo (mình là chủ, không còn ai khác). */
  deletedOrganizations: z.array(z.uuid()),
  /** Tổ chức mình chỉ rời đi (không phải chủ). */
  leftOrganizations: z.array(z.uuid()),
});
export type AccountDeleteResult = z.infer<typeof AccountDeleteResult>;
