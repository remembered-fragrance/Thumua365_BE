/**
 * Chuẩn hoá toàn bộ AppData đọc từ nơi lưu trữ.
 *
 * L1 — KHÔNG gieo dữ liệu mẫu ở đây. Dữ liệu rỗng trả về `emptyData()`.
 * Dữ liệu trình diễn là một hành động người dùng chủ động chọn, không phải
 * thứ tự động xuất hiện trong sổ của họ.
 */

import { newId } from './id';
import { normalizeLine, normalizeTransaction } from './normalizeTransaction';
import type {
  AppData,
  AppSettings,
  Buyer,
  DraftReceipt,
  Note,
  Product,
  Supplier,
} from './types';
import { DEFAULT_PRODUCTS, productNameFromCrop } from './catalog';
import { cropFrom, formulaFrom } from './normalizeTransaction';

export const defaultSettings = (): AppSettings => ({
  defaultWeightUnit: 'kg',
  displayMode: 'normal',
});

export const emptyData = (): AppData => ({
  suppliers: [],
  buyers: [],
  products: [...DEFAULT_PRODUCTS],
  transactions: [],
  drafts: [],
  notes: [],
  settings: defaultSettings(),
  pricingRules: [],
});

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
    };
  });

  const byName = new Map(incoming.map((p) => [p.name.trim().toLowerCase(), p]));
  const merged = DEFAULT_PRODUCTS.map((p) => ({ ...p, ...byName.get(p.name.toLowerCase()) }));
  const custom = incoming.filter(
    (p) => !DEFAULT_PRODUCTS.some((d) => d.name.toLowerCase() === p.name.toLowerCase()),
  );
  return [...merged, ...custom];
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
    note: text(raw.note),
    attachmentIds: Array.isArray(raw.attachmentIds)
      ? (raw.attachmentIds as unknown[]).map(String)
      : undefined,
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
