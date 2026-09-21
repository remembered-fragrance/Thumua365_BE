import { transactionTotals } from './calc';
import { purchases } from './selectors';
import type { AppData } from './types';

export interface SupplierSummary {
  readonly id: string;
  readonly name: string;
  readonly phone?: string;
  readonly location?: string;
  readonly txCount: number;
  readonly totalSpent: number;
  readonly totalWeight: number;
  readonly debt: number;
  readonly lastDate?: string;
}

/**
 * Thống kê tổng hợp theo từng người bán — chỉ tính giao dịch MUA (purchase).
 * Dùng purchases() helper để tránh lẫn giao dịch bán vào thống kê người bán.
 */
export const supplierSummaries = (data: AppData): readonly SupplierSummary[] => {
  const map = new Map<string, SupplierSummary>();

  // Khởi tạo từ danh sách người bán
  for (const s of data.suppliers) {
    map.set(s.id, {
      id: s.id,
      name: s.name,
      phone: s.phone,
      location: s.location,
      txCount: 0,
      totalSpent: 0,
      totalWeight: 0,
      debt: 0,
    });
  }

  // Chỉ tính purchase transactions, gom theo counterpartyId (xem debtsBySupplier)
  for (const t of purchases(data)) {
    const supplierId = t.counterpartyId;
    const cur =
      map.get(supplierId) ??
      ({
        id: supplierId,
        name: t.supplierName,
        txCount: 0,
        totalSpent: 0,
        totalWeight: 0,
        debt: 0,
      } satisfies SupplierSummary);

    const { total, debt, netWeight } = transactionTotals(t);
    map.set(supplierId, {
      ...cur,
      name: cur.name || t.supplierName,
      txCount: cur.txCount + 1,
      totalSpent: cur.totalSpent + total,
      totalWeight: cur.totalWeight + netWeight,
      debt: cur.debt + debt,
      lastDate: !cur.lastDate || t.date > cur.lastDate ? t.date : cur.lastDate,
    });
  }

  return [...map.values()].sort((a, b) => (b.lastDate ?? '').localeCompare(a.lastDate ?? ''));
};
