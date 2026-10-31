/**
 * Tài khoản, gói, thanh toán, quản trị — KH backend §1.7, §6, BE6.
 *
 * Thu tiền: chủ tài khoản vựa tự mua gói bằng chuyển khoản kèm mã đối soát — Thương lái 199.000đ/tháng, Vựa
 * 449.000đ/tháng (năm = 10 tháng), Vựa mua thêm người cân 79.000đ/người/tháng (0.28.0; giá do máy chủ giữ, app đọc
 * `prices`, `staffPrices`). Casso / SePay báo biến động số dư về `/webhooks/bank` → gói tự gia hạn. Doanh nghiệp: gói
 * theo số chi nhánh, bán trực tiếp, quản trị viên kích hoạt. Nông dân: miễn phí, không có màn Gói.
 * KHÔNG có lệnh rút tiền — giữ tiền hộ rồi chi ra là trung gian thanh toán, cần giấy phép NHNN.
 *
 * Xoá tài khoản (`DELETE /v1/me`) là xoá THẬT: ảnh chứng từ → dữ liệu → tài khoản đăng nhập. Chủ tổ
 * chức còn người khác đang làm thì phải gỡ họ trước. Sổ đối soát ngân hàng và nhật ký giữ lại.
 */

import { z } from 'zod';
import { EXTRA_STAFF_MAX } from './entitlements.js';
import { PlanCode, PlanSummary, Username } from './me.js';
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

const Months = z.union([z.literal(1), z.literal(12)]);

/** 0.28.0 thêm `plan`. Gói Vựa đứng trước: app cũ tìm giá theo `months` và lấy dòng đầu — mua theo mặc định là Vựa. */
export const PlanPrice = z.object({ plan: PlanCode, months: z.number().int().positive(), amount: Money });
export type PlanPrice = z.infer<typeof PlanPrice>;

/** Giá một người cân thêm cho trọn một kỳ (tháng / năm) — gia hạn Vựa cộng `số người × amount`. */
export const StaffPrice = z.object({ months: z.number().int().positive(), amount: Money });
export type StaffPrice = z.infer<typeof StaffPrice>;

/** Mua thêm `extraStaff` người cân giữa kỳ: máy chủ tính theo ngày còn lại tới hạn gói, hết hạn cùng gói. */
export const StaffTopUp = z.object({ extraStaff: z.number().int().positive(), amount: Money });
export type StaffTopUp = z.infer<typeof StaffTopUp>;

export const SubscriptionView = z.object({
  /** null với nông dân. */
  plan: PlanSummary.nullable(),
  trialEndsAt: Time.nullable(),
  currentPeriodEnd: Time.nullable(),
  /** Vựa tự mua qua chuyển khoản; doanh nghiệp liên hệ để kích hoạt (false). */
  selfServe: z.boolean(),
  prices: z.array(PlanPrice),
  /** 0.28.0 — rỗng khi không tự mua được. */
  staffPrices: z.array(StaffPrice),
  /**
   * 0.28.0 — giá mua thêm 1, 2… người cân NGAY BÂY GIỜ (tính theo ngày còn lại). Chỉ có khi đang gói Vựa đã trả
   * tiền, còn hạn và chưa đủ 8 người; rỗng = không có nút "Mua thêm người cân".
   */
  staffTopUps: z.array(StaffTopUp),
});
export type SubscriptionView = z.infer<typeof SubscriptionView>;

// ─── Ý định thanh toán ───────────────────────────────────────────────────────

export const PaymentIntentStatus = z.enum(['pending', 'paid', 'failed', 'expired']);
export type PaymentIntentStatus = z.infer<typeof PaymentIntentStatus>;

/** `plan` — mua / gia hạn gói; `staff` — mua thêm người cân giữa kỳ (không đổi hạn). */
export const PaymentKind = z.enum(['plan', 'staff']);
export type PaymentKind = z.infer<typeof PaymentKind>;

export const PaymentIntentView = z.object({
  id: z.uuid(),
  amount: Money,
  /**
   * `kind: 'staff'` luôn 1 — người cân mua thêm hết hạn cùng gói, không có số tháng; giữ số dương vì SDK của app trước
   * 0.28.0 kiểm phản hồi bằng schema cũ. Đọc `kind` trước khi đọc trường này.
   */
  months: z.number().int().positive(),
  /** 0.28.0. Ý định tạo trước 0.28.0 là `plan`. */
  kind: PaymentKind,
  /** 0.28.0 — gói mua; null với `staff`. Ý định cũ (149.000đ / 1.490.000đ) là `vua`. */
  plan: PlanCode.nullable(),
  /** 0.28.0 — `plan`: số người cân thêm trong kỳ mua; `staff`: số người mua thêm. */
  extraStaff: z.number().int().nonnegative(),
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

/**
 * Mua / gia hạn gói. App trước 0.28.0 chỉ gửi `{ months }` → gói Vựa, không người cân thêm. `extraStaff` chỉ cho gói
 * Vựa; gia hạn Vựa chọn lại số người cân thêm (ít hơn số người đang làm thì 422 — khoá bớt người cân trước).
 */
const PlanPurchase = z
  .strictObject({
    kind: z.literal('plan').default('plan'),
    plan: PlanCode.default('vua'),
    months: Months,
    extraStaff: z.number().int().min(0).max(EXTRA_STAFF_MAX).default(0),
  })
  .refine((v) => v.plan === 'vua' || v.extraStaff === 0, {
    message: 'Chỉ gói Vựa mua thêm người cân',
    path: ['extraStaff'],
  });

/** Mua thêm người cân giữa kỳ — chỉ khi đang gói Vựa đã trả tiền và còn hạn. */
const StaffPurchase = z.strictObject({
  kind: z.literal('staff'),
  extraStaff: z.number().int().min(1).max(EXTRA_STAFF_MAX),
});

/**
 * Số tiền do máy chủ tính, app không gửi. Gọi lại trong 24 giờ với cùng nội dung và cùng số tiền → trả lại ý định
 * đang chờ, không sinh mã mới.
 */
export const PaymentIntentCreateInput = z.union([StaffPurchase, PlanPurchase]);
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
    /** 0.28.0 — chỉ tài khoản vựa; bỏ trống = giữ gói đang có. Đổi Thương lái → Vựa thì quy đổi ngày còn lại như webhook. */
    plan: PlanCode.optional(),
    /** 0.28.0 — số người cân thêm (chỉ gói Vựa); bỏ trống = giữ nguyên. */
    extraStaff: z.number().int().min(0).max(EXTRA_STAFF_MAX).optional(),
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
