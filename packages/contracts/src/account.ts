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
import { PlanSummary, Username } from './me.js';
import { OrgType } from './organization.js';
import { Password } from './password.js';

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
  /** Chủ hộp thư đã bấm link xác nhận (0.16.0). Chỉ email đã xác nhận mới nhận thư đặt lại mật khẩu. */
  recoveryEmailVerified: z.boolean(),
  /** Mã giới thiệu của mình để mời người khác. */
  referralCode: z.string().nullable(),
  /** Đã ghi nhận ai mời mình chưa (ghi một lần, không đổi). */
  referred: z.boolean(),
});
export type MeProfile = z.infer<typeof MeProfile>;

/**
 * Bỏ trường = không đổi; `null` = xoá. Tên đăng nhập (`Username`) đã có người dùng → 422
 * `fields.username`; email khôi phục hồ sơ khác đang dùng → 422 `fields.recoveryEmail`.
 */
export const MeProfilePatch = z
  .strictObject({
    name: z.string().trim().min(1).max(80),
    username: Username.nullable(),
    recoveryEmail: z.email().max(200).nullable(),
  })
  .partial()
  .refine((p) => Object.keys(p).length > 0, { message: 'Không có trường nào để sửa' });
export type MeProfilePatch = z.input<typeof MeProfilePatch>;

// ─── Xác nhận email khôi phục · quên mật khẩu (0.16.0) ──────────────────────

/**
 * `sent` — đã gửi thư có link xác nhận (hết hạn sau 24 giờ); `already_verified` — không cần gửi;
 * `no_email` — hồ sơ chưa có email khôi phục; `too_soon` — vừa gửi trong 60 giây trước, chờ rồi thử lại.
 */
export const RecoveryEmailVerifyResult = z.object({
  status: z.enum(['sent', 'already_verified', 'no_email', 'too_soon']),
});
export type RecoveryEmailVerifyResult = z.infer<typeof RecoveryEmailVerifyResult>;

/** Mã trong link xác nhận (`/xac-nhan-email?token=…`). */
export const RecoveryEmailConfirmInput = z.strictObject({ token: z.string().trim().min(20).max(200) });
export type RecoveryEmailConfirmInput = z.input<typeof RecoveryEmailConfirmInput>;
/** `email: null` — link sai, đã dùng, đã hết hạn, hoặc email đã đổi sau khi gửi. */
export const RecoveryEmailConfirmResult = z.object({ email: z.string().nullable() });
export type RecoveryEmailConfirmResult = z.infer<typeof RecoveryEmailConfirmResult>;

/** Một ô như đăng nhập: số điện thoại, tên đăng nhập, hoặc email. */
export const PasswordResetRequestInput = z.strictObject({ identifier: z.string().trim().min(1).max(200) });
export type PasswordResetRequestInput = z.input<typeof PasswordResetRequestInput>;
/**
 * Luôn `{ ok: true }` dù có tài khoản hay không, có email đã xác nhận hay không — không cho dò ai có
 * tài khoản. Có thì thư có link đặt lại mật khẩu tới email đã xác nhận.
 */
export const PasswordResetRequestResult = z.object({ ok: z.literal(true) });
export type PasswordResetRequestResult = z.infer<typeof PasswordResetRequestResult>;

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
/**
 * 0.27.0: đúng `{"success": true}` — SePay chỉ coi là gửi thành công khi body đúng như vậy (khác là gửi lại, bắn cảnh
 * báo). Casso chỉ cần 2xx. Mã giao dịch đã mở gói / bỏ qua nằm trong log `bank_webhook`, không trả về.
 */
export const BankWebhookResult = z.object({ success: z.literal(true) });
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

/**
 * Chỉ cho người KHÔNG có email khôi phục ĐÃ XÁC NHẬN (có thì họ tự đặt lại qua email) — đã xác minh
 * danh tính qua kênh khác (VAN_HANH §8).
 */
export const AdminResetPasswordInput = z.strictObject({
  phone: z.string().trim().min(9).max(20),
  newPassword: Password,
  ...Approval,
});
export type AdminResetPasswordInput = z.input<typeof AdminResetPasswordInput>;

export const AdminDoneResult = z.object({ ok: z.literal(true) });
export type AdminDoneResult = z.infer<typeof AdminDoneResult>;

// ─── Xoá tài khoản ───────────────────────────────────────────────────────────

export const AccountDeleteResult = z.object({
  /** Tổ chức bị xoá theo (mình là chủ, không còn ai khác). */
  deletedOrganizations: z.array(z.uuid()),
  /** @deprecated 0.13.0 — luôn rỗng: còn làm thuê ở đâu thì 422 `STILL_MEMBER`, chủ gỡ ra trước. */
  leftOrganizations: z.array(z.uuid()),
});
export type AccountDeleteResult = z.infer<typeof AccountDeleteResult>;
