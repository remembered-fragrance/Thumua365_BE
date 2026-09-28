/**
 * Đồng bộ sổ offline qua API — KH backend §4. Chỉ tổ chức có sổ (vựa, doanh nghiệp) gọi được;
 * nông dân không có quyền `book:sync` nên nhận `FORBIDDEN`.
 *
 *   POST /v1/sync/push — đẩy các op trong hàng đợi của máy lên, đúng thứ tự `seq`.
 *   GET  /v1/sync/pull — kéo thay đổi về theo cursor do SERVER cấp (không dùng giờ máy).
 *
 * Mỗi op là MỘT thao tác trên MỘT bản ghi. Server xử lý tuần tự, mỗi op một transaction;
 * gặp op bị từ chối thì dừng — các op sau có thể phụ thuộc nó (lần trả cần phiếu).
 */

import { z } from 'zod';
import { ErrorCode } from './errors.js';
import type { Permission } from './permissions.js';
import {
  DraftInsert,
  DraftPatch,
  DraftRecord,
  NoteInsert,
  NotePatch,
  NoteRecord,
  PartyInsert,
  PartyPatch,
  PartyRecord,
  PaymentInsert,
  PaymentRecord,
  PricingRuleInsert,
  PricingRulePatch,
  PricingRuleRecord,
  ProductInsert,
  ProductPatch,
  ProductRecord,
  TransactionInsert,
  TransactionPatch,
  TransactionRecord,
} from './sync-records.js';

const Id = z.uuid();
const Seq = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

/**
 * Tám loại bản ghi của sổ, theo ĐÚNG thứ tự server trả khi kéo: danh mục trước, phiếu sau,
 * lần trả tiền cuối cùng — mỗi `payment` kéo về đều đã có phiếu cha ở trang này hoặc trước đó.
 */
export const SYNC_ENTITIES = ['supplier', 'buyer', 'product', 'pricingRule', 'note', 'draft', 'transaction', 'payment'] as const;
export const SyncEntity = z.enum(SYNC_ENTITIES);
export type SyncEntity = z.infer<typeof SyncEntity>;

export const SYNC_OP_KINDS = ['insert', 'update', 'softDelete'] as const;
export const SyncOpKind = z.enum(SYNC_OP_KINDS);
export type SyncOpKind = z.infer<typeof SyncOpKind>;

/** Một lô tối đa ngần này op — dưới giới hạn thân 1MB và không giữ request quá lâu. */
export const SYNC_PUSH_MAX_OPS = 200;
export const SYNC_PULL_DEFAULT_LIMIT = 500;
export const SYNC_PULL_MAX_LIMIT = 1000;

/**
 * `data` của từng loại op. `null` = không có thao tác này (lần trả tiền không sửa được).
 * `softDelete` không mang `data`. `update` là vá một phần: chỉ trường gửi lên bị đổi.
 */
export const SYNC_OP_DATA = {
  supplier: { insert: PartyInsert, update: PartyPatch },
  buyer: { insert: PartyInsert, update: PartyPatch },
  product: { insert: ProductInsert, update: ProductPatch },
  pricingRule: { insert: PricingRuleInsert, update: PricingRulePatch },
  note: { insert: NoteInsert, update: NotePatch },
  draft: { insert: DraftInsert, update: DraftPatch },
  transaction: { insert: TransactionInsert, update: TransactionPatch },
  payment: { insert: PaymentInsert, update: null },
} as const satisfies Record<SyncEntity, { insert: z.ZodType; update: z.ZodType | null }>;

// ─── Quyền của từng op ───────────────────────────────────────────────────────

/**
 * Quyền cần cho từng op, NGOÀI `book:sync` của cả route (ma trận KH §1.6).
 *
 * Lập phiếu kéo theo việc phụ: tạo người bán/người mua mới, tạo mặt hàng mới, cập nhật giá gần
 * nhất của mặt hàng. Người cân không có `partner:manage` hay `pricing:manage`, nên những việc
 * phụ đó chỉ cần `receipt:create` — không thì mọi phiếu của người cân đều bị từ chối.
 */
export const SYNC_PERMISSION: Readonly<Record<SyncEntity, Readonly<Record<SyncOpKind, Permission | null>>>> = {
  supplier: { insert: 'receipt:create', update: 'partner:manage', softDelete: 'partner:manage' },
  buyer: { insert: 'receipt:create', update: 'partner:manage', softDelete: 'partner:manage' },
  product: { insert: 'receipt:create', update: 'pricing:manage', softDelete: 'pricing:manage' },
  pricingRule: { insert: 'pricing:manage', update: 'pricing:manage', softDelete: 'pricing:manage' },
  note: { insert: 'book:sync', update: 'book:sync', softDelete: 'book:sync' },
  draft: { insert: 'receipt:create', update: 'receipt:create', softDelete: 'receipt:create' },
  transaction: { insert: 'receipt:create', update: 'receipt:create', softDelete: 'receipt:delete' },
  payment: { insert: 'payment:record', update: null, softDelete: 'payment:void' },
};

/** Sửa mặt hàng mà CHỈ đổi giá gần nhất — việc phụ của lập phiếu, người cân làm được. */
const isPriceOnly = (data: Readonly<Record<string, unknown>> | undefined): boolean =>
  data !== undefined && Object.keys(data).length > 0 && Object.keys(data).every((key) => key === 'lastPricePerUnit');

export const syncOpPermission = (
  op: Readonly<{ entity: SyncEntity; kind: SyncOpKind; data?: Readonly<Record<string, unknown>> }>,
): Permission | null =>
  op.entity === 'product' && op.kind === 'update' && isPriceOnly(op.data) ? 'receipt:create' : SYNC_PERMISSION[op.entity][op.kind];

// ─── Op: hình dạng đầy đủ (cho app và tài liệu) ─────────────────────────────

const opBase = { opId: Id, seq: Seq, recordId: Id };
const insertOp = <E extends SyncEntity, D extends z.ZodType>(entity: E, data: D) =>
  z.strictObject({ ...opBase, entity: z.literal(entity), kind: z.literal('insert'), data });
const updateOp = <E extends SyncEntity, D extends z.ZodType>(entity: E, data: D) =>
  z.strictObject({ ...opBase, entity: z.literal(entity), kind: z.literal('update'), data });
const deleteOp = <E extends SyncEntity>(entity: E) =>
  z.strictObject({ ...opBase, entity: z.literal(entity), kind: z.literal('softDelete') });

/** Một thao tác trong hàng đợi của máy — đúng hình dạng app gửi lên. */
export const SyncOp = z.union([
  insertOp('supplier', PartyInsert),
  updateOp('supplier', PartyPatch),
  deleteOp('supplier'),
  insertOp('buyer', PartyInsert),
  updateOp('buyer', PartyPatch),
  deleteOp('buyer'),
  insertOp('product', ProductInsert),
  updateOp('product', ProductPatch),
  deleteOp('product'),
  insertOp('pricingRule', PricingRuleInsert),
  updateOp('pricingRule', PricingRulePatch),
  deleteOp('pricingRule'),
  insertOp('note', NoteInsert),
  updateOp('note', NotePatch),
  deleteOp('note'),
  insertOp('draft', DraftInsert),
  updateOp('draft', DraftPatch),
  deleteOp('draft'),
  insertOp('transaction', TransactionInsert),
  updateOp('transaction', TransactionPatch),
  deleteOp('transaction'),
  insertOp('payment', PaymentInsert),
  deleteOp('payment'),
]);
export type SyncOp = z.input<typeof SyncOp>;

// ─── POST /v1/sync/push ──────────────────────────────────────────────────────

/**
 * Vỏ của một op — cổng chỉ kiểm chừng này. `data` được kiểm RIÊNG từng op (`parseSyncOp`) để
 * một op sai chỉ làm op đó bị từ chối, kèm đúng trường sai — không làm hỏng cả lô.
 */
export const SyncOpEnvelope = z.strictObject({
  opId: Id,
  seq: Seq,
  entity: z.string().max(40),
  kind: z.string().max(20),
  recordId: z.string().max(100),
  data: z.unknown().optional(),
});
export type SyncOpEnvelope = z.infer<typeof SyncOpEnvelope>;

const pushBody = <O extends z.ZodType<{ opId: string; seq: number }>>(opSchema: O) =>
  z
    .strictObject({
      /** Id của máy (sinh một lần, lưu cục bộ) — để lần theo khi hỗ trợ. */
      deviceId: Id,
      ops: z.array(opSchema).min(1).max(SYNC_PUSH_MAX_OPS),
    })
    .superRefine((body, ctx) => {
      const seen = new Set<string>();
      body.ops.forEach((op, i) => {
        if (seen.has(op.opId)) ctx.addIssue({ code: 'custom', path: ['ops', i, 'opId'], message: 'opId trùng trong lô' });
        seen.add(op.opId);
        const prev = body.ops[i - 1];
        if (prev && op.seq <= prev.seq) {
          ctx.addIssue({ code: 'custom', path: ['ops', i, 'seq'], message: 'Op phải theo seq tăng dần' });
        }
      });
    });

/** Thân `/sync/push` server kiểm ở cổng. */
export const SyncPushInput = pushBody(SyncOpEnvelope);
/** Thân `/sync/push` đầy đủ — app gửi đúng hình dạng này. */
export const SyncPushRequest = pushBody(SyncOp);
export type SyncPushRequest = z.input<typeof SyncPushRequest>;

export const SyncOpStatus = z.enum(['applied', 'duplicate', 'rejected']);
export type SyncOpStatus = z.infer<typeof SyncOpStatus>;

/**
 * Cảnh báo kèm op ĐÃ nhận (không phải lỗi — app xoá op khỏi hàng đợi như thường):
 *   RECORD_DELETED — bản ghi (hoặc phiếu cha của lần trả) đã bị xoá. Xoá thắng: sửa đến sau
 *                    không làm bản ghi sống lại; lần trả vẫn được lưu nhưng không hiện.
 *   ORDER_NOT_OPEN — (BE5) đơn đã huỷ: phiếu vẫn ghi nhưng bị gỡ khỏi đơn.
 */
export const SyncWarning = z.enum(['RECORD_DELETED', 'ORDER_NOT_OPEN']);
export type SyncWarning = z.infer<typeof SyncWarning>;

export const SyncOpResult = z.object({
  opId: Id,
  status: SyncOpStatus,
  /** Chỉ có khi `rejected`. Thử lại hay không: `isRetryable(error.code)`. */
  error: z
    .object({ code: ErrorCode, message: z.string(), details: z.record(z.string(), z.unknown()).optional() })
    .optional(),
  warning: SyncWarning.optional(),
});
export type SyncOpResult = z.infer<typeof SyncOpResult>;

/**
 * Kết quả theo đúng thứ tự op gửi lên, DỪNG ở op `rejected` đầu tiên: các op sau không có trong
 * `results` và chưa được xử lý — giữ nguyên trong hàng đợi.
 */
export const SyncPushResult = z.object({ results: z.array(SyncOpResult) });
export type SyncPushResult = z.infer<typeof SyncPushResult>;

// ─── GET /v1/sync/pull ───────────────────────────────────────────────────────

export const SyncPullQuery = z.strictObject({
  /** Nguyên văn `cursor` của lần kéo trước. Lần đầu (hoặc sau `resetRequired`) bỏ trống. */
  cursor: z.string().min(1).max(1000).optional(),
  /** Số bản ghi tối đa của trang này, cộng mọi loại. Mặc định 500. */
  limit: z.coerce.number().int().min(1).max(SYNC_PULL_MAX_LIMIT).optional(),
});
export type SyncPullQuery = z.output<typeof SyncPullQuery>;

export const SyncChanges = z.object({
  suppliers: z.array(PartyRecord),
  buyers: z.array(PartyRecord),
  products: z.array(ProductRecord),
  pricingRules: z.array(PricingRuleRecord),
  notes: z.array(NoteRecord),
  drafts: z.array(DraftRecord),
  transactions: z.array(TransactionRecord),
  payments: z.array(PaymentRecord),
});
export type SyncChanges = z.infer<typeof SyncChanges>;

/** Khoá trong `changes` của từng loại bản ghi. */
export const SYNC_CHANGE_KEY = {
  supplier: 'suppliers',
  buyer: 'buyers',
  product: 'products',
  pricingRule: 'pricingRules',
  note: 'notes',
  draft: 'drafts',
  transaction: 'transactions',
  payment: 'payments',
} as const satisfies Record<SyncEntity, keyof SyncChanges>;

export const SyncPullResult = z.object({
  /** Lưu theo tổ chức, gửi lại nguyên văn ở lần kéo sau. Không tự đọc hay tự dựng. */
  cursor: z.string(),
  /** `true` → gọi tiếp ngay với `cursor` mới. */
  hasMore: z.boolean(),
  /**
   * `true` → phạm vi dữ liệu của người này đã đổi (ví dụ đổi chi nhánh): XẢ HẾT hàng đợi trước,
   * rồi xoá sổ cục bộ của tổ chức này và kéo lại từ `cursor` trả kèm. `changes` rỗng.
   */
  resetRequired: z.boolean(),
  /** Gồm cả bản ghi đã xoá mềm (`deletedAt` khác null). Hợp nhất theo `id`. */
  changes: SyncChanges,
});
export type SyncPullResult = z.infer<typeof SyncPullResult>;
