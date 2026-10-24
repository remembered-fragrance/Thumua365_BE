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

/**
 * Giới hạn của một phiếu / nháp. App dùng chính các hằng này để chặn ngay ở ô nhập: để lọt lên máy
 * chủ thì op bị từ chối `VALIDATION_FAILED` và đứng chặn cả hàng đợi.
 */
export const RECEIPT_LIMITS = {
  lines: 100,
  adjustments: 20,
  attachments: 10,
  /** % chất lượng (mủ), % hao hụt: 0–100. */
  percent: 100,
  /** Số cân, đơn giá: 0 – 1 tỷ. */
  quantity: 1e9,
  /** V24 — kg cà phê tươi ra 1 kg nhân: lớn hơn 1, tối đa 20. */
  greenRatio: 20,
  adjustmentLabel: 120,
  partyName: 200,
  note: 2000,
} as const;

/** Hồ sơ người bán / người mua. Cùng lý do với `RECEIPT_LIMITS`: app chặn ở ô nhập bằng chính các hằng này. */
export const PARTY_LIMITS = { name: 200, phone: 30, location: 300, note: 2000 } as const;
/** Mặt hàng. */
export const PRODUCT_LIMITS = { name: 200, unit: 20, group: 100, qualityGrade: 60, qualityGrades: 20 } as const;
/** Ghi chú nhanh. */
export const NOTE_LIMITS = { body: 5000 } as const;

const Id = z.uuid();
const Time = z.iso.datetime({ offset: true });
/** Số nguyên đồng, có thể âm (khoản trừ, chiết khấu). */
const Money = z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
const NonNegativeMoney = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const Quantity = z.number().min(0).max(RECEIPT_LIMITS.quantity);
const Percent = z.number().min(0).max(RECEIPT_LIMITS.percent);
const GreenRatio = z.number().gt(1).max(RECEIPT_LIMITS.greenRatio);
const text = (max: number) => z.string().trim().min(1).max(max);
const nullableText = (max: number) => z.string().trim().max(max).nullable();
const hasKeys = (patch: object): boolean => Object.keys(patch).length > 0;
const EMPTY_PATCH = { message: 'Không có trường nào để sửa' };
export const CropType = z.enum(['rubber', 'cashew', 'coffee', 'pepper']);
export const FormulaType = z.enum(['standard', 'netAfterTare', 'rubberLatex', 'lossPercent']);
export const TransactionKind = z.enum(['purchase', 'sale']);
export const DraftStatus = z.enum(['draft', 'waiting']);
export const PricingRuleKind = z.enum(['logistics', 'volumeDiscount', 'manual']);
/** V20 — mủ nước (độ TSC) hay mủ tạp (DRC). Trường riêng, không thêm `FormulaType`: xem `RubberKind` ở core. */
export const RubberKind = z.enum(['latex', 'cuplump']);
/** V19 — chỉ tiêu trên dòng phiếu mà quy tắc giá theo chất lượng đọc. */
export const QualityMetric = z.enum(['bulkDensity', 'moisturePercent', 'impurityPercent', 'kor', 'qualityPercent']);

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
  rubberKind: RubberKind.optional(),
  /** V19 — chỉ tiêu chất lượng, không tham gia công thức dòng. Dung trọng g/l, KOR lbs/bao 80 kg. */
  bulkDensity: Quantity.optional(),
  moisturePercent: Percent.optional(),
  impurityPercent: Percent.optional(),
  kor: Quantity.optional(),
  /**
   * V24 — dòng cà phê tươi tính ra nhân: bao nhiêu kg tươi ra 1 kg nhân. Chỉ để hiển thị và sửa lại: công thức vẫn là
   * `lossPercent` với `lossPercent = (1 − 1/greenRatio) × 100`, nên app bản cũ đọc ra đúng tiền.
   */
  greenRatio: GreenRatio.optional(),
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
  label: z.string().max(RECEIPT_LIMITS.adjustmentLabel),
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
  name: text(PARTY_LIMITS.name),
  /** Như vựa gõ; so khớp kết nối qua số đã chuẩn hoá (BE4). */
  phone: nullableText(PARTY_LIMITS.phone),
  location: nullableText(PARTY_LIMITS.location),
  note: nullableText(PARTY_LIMITS.note),
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
  name: text(PRODUCT_LIMITS.name),
  unit: text(PRODUCT_LIMITS.unit),
  formulaType: FormulaType,
  isSuggested: z.boolean(),
  isActive: z.boolean(),
  crop: CropType.nullable(),
  lastPricePerUnit: Quantity.nullable(),
  group: nullableText(PRODUCT_LIMITS.group),
  qualityGrades: z.array(text(PRODUCT_LIMITS.qualityGrade)).max(PRODUCT_LIMITS.qualityGrades),
  trackInventory: z.boolean().nullable(),
  rubberKind: RubberKind.nullable(),
  /** V24 — mặt hàng cà phê tươi: kg tươi ra 1 kg nhân. Có thì `formulaType` là `lossPercent`. */
  greenRatio: GreenRatio.nullable(),
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
  rubberKind: true,
  greenRatio: true,
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
  rubberKind: RubberKind.nullable(),
  greenRatio: z.number().nullable(),
});
export type ProductRecord = z.infer<typeof ProductRecord>;

// ─── Quy tắc điều chỉnh giá ──────────────────────────────────────────────────

/** Bảng mốc của một quy tắc chất lượng: tối đa 20 mốc. */
export const PRICING_RULE_LIMITS = { qualitySteps: 20 } as const;
const QualityStep = z.strictObject({
  from: Quantity,
  /** Đồng / đơn vị tính tiền (kg, kg quy khô). Dương = cộng, âm = trừ. */
  amountPerUnit: z.number().int().min(-RECEIPT_LIMITS.quantity).max(RECEIPT_LIMITS.quantity),
});

const pricingRuleFields = {
  name: text(120),
  kind: PricingRuleKind,
  productId: Id.nullable(),
  fixedAmount: Money.nullable(),
  percentOfTotal: z.number().min(-100).max(100).nullable(),
  minWeightKg: Quantity.nullable(),
  appliesOnPickup: z.boolean().nullable(),
  active: z.boolean(),
  /** V19 — có thì là quy tắc theo chỉ tiêu: tiền tính theo `qualitySteps`, bỏ qua `fixedAmount` / `percentOfTotal`. */
  qualityMetric: QualityMetric.nullable(),
  qualitySteps: z.array(QualityStep).max(PRICING_RULE_LIMITS.qualitySteps).nullable(),
};
export const PricingRuleInsert = z.strictObject(pricingRuleFields).partial({
  productId: true,
  fixedAmount: true,
  percentOfTotal: true,
  minWeightKg: true,
  appliesOnPickup: true,
  qualityMetric: true,
  qualitySteps: true,
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
  qualityMetric: QualityMetric.nullable(),
  qualitySteps: z.array(z.object({ from: z.number(), amountPerUnit: z.number() })).nullable(),
});
export type PricingRuleRecord = z.infer<typeof PricingRuleRecord>;

// ─── Ghi chú ─────────────────────────────────────────────────────────────────

const noteFields = { body: text(NOTE_LIMITS.body), pinned: z.boolean(), done: z.boolean() };
export const NoteInsert = z.strictObject(noteFields).partial({ pinned: true, done: true });
export const NotePatch = z.strictObject(noteFields).partial().refine(hasKeys, EMPTY_PATCH);
export const NoteRecord = z.object({ ...meta, body: z.string(), pinned: z.boolean(), done: z.boolean() });
export type NoteRecord = z.infer<typeof NoteRecord>;

// ─── Hợp đồng mùa vụ (V15) ───────────────────────────────────────────────────

/**
 * Hợp đồng giữ giá / số lượng với một người bán (`purchase`) hoặc người mua (`sale`). Không gắn vào phiếu: đã giao
 * bao nhiêu app tự cộng từ phiếu cùng người, cùng mặt hàng, trong khoảng ngày của hợp đồng — phiếu không phải sửa.
 */
const seasonContractFields = {
  kind: TransactionKind,
  /** Id người bán / người mua trong sổ. `null` khi hợp đồng ghi theo tên. */
  counterpartyId: z.string().min(1).max(64).nullable(),
  counterpartyName: text(RECEIPT_LIMITS.partyName),
  /** Như `productId` của dòng phiếu: không phải khoá, có thể là id kiểu cũ. */
  productId: z.string().min(1).max(64).nullable(),
  productName: text(PRODUCT_LIMITS.name),
  unit: text(PRODUCT_LIMITS.unit),
  /** Lượng cam kết, theo lượng tính tiền của dòng phiếu (cao su: kg quy khô). */
  quantity: Quantity.refine((n) => n > 0, 'Nhập số lượng'),
  /** Giá giữ, đồng / đơn vị. `null` = chỉ giữ số lượng, giá theo ngày giao. */
  pricePerUnit: Quantity.nullable(),
  startDate: Time,
  endDate: Time,
  note: nullableText(RECEIPT_LIMITS.note),
  /** Chủ tự đóng (giao đủ, huỷ ngang) — không tính vào danh sách đang chạy. */
  closed: z.boolean(),
};
const endsAfterStart = (c: { startDate?: string; endDate?: string }) =>
  c.startDate === undefined || c.endDate === undefined || c.startDate <= c.endDate;
const END_BEFORE_START = { message: 'Ngày kết thúc phải sau ngày bắt đầu', path: ['endDate'] };
export const SeasonContractInsert = z
  .strictObject(seasonContractFields)
  .partial({ counterpartyId: true, productId: true, unit: true, pricePerUnit: true, note: true, closed: true })
  .refine(endsAfterStart, END_BEFORE_START);
export const SeasonContractPatch = z
  .strictObject(seasonContractFields)
  .partial()
  .refine(hasKeys, EMPTY_PATCH)
  .refine(endsAfterStart, END_BEFORE_START);
export const SeasonContractRecord = z.object({
  ...meta,
  kind: TransactionKind,
  counterpartyId: z.string().nullable(),
  counterpartyName: z.string(),
  productId: z.string().nullable(),
  productName: z.string(),
  unit: z.string(),
  quantity: z.number(),
  pricePerUnit: z.number().nullable(),
  startDate: Time,
  endDate: Time,
  note: z.string().nullable(),
  closed: z.boolean(),
});
export type SeasonContractRecord = z.infer<typeof SeasonContractRecord>;

// ─── Phiếu nháp ──────────────────────────────────────────────────────────────

const draftFields = {
  status: DraftStatus,
  kind: TransactionKind.nullable(),
  counterpartyId: Id.nullable(),
  supplierId: z.string().max(64).nullable(),
  supplierName: z.string().trim().max(RECEIPT_LIMITS.partyName),
  lines: z.array(TransactionLine).max(RECEIPT_LIMITS.lines),
  /** Số định trả khi chốt — chưa phải lần trả nào. Lần trả thật là `payment`. */
  amountPaid: NonNegativeMoney,
  /** Khoản cộng/trừ đang nhập — cùng hình dạng với phiếu đã chốt. */
  adjustments: z.array(PriceAdjustment).max(RECEIPT_LIMITS.adjustments).nullable(),
  note: nullableText(RECEIPT_LIMITS.note),
  attachmentIds: z.array(Id).max(RECEIPT_LIMITS.attachments),
  /** (BE5) Nháp lập theo đơn — chốt thành phiếu thì phiếu mang `orderId` này. */
  orderId: Id.nullable(),
};
/** Doanh nghiệp: `branchId` như phiếu (xem TransactionInsert). Chi nhánh không đổi được sau khi tạo. */
export const DraftInsert = z
  .strictObject({ ...draftFields, branchId: Id.nullable() })
  .partial({
    kind: true,
    counterpartyId: true,
    supplierId: true,
    adjustments: true,
    note: true,
    attachmentIds: true,
    branchId: true,
    orderId: true,
  });
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
  adjustments: z.array(z.object(adjustmentShape)).nullable(),
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
  supplierName: z.string().trim().max(RECEIPT_LIMITS.partyName),
  lines: z.array(FrozenTransactionLine).min(1).max(RECEIPT_LIMITS.lines),
  creditTerms: z.array(CreditTerm).max(24).nullable().optional(),
  adjustments: z.array(PriceAdjustment).max(RECEIPT_LIMITS.adjustments).nullable().optional(),
  attachmentIds: z.array(Id).max(RECEIPT_LIMITS.attachments).optional(),
  note: nullableText(RECEIPT_LIMITS.note).optional(),
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
  .strictObject({ attachmentIds: z.array(Id).max(RECEIPT_LIMITS.attachments), note: nullableText(RECEIPT_LIMITS.note) })
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

/**
 * V13 — trả bằng gì. Chỉ là nhãn vựa tự ghi: app không lưu số tài khoản, không giữ tiền hộ (§4.2).
 * Lần trả cũ (trước 0.23.0) không có trường này = không rõ.
 */
export const PaymentMethod = z.enum(['cash', 'transfer']);

/** Không có `update`: không bao giờ sửa số tiền. Huỷ = `softDelete`. */
export const PaymentInsert = z.strictObject({
  transactionId: Id,
  date: Time,
  amount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  note: nullableText(500).optional(),
  method: PaymentMethod.nullable().optional(),
});
export const PaymentRecord = z.object({
  ...meta,
  transactionId: z.string(),
  date: Time,
  amount: z.number().int(),
  note: z.string().nullable(),
  method: PaymentMethod.nullable(),
});
export type PaymentRecord = z.infer<typeof PaymentRecord>;

