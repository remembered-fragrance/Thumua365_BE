import { transactionTotals } from './calc';
import { sales } from './selectors';
import type { AppData } from './types';

// ─── Buyer Selectors (Workstream F1) ─────────────────────────────────────────

export interface BuyerSummary {
  readonly id: string;
  readonly name: string;
  readonly phone?: string;
  readonly location?: string;
  readonly txCount: number;
  readonly totalRevenue: number;
  readonly totalWeight: number;
  readonly debt: number;
  readonly lastDate?: string;
}

/**
 * Thống kê tổng hợp theo từng người mua — chỉ tính giao dịch BÁN (sale).
 * Mirror supplierSummaries nhưng dùng sales() và tổng theo totalRevenue/debt phải thu.
 */
export const buyerSummaries = (data: AppData): readonly BuyerSummary[] => {
  const map = new Map<string, BuyerSummary>();

  // Khởi tạo từ danh sách người mua
  for (const b of data.buyers) {
    map.set(b.id, {
      id: b.id,
      name: b.name,
      phone: b.phone,
      location: b.location,
      txCount: 0,
      totalRevenue: 0,
      totalWeight: 0,
      debt: 0,
    });
  }

  // Chỉ tính sale transactions
  for (const t of sales(data)) {
    const buyerId = t.counterpartyId;
    const buyerName = data.buyers.find((b) => b.id === buyerId)?.name ?? t.supplierName;
    const cur =
      map.get(buyerId) ??
      ({
        id: buyerId,
        name: buyerName,
        txCount: 0,
        totalRevenue: 0,
        totalWeight: 0,
        debt: 0,
      } satisfies BuyerSummary);

    const { total, debt, netWeight } = transactionTotals(t);
    map.set(buyerId, {
      ...cur,
      name: cur.name || buyerName,
      txCount: cur.txCount + 1,
      totalRevenue: cur.totalRevenue + total,
      totalWeight: cur.totalWeight + netWeight,
      debt: cur.debt + debt,
      lastDate: !cur.lastDate || t.date > cur.lastDate ? t.date : cur.lastDate,
    });
  }

  return [...map.values()].sort((a, b) => (b.lastDate ?? '').localeCompare(a.lastDate ?? ''));
};
