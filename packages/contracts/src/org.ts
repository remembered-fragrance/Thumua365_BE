/**
 * Nhân viên, chi nhánh, báo cáo tổng — KH backend §6, BE7.
 *
 * Nhân viên: CHỦ tạo tài khoản cho người cân / quản lý (tên, số điện thoại, mật khẩu ban đầu) —
 * người đó đăng nhập bằng số điện thoại như mọi người, đổi mật khẩu sau. Không cần OTP, không phải
 * tự đăng ký. Số đã có tài khoản ở nơi khác → `VALIDATION_FAILED` với `details.reason:
 * 'ACCOUNT_EXISTS'` (mời tài khoản có sẵn: giai đoạn sau). Người từng bị gỡ khỏi CHÍNH tổ chức này
 * thì được bật lại, giữ tài khoản cũ.
 *
 * Vai trò thêm được: vựa — `staff`; doanh nghiệp — `manager`, `staff`. Không ai thêm, sửa, gỡ được
 * `owner`, và không tự sửa / gỡ chính mình. Gỡ = mất quyền NGAY (membership `removed`).
 *
 * Chi nhánh: số chi nhánh còn dùng ≤ `branchLimit` của gói (null = không giới hạn); vượt →
 * 402 `BRANCH_LIMIT` kèm `details.limit`. Chi nhánh chỉ lưu trữ (ẩn), không xoá — phiếu cũ vẫn trỏ
 * tới nó; còn người đang gắn thì không lưu trữ được.
 */

import { z } from 'zod';
import { MemberRole } from './organization.js';

const Time = z.iso.datetime({ offset: true });
const Name = z.string().trim().min(1).max(120);
const Address = z.string().trim().max(300).nullable().optional();

export const IdParams = z.strictObject({ id: z.uuid() });
export type IdParams = z.infer<typeof IdParams>;

export const BranchRef = z.object({ id: z.uuid(), name: z.string() });
export type BranchRef = z.infer<typeof BranchRef>;

// ─── Nhân viên ───────────────────────────────────────────────────────────────

export const MemberStatus = z.enum(['invited', 'active', 'removed']);
export type MemberStatus = z.infer<typeof MemberStatus>;

/** Vai trò chủ gán cho người khác — không bao giờ là `owner`. */
export const AssignableRole = z.enum(['manager', 'staff']);
export type AssignableRole = z.infer<typeof AssignableRole>;

export const OrgMember = z.object({
  /** Id của membership — dùng cho PATCH / DELETE. */
  id: z.uuid(),
  userId: z.uuid(),
  name: z.string().nullable(),
  /** +84… */
  phone: z.string().nullable(),
  role: MemberRole,
  branch: BranchRef.nullable(),
  status: MemberStatus,
  isMe: z.boolean(),
  createdAt: Time,
});
export type OrgMember = z.infer<typeof OrgMember>;

/** Đang làm trước, đã gỡ sau. */
export const OrgMembersList = z.object({ members: z.array(OrgMember) });
export type OrgMembersList = z.infer<typeof OrgMembersList>;

export const OrgMemberCreateInput = z.strictObject({
  name: z.string().trim().min(1).max(80),
  /** Số điện thoại Việt Nam — là tên đăng nhập của người đó. */
  phone: z.string().trim().min(9).max(20),
  /** Mật khẩu ban đầu, chủ đưa cho người đó; đổi được sau. */
  password: z.string().min(8).max(72),
  role: AssignableRole,
  /** Doanh nghiệp: chi nhánh của người này. Bỏ trống = cả tổ chức. */
  branchId: z.uuid().nullable().optional(),
});
export type OrgMemberCreateInput = z.input<typeof OrgMemberCreateInput>;

/** Đổi chi nhánh làm máy của người đó xoá sổ cục bộ ở lần kéo tới (`resetRequired`). */
export const OrgMemberPatch = z
  .strictObject({ role: AssignableRole, branchId: z.uuid().nullable() })
  .partial()
  .refine((p) => Object.keys(p).length > 0, { message: 'Không có trường nào để sửa' });
export type OrgMemberPatch = z.input<typeof OrgMemberPatch>;

// ─── Chi nhánh ───────────────────────────────────────────────────────────────

export const OrgBranch = z.object({
  id: z.uuid(),
  name: z.string(),
  address: z.string().nullable(),
  /** Đã lưu trữ — không gắn người mới, không tính vào giới hạn của gói. */
  archived: z.boolean(),
  /** Số người đang gắn với chi nhánh này. */
  memberCount: z.number().int().nonnegative(),
  createdAt: Time,
});
export type OrgBranch = z.infer<typeof OrgBranch>;

export const OrgBranchesList = z.object({
  branches: z.array(OrgBranch),
  /** Giới hạn của gói; null = không giới hạn. */
  limit: z.number().int().positive().nullable(),
  /** Số chi nhánh đang dùng (chưa lưu trữ). */
  used: z.number().int().nonnegative(),
});
export type OrgBranchesList = z.infer<typeof OrgBranchesList>;

export const OrgBranchCreateInput = z.strictObject({ name: Name, address: Address });
export type OrgBranchCreateInput = z.input<typeof OrgBranchCreateInput>;

export const OrgBranchPatch = z
  .strictObject({ name: Name, address: Address, archived: z.boolean() })
  .partial()
  .refine((p) => Object.keys(p).length > 0, { message: 'Không có trường nào để sửa' });
export type OrgBranchPatch = z.input<typeof OrgBranchPatch>;

// ─── Báo cáo tổng ────────────────────────────────────────────────────────────

/**
 * Một chiều mua hoặc bán, nhìn từ tổ chức đang làm việc. Tiền là số nguyên đồng; khối lượng là
 * số tính tiền (sau bì / hàm lượng / hao hụt). Tính bằng `@mambo/core` như trên app.
 */
export const ReportSide = z.object({
  count: z.number().int().nonnegative(),
  netWeight: z.number(),
  amount: z.number().int(),
  paid: z.number().int(),
  debt: z.number().int(),
});
export type ReportSide = z.infer<typeof ReportSide>;

export const ReportFigures = z.object({ purchase: ReportSide, sale: ReportSide });
export type ReportFigures = z.infer<typeof ReportFigures>;

export const ReportSummaryQuery = z
  .strictObject({
    /** Từ (gồm) — app tính đầu ngày theo giờ Việt Nam. */
    from: z.iso.datetime({ offset: true }),
    /** Đến (không gồm). Tối đa 366 ngày. */
    to: z.iso.datetime({ offset: true }),
    /** Chỉ một chi nhánh (chủ). Người gắn chi nhánh luôn chỉ thấy chi nhánh mình. */
    branchId: z.uuid().optional(),
  })
  .refine((q) => Date.parse(q.from) < Date.parse(q.to), { message: '`from` phải trước `to`', path: ['to'] })
  .refine((q) => Date.parse(q.to) - Date.parse(q.from) <= 366 * 86_400_000, { message: 'Tối đa 366 ngày', path: ['to'] });
export type ReportSummaryQuery = z.output<typeof ReportSummaryQuery>;

/**
 * Vựa / doanh nghiệp: phiếu trong sổ, chia theo chi nhánh (`branch: null` = không gắn chi nhánh).
 * Nông dân: phiếu các vựa đang kết nối ghi về mình, nhìn từ phía mình (vựa MUA của mình = mình BÁN);
 * `branches` rỗng. Phiếu đã xoá không tính; `paid`/`debt` tính tới hiện tại.
 */
export const ReportSummary = z.object({
  from: Time,
  to: Time,
  totals: ReportFigures,
  branches: z.array(z.object({ branch: BranchRef.nullable(), figures: ReportFigures })),
});
export type ReportSummary = z.infer<typeof ReportSummary>;
