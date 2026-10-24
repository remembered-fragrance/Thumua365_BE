/**
 * Chuẩn hoá toàn bộ AppData đọc từ nơi lưu trữ.
 *
 * L1 — KHÔNG gieo dữ liệu mẫu ở đây. Dữ liệu rỗng trả về `emptyData()`.
 * Dữ liệu trình diễn là một hành động người dùng chủ động chọn, không phải
 * thứ tự động xuất hiện trong sổ của họ.
 */

import { newId } from './id.js';
import { normalizeAdjustment, normalizeLine, normalizeTransaction } from './normalizeTransaction.js';
import type {
  AppData,
  AppSettings,
  Buyer,
  DraftReceipt,
  Note,
  Product,
  Supplier,
} from './types.js';
import { DEFAULT_PRODUCTS, isLegacyProductId, productNameFromCrop } from './catalog.js';
import { cropFrom, formulaFrom, rubberKindFrom } from './normalizeTransaction.js';

export const defaultSettings = (): AppSettings => ({
  defaultWeightUnit: 'kg',
  displayMode: 'normal',
});

/**
 * Sổ rỗng, KHÔNG có mặt hàng nào: sổ có máy chủ kéo bộ mặt hàng mặc định (id UUID) từ máy chủ về.
 * Gieo `DEFAULT_PRODUCTS` (id `prod-…`) ở đây thì phiếu lập trước lần kéo đầu tiên sinh thao tác
 * mà máy chủ luôn từ chối, kẹt cả hàng đợi.
 */
export const emptyData = (): AppData => ({
  suppliers: [],
  buyers: [],
  products: [],
  transactions: [],
  drafts: [],
  notes: [],
  settings: defaultSettings(),
  pricingRules: [],
});

/** Sổ rỗng cho sổ CHỈ NẰM TRÊN MÁY (tài khoản máy): có sẵn bốn mặt hàng gợi ý. */
export const starterData = (): AppData => ({ ...emptyData(), products: [...DEFAULT_PRODUCTS] });

/**
 * Bỏ mặt hàng mặc định kiểu cũ (`prod-…`) khỏi sổ có máy chủ. Sổ lưu trên máy từ bản cũ còn giữ
 * chúng; máy chủ không bao giờ nhận id này, bộ mặt hàng thật đã kéo về (hoặc sẽ kéo về) với id UUID.
 */
export const withoutLegacyProducts = (data: AppData): AppData =>
  data.products.some((p) => isLegacyProductId(p.id))
    ? { ...data, products: data.products.filter((p) => !isLegacyProductId(p.id)) }
    : data;

const asRecords = (raw: unknown): Record<string, unknown>[] =>
  Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];

const text = (value: unknown): string | undefined => (value ? String(value) : undefined);

// ─── Product ─────────────────────────────────────────────────────────────────

export const normalizeProducts = (raw: unknown): Product[] => {
  const incoming = asRecords(raw).map((p): Product => {
    const crop = cropFrom(p.crop);
    return {
      id: String(p.id || newId()),
      name: String(p.name || productNameFromCrop(crop)).trim(),
      unit: String(p.unit || 'kg'),
      formulaType: formulaFrom(p.formulaType),
      isSuggested: Boolean(p.isSuggested),
      isActive: p.isActive !== false,
      crop,
      lastPricePerUnit: Number(p.lastPricePerUnit) || undefined,
      group: text(p.group),
      qualityGrades: Array.isArray(p.qualityGrades)
        ? (p.qualityGrades as unknown[]).map(String)
        : undefined,
      trackInventory: p.trackInventory === true ? true : undefined,
      rubberKind: rubberKindFrom(p.rubberKind),
    };
  });

  // Không tự thêm mặt hàng mặc định (xem `emptyData`). Bản `prod-…` còn trong sổ cũ mà đã có mặt
  // hàng cùng tên với id thật (máy chủ tạo) thì bỏ bản cũ — không thì sổ hiện hai "Cao su".
  const real = new Set(incoming.filter((p) => !isLegacyProductId(p.id)).map((p) => p.name.toLowerCase()));
  return incoming.filter((p) => !isLegacyProductId(p.id) || !real.has(p.name.toLowerCase()));
};

// ─── Đối tác ─────────────────────────────────────────────────────────────────

const normalizeParty = <T extends Supplier | Buyer>(raw: Record<string, unknown>): T =>
  ({
    id: String(raw.id || newId()),
    name: String(raw.name || '').trim(),
    phone: text(raw.phone),
    location: text(raw.location),
    note: text(raw.note),
  }) as T;

// ─── Nháp / ghi chú ──────────────────────────────────────────────────────────

const normalizeDraft = (raw: Record<string, unknown>): DraftReceipt => {
  const now = new Date().toISOString();
  return {
    id: String(raw.id || newId()),
    status: raw.status === 'waiting' ? 'waiting' : 'draft',
    kind: raw.kind === 'sale' ? 'sale' : raw.kind === 'purchase' ? 'purchase' : undefined,
    counterpartyId: text(raw.counterpartyId),
    supplierId: text(raw.supplierId),
    supplierName: String(raw.supplierName || ''),
    lines: asRecords(raw.lines).map((l) => normalizeLine(l, false)),
    amountPaid: Number(raw.amountPaid) || 0,
    adjustments: Array.isArray(raw.adjustments)
      ? asRecords(raw.adjustments).map(normalizeAdjustment)
      : undefined,
    note: text(raw.note),
    attachmentIds: Array.isArray(raw.attachmentIds)
      ? (raw.attachmentIds as unknown[]).map(String)
      : undefined,
    orderId: text(raw.orderId),
    createdAt: String(raw.createdAt || now),
    updatedAt: String(raw.updatedAt || now),
  };
};

const normalizeNote = (raw: Record<string, unknown>): Note => {
  const now = new Date().toISOString();
  return {
    id: String(raw.id || newId()),
    body: String(raw.body || ''),
    pinned: Boolean(raw.pinned),
    done: Boolean(raw.done),
    createdAt: String(raw.createdAt || now),
    updatedAt: String(raw.updatedAt || now),
  };
};

// ─── AppData ─────────────────────────────────────────────────────────────────

export const normalize = (raw: unknown): AppData => {
  if (!raw || typeof raw !== 'object') return emptyData();
  const d = raw as Record<string, unknown>;
  return {
    suppliers: asRecords(d.suppliers).map((s) => normalizeParty<Supplier>(s)),
    buyers: asRecords(d.buyers).map((b) => normalizeParty<Buyer>(b)),
    products: normalizeProducts(d.products),
    transactions: asRecords(d.transactions).map(normalizeTransaction),
    drafts: asRecords(d.drafts).map(normalizeDraft),
    notes: asRecords(d.notes).map(normalizeNote),
    settings: { ...defaultSettings(), ...(d.settings as AppSettings | undefined) },
    pricingRules: Array.isArray(d.pricingRules) ? d.pricingRules : [],
  };
};
