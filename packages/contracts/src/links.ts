/**
 * Kết nối giữa tổ chức — KH backend §1.4.
 *
 * Sổ của vựa vẫn là CỦA VỰA. Một kết nối nối một dòng danh bạ trong sổ bên `owner` (người bán /
 * người mua) với một tổ chức có tài khoản thật bên `linked`. Bên linked chỉ NHÌN phần sổ nói về
 * mình — đúng những gì in trên biên nhận — và chỉ khi kết nối `active`.
 *
 *   pending  — có lời mời: bên owner mời (`/links/invite`, kèm MÃ KẾT NỐI) hoặc bên linked dò theo
 *              số điện thoại ĐÃ XÁC THỰC OTP (`/links/discover`). Chưa cho xem gì.
 *   active   — CHÍNH bên linked nhập đúng mã kết nối (`/links/claim`), hoặc đồng ý với số điện
 *              thoại đã xác thực OTP trùng số được mời (`/links/:id/accept`).
 *   revoked  — một trong hai bên huỷ. Mất quyền xem ngay; không mở lại được (mời lại = kết nối mới).
 *
 * Hai đường chứng minh "đúng người" (quyết định 01/10/2026):
 *   - MÃ KẾT NỐI — đường chính từ pilot: bên owner đưa mã tận tay (lúc cân, qua Zalo; sau này
 *     bằng QR chứa đúng mã này). Không cần SMS.
 *   - OTP — giữ nguyên nhưng TẠM ẨN (Phone provider của Supabase tắt), mở lại khi > 100 tổ chức
 *     trả phí. Lúc đó nông dân tự dò được các sổ có số của mình.
 *
 * Cùng cơ chế cho nông dân ↔ vựa và vựa ↔ doanh nghiệp.
 */

import { z } from 'zod';
import { OrgType } from './organization.js';
import { FormulaType, TransactionKind } from './sync-records.js';

const Time = z.iso.datetime({ offset: true });
const Money = z.number().int();

// ─── POST /v1/links/discover ─────────────────────────────────────────────────

export const LinksDiscoverResult = z.object({
  /** Số lời mời mới tạo hoặc vừa nhận về tổ chức này ở lần gọi này. */
  created: z.number().int().nonnegative(),
  /** Tổng lời mời đang chờ tổ chức này đồng ý. */
  pending: z.number().int().nonnegative(),
});
export type LinksDiscoverResult = z.infer<typeof LinksDiscoverResult>;

// ─── Kết nối ─────────────────────────────────────────────────────────────────

export const PartnerKind = z.enum(['supplier', 'buyer']);
export type PartnerKind = z.infer<typeof PartnerKind>;

export const LinkStatus = z.enum(['pending', 'active', 'revoked']);
export type LinkStatus = z.infer<typeof LinkStatus>;

/**
 * Nhìn từ tổ chức đang làm việc:
 *   owner  — dòng danh bạ nằm trong SỔ CỦA MÌNH; mình cho bên kia xem phần sổ về họ
 *   linked — mình là người được nhắc tới trong sổ bên kia; mình được xem
 */
export const LinkSide = z.enum(['owner', 'linked']);
export type LinkSide = z.infer<typeof LinkSide>;

export const OrgRef = z.object({ id: z.uuid(), name: z.string(), type: OrgType });
export type OrgRef = z.infer<typeof OrgRef>;

// ─── Mã kết nối ──────────────────────────────────────────────────────────────

/** Bỏ 0/O, 1/I/L — đọc qua điện thoại hay chép tay không nhầm. */
export const LINK_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const LINK_CODE_LENGTH = 8;
/** Mã sống bao lâu kể từ lúc cấp. Hết hạn thì bên owner mời lại để lấy mã mới. */
export const LINK_CODE_TTL_DAYS = 7;

const LINK_CODE_PATTERN = new RegExp(`^[${LINK_CODE_ALPHABET}]{${LINK_CODE_LENGTH}}$`);

/**
 * Mã như người dùng gõ: chữ thường, khoảng trắng, gạch nối đều được (`k7m2-qx9p`) — chuẩn hoá
 * về `K7M2QX9P`. App hiện mã theo nhóm 4 ký tự cho dễ đọc; QR chứa đúng mã này.
 */
export const LinkCode = z
  .string()
  .max(32)
  .transform((raw) => raw.toUpperCase().replace(/[\s-]/g, ''))
  .pipe(z.string().regex(LINK_CODE_PATTERN, `Mã kết nối gồm ${LINK_CODE_LENGTH} chữ và số`));

/** Mã đang còn hạn của một lời mời — chỉ bên owner thấy, và chỉ khi kết nối còn `pending`. */
export const LinkInviteCode = z.object({ code: z.string(), expiresAt: Time });
export type LinkInviteCode = z.infer<typeof LinkInviteCode>;

export const LinkSummary = z.object({
  id: z.uuid(),
  side: LinkSide,
  status: LinkStatus,
  partnerKind: PartnerKind,
  /** Dòng danh bạ trong sổ bên owner, với tên như bên owner ghi (tên in trên biên nhận). */
  partner: z.object({ id: z.uuid(), name: z.string() }),
  /** Tổ chức bên kia. Phía owner: null khi lời mời chưa có ai nhận. */
  counterpart: OrgRef.nullable(),
  /** Số điện thoại lời mời nhắm tới, dạng +84… — null khi dòng danh bạ không có số hợp lệ. */
  invitedPhone: z.string().nullable(),
  /** Phía owner, kết nối `pending`: mã đang còn hạn để đưa cho bên kia. Còn lại luôn null. */
  inviteCode: LinkInviteCode.nullable(),
  createdAt: Time,
  decidedAt: Time.nullable(),
});
export type LinkSummary = z.infer<typeof LinkSummary>;

export const LinksList = z.object({ links: z.array(LinkSummary) });
export type LinksList = z.infer<typeof LinksList>;

export const LinkIdParams = z.strictObject({ id: z.uuid() });
export type LinkIdParams = z.infer<typeof LinkIdParams>;

/** Vựa / doanh nghiệp mời một dòng danh bạ trong sổ của mình. Không bắt buộc có số điện thoại. */
export const LinkInviteInput = z.strictObject({ partnerKind: PartnerKind, partnerId: z.uuid() });
export type LinkInviteInput = z.infer<typeof LinkInviteInput>;

/** Bên được mời nhập mã kết nối (gõ tay hoặc quét QR). */
export const LinkClaimInput = z.strictObject({ code: LinkCode });
export type LinkClaimInput = z.input<typeof LinkClaimInput>;

// ─── Phần sổ bên kia cho mình xem ────────────────────────────────────────────

/** Một dòng hàng như in trên biên nhận. Không có id mặt hàng, ghi chú hay dữ liệu nội bộ. */
export const LinkedReceiptLine = z.object({
  productName: z.string(),
  unit: z.string(),
  formulaType: FormulaType,
  grossWeight: z.number(),
  tareWeight: z.number().optional(),
  qualityPercent: z.number().optional(),
  lossPercent: z.number().optional(),
  /** Số lượng tính tiền (sau bì / hàm lượng / hao hụt) — tính bằng @mambo/core. */
  netWeight: z.number(),
  pricePerUnit: z.number(),
  total: Money,
});
export type LinkedReceiptLine = z.infer<typeof LinkedReceiptLine>;

/**
 * Một phiếu trong sổ bên kia có nhắc tới mình — CHỈ trường in trên biên nhận: cân, giá, tổng, các
 * lần trả, còn nợ. Không có ghi chú nội bộ, người lập phiếu, chi nhánh, ảnh.
 */
export const LinkedReceipt = z.object({
  id: z.uuid(),
  /** Tổ chức giữ sổ. */
  organizationId: z.uuid(),
  date: Time,
  /**
   * Nhìn từ bên giữ sổ: `purchase` — họ MUA của bạn (họ nợ bạn phần còn lại); `sale` — họ BÁN
   * cho bạn (bạn nợ họ phần còn lại).
   */
  kind: TransactionKind,
  /** Tên của bạn trên biên nhận, như bên giữ sổ ghi. */
  partyName: z.string(),
  lines: z.array(LinkedReceiptLine),
  adjustments: z.array(z.object({ label: z.string(), amount: Money })),
  payments: z.array(z.object({ id: z.uuid(), date: Time, amount: Money })),
  netWeight: z.number(),
  total: Money,
  paid: Money,
  debt: Money,
});
export type LinkedReceipt = z.infer<typeof LinkedReceipt>;

export const LinkedReceiptsQuery = z.strictObject({
  /** Tổ chức giữ sổ (lấy từ `counterpart.id` của một kết nối `active`, phía linked). */
  orgId: z.uuid(),
  /** Nguyên văn `cursor` của trang trước. */
  cursor: z.string().min(1).max(500).optional(),
  /** Mặc định 50. */
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
export type LinkedReceiptsQuery = z.output<typeof LinkedReceiptsQuery>;

/** Mới nhất trước. `cursor` null = hết. */
export const LinkedReceiptsResult = z.object({ receipts: z.array(LinkedReceipt), cursor: z.string().nullable() });
export type LinkedReceiptsResult = z.infer<typeof LinkedReceiptsResult>;

export const LinkedBalanceItem = z.object({
  organization: OrgRef,
  /** Bên giữ sổ còn nợ bạn — phiếu họ mua của bạn chưa trả hết. */
  theyOwe: Money.nonnegative(),
  /** Bạn còn nợ bên giữ sổ — phiếu họ bán cho bạn chưa thu hết. */
  youOwe: Money.nonnegative(),
  receiptCount: z.number().int().nonnegative(),
  lastReceiptAt: Time.nullable(),
});
export type LinkedBalanceItem = z.infer<typeof LinkedBalanceItem>;

/** Mỗi tổ chức đang kết nối `active` (phía linked) một dòng. */
export const LinkedBalance = z.object({ items: z.array(LinkedBalanceItem) });
export type LinkedBalance = z.infer<typeof LinkedBalance>;
