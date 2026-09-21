/**
 * Thêm/sửa đối tác. Hàm thuần: nhận sổ, trả sổ mới, không chạm nơi lưu trữ.
 * Tầng `data/` gọi các hàm này rồi mới lo việc ghi xuống máy và đẩy lên mạng.
 */

import { newId } from './id';
import { GUEST_BUYER_ID, GUEST_SUPPLIER_ID } from './normalizeTransaction';
import type { AppData, Buyer, Supplier } from './types';

const WALK_IN = 'Khách lẻ';

const clean = (value?: string): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const sameName = (a: string, b: string): boolean =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

export const addSupplier = (
  data: AppData,
  input: Omit<Supplier, 'id'>,
): { data: AppData; supplier: Supplier } => {
  const existing = data.suppliers.find((s) => sameName(s.name, input.name));
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
): { data: AppData; buyer: Buyer } => {
  const existing = data.buyers.find((b) => sameName(b.name, input.name));
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
 * "Khách lẻ" thì dùng mã khách lẻ, không tạo hồ sơ rác.
 */
export const resolveSupplier = (
  data: AppData,
  supplierId: string | undefined,
  supplierName: string,
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

  const { data: next, supplier } = addSupplier(data, { name });
  return { data: next, id: supplier.id, name: supplier.name };
};

/** Người mua của phiếu bán. Cùng quy tắc với resolveSupplier. */
export const resolveBuyer = (
  data: AppData,
  buyerId: string | undefined,
  buyerName: string,
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

  const { data: next, buyer } = addBuyer(data, { name });
  return { data: next, id: buyer.id, name: buyer.name };
};
