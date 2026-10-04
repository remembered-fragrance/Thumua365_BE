/**
 * Hình dạng từng bản ghi sổ khi đi qua mạng — KH backend §4.
 *
 * Hai chiều, hai loại schema:
 *   *Insert / *Patch — `data` của một op gửi lên `/sync/push`. `strictObject`: trường lạ bị
 *     từ chối. KHÔNG có `organizationId`, `createdBy`, `createdAt`, `deletedAt` — server tự điền.
 *   *Record — bản ghi kéo về từ `/sync/pull`: thêm id, người tạo, mốc thời gian của server,
 *     `deletedAt` (bản ghi đã xoá mềm vẫn được trả về để máy khác xoá theo).
 *
 * Quy ước: camelCase · tiền là số nguyên đồng · thời gian ISO 8601 có múi giờ · Khách lẻ là
 * `counterpartyId: null` (core dùng `'guest'`/`'guest-buyer'` — app đổi ở lớp dữ liệu) ·
 * trong patch, bỏ trường = không đổi, `null` = để trống.
 *
 * Kiểu lệch với `@mambo/core` là lỗi biên dịch — xem `sync-records-core.ts`.
 */

import { z } from 'zod';

const Id = z.uuid();
const Time = z.iso.datetime({ offset: true });
/** Số nguyên đồng, có thể âm (khoản trừ, chiết khấu). */
const Money = z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
const NonNegativeMoney = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const Quantity = z.number().min(0).max(1e9);
const Percent = z.number().min(0).max(100);
const text = (max: number) => z.string().trim().min(1).max(max);
const nullableText = (max: number) => z.string().trim().max(max).nullable();
const hasKeys = (patch: object): boolean => Object.keys(patch).length > 0;
const EMPTY_PATCH = { message: 'Không có trường nào để sửa' };
export const CropType = z.enum(['rubber', 'cashew', 'coffee', 'pepper']);
export const FormulaType = z.enum(['standard', 'netAfterTare', 'rubberLatex', 'lossPercent']);
export const TransactionKind = z.enum(['purchase', 'sale']);
export const DraftStatus = z.enum(['draft', 'waiting']);
export const PricingRuleKind = z.enum(['logistics', 'volumeDiscount', 'manual']);

// ─── Thành phần của phiếu (JSONB, giữ nguyên hình dạng của @mambo/core) ─────

const lineShape = {
  id: z.string().min(1).max(64),
  crop: CropType.optional(),
  /** Không phải khoá: có thể là id mặt hàng mặc định kiểu cũ (`prod-rubber`). Chỉ để hiển thị, lọc. */
  productId: z.string().min(1).max(64).optional(),
  productName: z.string().max(200),
  unit: z.string().min(1).max(20),
  formulaType: FormulaType,
  grossWeight: Quantity,
  tareWeight: Quantity.optional(),
  qualityPercent: Percent.optional(),
  lossPercent: Percent.optional(),
  pricePerUnit: Quantity,
  /** @deprecated Dùng `pricePerUnit`. */
  pricePerKg: Quantity.optional(),
  rawTotal: z.number().optional(),
  roundedTotal: NonNegativeMoney.optional(),
  qualityGrade: z.string().max(60).optional(),
};

/** Dòng hàng của phiếu nháp — chưa chốt, có thể chưa có tổng. */
export const TransactionLine = z.strictObject(lineShape);

/**
 * Dòng của phiếu ĐÃ CHỐT: bắt buộc mang tổng đã đóng băng (`freezeLineTotals`). Server tính lại
 * bằng đúng hàm đó; `roundedTotal` lệch → op bị từ chối `VALIDATION_FAILED`.
 */
export const FrozenTransactionLine = z.strictObject({ ...lineShape, rawTotal: z.number(), roundedTotal: NonNegativeMoney });

const adjustmentShape = {
  id: z.string().min(1).max(64),
  kind: PricingRuleKind,
  label: z.string().max(120),
  amount: Money,
  ruleId: z.string().min(1).max(64).optional(),
};
export const PriceAdjustment = z.strictObject(adjustmentShape);

export const CreditTerm = z.strictObject({ dueDate: Time, amount: NonNegativeMoney });

/** Bản ghi kéo về lấy thêm những gì server đặt. */
const meta = { id: Id, createdBy: Id, createdAt: Time, updatedAt: Time, deletedAt: Time.nullable() };
const LineRecord = z.object(lineShape);
// ─── Người bán (supplier) / người mua (buyer) ───────────────────────────────

const partyFields = {
  name: text(200),
  /** Như vựa gõ; so khớp kết nối qua số đã chuẩn hoá (BE4). */
  phone: nullableText(30),
  location: nullableText(300),
  note: nullableText(2000),
};
export const PartyInsert = z.strictObject(partyFields).partial({ phone: true, location: true, note: true });
export const PartyPatch = z.strictObject(partyFields).partial().refine(hasKeys, EMPTY_PATCH);
export const PartyRecord = z.object({
  ...meta,
  name: z.string(),
  phone: z.string().nullable(),
  location: z.string().nullable(),
  note: z.string().nullable(),
});
export type PartyRecord = z.infer<typeof PartyRecord>;

// ─── Mặt hàng ────────────────────────────────────────────────────────────────

const productFields = {
  name: text(200),
  unit: text(20),
  formulaType: FormulaType,
  isSuggested: z.boolean(),
  isActive: z.boolean(),
  crop: CropType.nullable(),
  lastPricePerUnit: Quantity.nullable(),
  group: nullableText(100),
  qualityGrades: z.array(text(60)).max(20),
  trackInventory: z.boolean().nullable(),
};
/** Bỏ qua thì server điền: `unit` 'kg', `isSuggested` false, `isActive` true, `qualityGrades` []. */
export const ProductInsert = z.strictObject(productFields).partial({
  unit: true,
  isSuggested: true,
  isActive: true,
  crop: true,
  lastPricePerUnit: true,
  group: true,
  qualityGrades: true,
  trackInventory: true,
});
export const ProductPatch = z.strictObject(productFields).partial().refine(hasKeys, EMPTY_PATCH);
export const ProductRecord = z.object({
  ...meta,
  name: z.string(),
  unit: z.string(),
  formulaType: FormulaType,
  isSuggested: z.boolean(),
  isActive: z.boolean(),
  crop: CropType.nullable(),
  lastPricePerUnit: z.number().nullable(),
  group: z.string().nullable(),
  qualityGrades: z.array(z.string()),
  trackInventory: z.boolean().nullable(),
});
export type ProductRecord = z.infer<typeof ProductRecord>;

// ─── Quy tắc điều chỉnh giá ──────────────────────────────────────────────────

const pricingRuleFields = {
  name: text(120),
  kind: PricingRuleKind,
  productId: Id.nullable(),
  fixedAmount: Money.nullable(),
  percentOfTotal: z.number().min(-100).max(100).nullable(),
  minWeightKg: Quantity.nullable(),
  appliesOnPickup: z.boolean().nullable(),
  active: z.boolean(),
};
export const PricingRuleInsert = z.strictObject(pricingRuleFields).partial({
  productId: true,
  fixedAmount: true,
  percentOfTotal: true,
  minWeightKg: true,
  appliesOnPickup: true,
});
export const PricingRulePatch = z.strictObject(pricingRuleFields).partial().refine(hasKeys, EMPTY_PATCH);
export const PricingRuleRecord = z.object({
  ...meta,
  name: z.string(),
  kind: PricingRuleKind,
  productId: z.string().nullable(),
  fixedAmount: z.number().int().nullable(),
  percentOfTotal: z.number().nullable(),
  minWeightKg: z.number().nullable(),
  appliesOnPickup: z.boolean().nullable(),
  active: z.boolean(),
});
export type PricingRuleRecord = z.infer<typeof PricingRuleRecord>;

// ─── Ghi chú ─────────────────────────────────────────────────────────────────

const noteFields = { body: text(5000), pinned: z.boolean(), done: z.boolean() };
export const NoteInsert = z.strictObject(noteFields).partial({ pinned: true, done: true });
export const NotePatch = z.strictObject(noteFields).partial().refine(hasKeys, EMPTY_PATCH);
export const NoteRecord = z.object({ ...meta, body: z.string(), pinned: z.boolean(), done: z.boolean() });
export type NoteRecord = z.infer<typeof NoteRecord>;

// ─── Phiếu nháp ──────────────────────────────────────────────────────────────

const draftFields = {
  status: DraftStatus,
  kind: TransactionKind.nullable(),
  counterpartyId: Id.nullable(),
  supplierId: z.string().max(64).nullable(),
  supplierName: z.string().trim().max(200),
  lines: z.array(TransactionLine).max(100),
  /** Số định trả khi chốt — chưa phải lần trả nào. Lần trả thật là `payment`. */
  amountPaid: NonNegativeMoney,
  note: nullableText(2000),
  attachmentIds: z.array(Id).max(10),
  /** (BE5) Nháp lập theo đơn — chốt thành phiếu thì phiếu mang `orderId` này. */
  orderId: Id.nullable(),
};
/** Doanh nghiệp: `branchId` như phiếu (xem TransactionInsert). Chi nhánh không đổi được sau khi tạo. */
export const DraftInsert = z
  .strictObject({ ...draftFields, branchId: Id.nullable() })
  .partial({ kind: true, counterpartyId: true, supplierId: true, note: true, attachmentIds: true, branchId: true, orderId: true });
export const DraftPatch = z.strictObject(draftFields).partial().refine(hasKeys, EMPTY_PATCH);
export const DraftRecord = z.object({
  ...meta,
  status: DraftStatus,
  kind: TransactionKind.nullable(),
  counterpartyId: z.string().nullable(),
  supplierId: z.string().nullable(),
  supplierName: z.string(),
  lines: z.array(LineRecord),
  amountPaid: z.number().int(),
  note: z.string().nullable(),
  attachmentIds: z.array(z.string()),
  branchId: z.string().nullable(),
  orderId: z.string().nullable(),
});
export type DraftRecord = z.infer<typeof DraftRecord>;

// ─── Phiếu đã chốt ───────────────────────────────────────────────────────────

/** KHÔNG có `amountPaid` hay `payments`: số đã trả luôn là tổng các `payment` (quy tắc số 1). */
export const TransactionInsert = z.strictObject({
  date: Time,
  kind: TransactionKind,
  counterpartyId: Id.nullable(),
  /** @deprecated core còn giữ `supplierId`; gửi thì lưu nguyên để kéo về khớp bản cũ. */
  supplierId: z.string().max(64).nullable().optional(),
  supplierName: z.string().trim().max(200),
  lines: z.array(FrozenTransactionLine).min(1).max(100),
  creditTerms: z.array(CreditTerm).max(24).nullable().optional(),
  adjustments: z.array(PriceAdjustment).max(20).nullable().optional(),
  attachmentIds: z.array(Id).max(10).optional(),
  note: nullableText(2000).optional(),
  /**
   * Doanh nghiệp: chi nhánh của phiếu. Người gắn với một chi nhánh thì server tự điền chi nhánh
   * đó — gửi chi nhánh khác → FORBIDDEN. Chủ (không gắn chi nhánh) để trống = cả tổ chức.
   */
  branchId: Id.nullable().optional(),
  /** (BE5) Phiếu lập theo đơn → đơn tự sang `fulfilled`. Đơn đã huỷ → phiếu vẫn ghi, gỡ `orderId`. */
  orderId: Id.nullable().optional(),
});

/** Phiếu đã chốt chỉ sửa được chứng từ đính kèm và ghi chú. Sai cân, sai giá = xoá phiếu, lập phiếu mới. */
export const TransactionPatch = z
  .strictObject({ attachmentIds: z.array(Id).max(10), note: nullableText(2000) })
  .partial()
  .refine(hasKeys, EMPTY_PATCH);

export const TransactionRecord = z.object({
  ...meta,
  date: Time,
  kind: TransactionKind,
  counterpartyId: z.string().nullable(),
  supplierId: z.string().nullable(),
  supplierName: z.string(),
  lines: z.array(LineRecord),
  creditTerms: z.array(z.object({ dueDate: z.string(), amount: z.number().int() })).nullable(),
  adjustments: z.array(z.object(adjustmentShape)).nullable(),
  attachmentIds: z.array(z.string()),
  note: z.string().nullable(),
  branchId: z.string().nullable(),
  orderId: z.string().nullable(),
});
export type TransactionRecord = z.infer<typeof TransactionRecord>;

// ─── Lần trả tiền — chỉ ghi thêm ─────────────────────────────────────────────

/** Không có `update`: không bao giờ sửa số tiền. Huỷ = `softDelete`. */
export const PaymentInsert = z.strictObject({
  transactionId: Id,
  date: Time,
  amount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  note: nullableText(500).optional(),
});
export const PaymentRecord = z.object({
  ...meta,
  transactionId: z.string(),
  date: Time,
  amount: z.number().int(),
  note: z.string().nullable(),
});
export type PaymentRecord = z.infer<typeof PaymentRecord>;

