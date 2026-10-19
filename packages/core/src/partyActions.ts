/**
 * Thêm/sửa đối tác. Hàm thuần: nhận sổ, trả sổ mới, không chạm nơi lưu trữ.
 * Tầng `data/` gọi các hàm này rồi mới lo việc ghi xuống máy và đẩy lên mạng.
 */

import { newId } from './id.js';
import { GUEST_BUYER_ID, GUEST_SUPPLIER_ID } from './normalizeTransaction.js';
import type { AppData, Buyer, Supplier } from './types.js';

const WALK_IN = 'Khách lẻ';

const clean = (value?: string): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const sameName = (a: string, b: string): boolean =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

/** Hồ sơ trùng tên (không phân biệt hoa thường) — app hỏi người dùng chọn ai trước khi chốt phiếu. */
export const partiesNamed = <P extends { readonly name: string }>(parties: readonly P[], name: string): P[] =>
  name.trim() ? parties.filter((p) => sameName(p.name, name)) : [];

/**
 * Gõ tên trùng hồ sơ đã có thì dùng lại hồ sơ đó — trừ khi:
 * - `asNew`: người dùng đã chọn "tạo người mới". Hai "Anh Ba" là hai người, gộp lại là gộp công nợ.
 * - hồ sơ nằm trong `keepApart`: đang kết nối với tài khoản nông dân. Gộp theo tên thì nông dân thật thấy
 *   phiếu và số dư của người cùng tên (`linked_receipts` lọc theo `counterparty_id`).
 */
export interface PartyMatch {
  readonly asNew?: boolean;
  readonly keepApart?: ReadonlySet<string>;
}

const reusable = <P extends { readonly id: string; readonly name: string }>(
  parties: readonly P[],
  name: string,
  match: PartyMatch,
): P | undefined =>
  match.asNew ? undefined : partiesNamed(parties, name).find((p) => !match.keepApart?.has(p.id));

export const addSupplier = (
  data: AppData,
  input: Omit<Supplier, 'id'>,
  match: PartyMatch = {},
): { data: AppData; supplier: Supplier } => {
  const existing = reusable(data.suppliers, input.name, match);
  if (existing) return { data, supplier: existing };

  const supplier: Supplier = {
    id: newId(),
    name: input.name.trim(),
    phone: clean(input.phone),
    location: clean(input.location),
    note: clean(input.note),
  };
  return { data: { ...data, suppliers: [...data.suppliers, supplier] }, supplier };
};

export const addBuyer = (
  data: AppData,
  input: Omit<Buyer, 'id'>,
  match: PartyMatch = {},
): { data: AppData; buyer: Buyer } => {
  const existing = reusable(data.buyers, input.name, match);
  if (existing) return { data, buyer: existing };

  const buyer: Buyer = {
    id: newId(),
    name: input.name.trim(),
    phone: clean(input.phone),
    location: clean(input.location),
    note: clean(input.note),
  };
  return { data: { ...data, buyers: [...data.buyers, buyer] }, buyer };
};

/**
 * Sửa hồ sơ người bán. Phiếu cũ KHÔNG đổi theo: `supplierName` trên phiếu là
 * tên tại thời điểm lập, và phiếu đã in ra giấy rồi.
 */
export const updateSupplier = (data: AppData, id: string, patch: Partial<Supplier>): AppData => ({
  ...data,
  suppliers: data.suppliers.map((s) => (s.id === id ? { ...s, ...patch, id: s.id } : s)),
});

/**
 * Xoá hồ sơ người bán. Phiếu của họ ở lại — xoá hồ sơ là dọn danh bạ, không
 * phải xoá lịch sử mua bán.
 */
export const deleteSupplier = (data: AppData, supplierId: string): AppData => ({
  ...data,
  suppliers: data.suppliers.filter((s) => s.id !== supplierId),
});

export const updateBuyer = (data: AppData, id: string, patch: Partial<Buyer>): AppData => ({
  ...data,
  buyers: data.buyers.map((b) => (b.id === id ? { ...b, ...patch, id: b.id } : b)),
});

export const deleteBuyer = (data: AppData, buyerId: string): AppData => ({
  ...data,
  buyers: data.buyers.filter((b) => b.id !== buyerId),
});

// ─── Tìm hoặc tạo đối tác khi lập phiếu ─────────────────────────────────────

export interface ResolvedParty {
  readonly data: AppData;
  readonly id: string;
  readonly name: string;
}

/**
 * Người bán của phiếu mua. Gõ tên mới thì tự tạo hồ sơ; để trống hoặc gõ
 * "Khách lẻ" thì dùng mã khách lẻ, không tạo hồ sơ rác. Tên trùng hồ sơ đã có: xem `PartyMatch`.
 */
export const resolveSupplier = (
  data: AppData,
  supplierId: string | undefined,
  supplierName: string,
  match: PartyMatch = {},
): ResolvedParty => {
  if (supplierId && supplierId !== GUEST_SUPPLIER_ID) {
    return {
      data,
      id: supplierId,
      name: data.suppliers.find((s) => s.id === supplierId)?.name ?? supplierName,
    };
  }

  const name = supplierName.trim();
  if (!name || name === WALK_IN) return { data, id: GUEST_SUPPLIER_ID, name: WALK_IN };

  const { data: next, supplier } = addSupplier(data, { name }, match);
  return { data: next, id: supplier.id, name: supplier.name };
};

/** Người mua của phiếu bán. Cùng quy tắc với resolveSupplier. */
export const resolveBuyer = (
  data: AppData,
  buyerId: string | undefined,
  buyerName: string,
  match: PartyMatch = {},
): ResolvedParty => {
  if (buyerId && buyerId !== GUEST_BUYER_ID) {
    return {
      data,
      id: buyerId,
      name: data.buyers.find((b) => b.id === buyerId)?.name ?? buyerName,
    };
  }

  const name = buyerName.trim();
  if (!name || name === WALK_IN) return { data, id: GUEST_BUYER_ID, name: WALK_IN };

  const { data: next, buyer } = addBuyer(data, { name }, match);
  return { data: next, id: buyer.id, name: buyer.name };
};
