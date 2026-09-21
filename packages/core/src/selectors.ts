import { lineTotals, transactionTotals } from './calc';
import type { AppData, CropType, Transaction } from './types';

// ─── Helpers phân loại giao dịch ─────────────────────────────────────────────

/**
 * Lọc danh sách giao dịch mua (purchase).
 * LUÔN dùng hàm này thay vì data.transactions trực tiếp
 * trong các selector tính chi mua, công nợ mua, thống kê người bán.
 * → Ngăn lỗi "chi mua hôm nay" bị cộng cả tiền bán ra.
 */
export const purchases = (data: Pick<AppData, 'transactions'>): readonly Transaction[] =>
  data.transactions.filter((t) => t.kind === 'purchase');

/**
 * Lọc danh sách giao dịch bán (sale).
 * Dùng cho thống kê doanh thu bán, tồn kho, công nợ phải thu.
 */
export const sales = (data: Pick<AppData, 'transactions'>): readonly Transaction[] =>
  data.transactions.filter((t) => t.kind === 'sale');

// ─── Time helpers ────────────────────────────────────────────────────────────

const startOfToday = (): number => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

const daysAgoMs = (n: number): number => startOfToday() - n * 86_400_000;

// ─── Summary ─────────────────────────────────────────────────────────────────

export interface PeriodSummary {
  readonly count: number;
  readonly weight: number;
  readonly spent: number;
}

const summarize = (txs: readonly Transaction[]): PeriodSummary =>
  txs.reduce<PeriodSummary>(
    (acc, t) => {
      const { netWeight, total } = transactionTotals(t);
      return { count: acc.count + 1, weight: acc.weight + netWeight, spent: acc.spent + total };
    },
    { count: 0, weight: 0, spent: 0 },
  );

/** Tổng hợp CHI MUA theo kỳ — chỉ tính purchase. */
export const summaryFor = (data: AppData, period: 'today' | 'week' | 'month'): PeriodSummary => {
  const since = period === 'today' ? startOfToday() : period === 'week' ? daysAgoMs(6) : daysAgoMs(29);
  return summarize(purchases(data).filter((t) => new Date(t.date).getTime() >= since));
};

// ─── Product breakdown ───────────────────────────────────────────────────────

export interface ProductBreakdown {
  readonly productName: string;
  readonly crop?: CropType;
  readonly spent: number;
  readonly weight: number;
}

/** Chi mua theo mặt hàng trong kỳ — chỉ tính purchase. */
export const spentByCrop = (data: AppData, period: 'week' | 'month'): ProductBreakdown[] => {
  const since = period === 'week' ? daysAgoMs(6) : daysAgoMs(29);
  const map = new Map<string, ProductBreakdown>();
  for (const t of purchases(data)) {
    if (new Date(t.date).getTime() < since) continue;
    for (const line of t.lines) {
      const lt = lineTotals(line);
      const name = line.productName || 'Mặt hàng';
      const cur = map.get(name) ?? { productName: name, crop: line.crop, spent: 0, weight: 0 };
      map.set(name, {
        productName: name,
        crop: cur.crop ?? line.crop,
        spent: cur.spent + lt.total,
        weight: cur.weight + lt.netWeight,
      });
    }
  }
  return [...map.values()].sort((a, b) => b.spent - a.spent);
};

// ─── Debt (purchase side) ────────────────────────────────────────────────────

/** Tổng công nợ PHẢI TRẢ (nợ mua) — chỉ tính purchase. */
export const totalOutstandingDebt = (data: AppData): number =>
  purchases(data).reduce((sum, t) => sum + transactionTotals(t).debt, 0);

export interface SupplierDebt {
  readonly supplierId: string;
  readonly supplierName: string;
  readonly debt: number;
  readonly transactions: readonly Transaction[];
}

/**
 * Công nợ PHẢI TRẢ theo từng người bán — chỉ tính purchase.
 * Gom theo `counterpartyId`: đó là khoá đối tác duy nhất của cả app
 * (filters.ts lọc theo nó, debtsByBuyer gom theo nó). `supplierId` chỉ còn
 * để đọc dữ liệu v1/v2 và có thể lệch sau khi phiếu được sửa người bán.
 */
export const debtsBySupplier = (data: AppData): SupplierDebt[] => {
  const map = new Map<string, { name: string; debt: number; txs: Transaction[] }>();
  for (const t of purchases(data)) {
    const { debt } = transactionTotals(t);
    if (debt <= 0) continue;
    const supplierId = t.counterpartyId;
    const cur = map.get(supplierId) ?? {
      name: data.suppliers.find((s) => s.id === supplierId)?.name ?? t.supplierName,
      debt: 0,
      txs: [],
    };
    cur.debt += debt;
    cur.txs.push(t);
    map.set(supplierId, cur);
  }
  return [...map.entries()]
    .map(([supplierId, v]) => ({
      supplierId,
      supplierName: v.name,
      debt: v.debt,
      transactions: v.txs.sort((a, b) => +new Date(a.date) - +new Date(b.date)),
    }))
    .filter((g) => g.debt > 0)
    .sort((a, b) => b.debt - a.debt);
};

// ─── Daily spend chart ───────────────────────────────────────────────────────

/** Chi mua ngày theo ngày, dùng cho biểu đồ dashboard — chỉ tính purchase. */
export interface DailyPoint {
  readonly label: string;
  readonly spent: number;
}

export const dailySpend = (data: AppData, days = 7): DailyPoint[] => {
  const points: DailyPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const start = daysAgoMs(i);
    const end = start + 86_400_000;
    const spent = purchases(data)
      .filter((t) => {
        const ms = new Date(t.date).getTime();
        return ms >= start && ms < end;
      })
      .reduce((s, t) => s + transactionTotals(t).total, 0);
    const label = new Date(start).toLocaleDateString('vi-VN', { weekday: 'short' });
    points.push({ label, spent });
  }
  return points;
};

// ─── Sales summary (F5) ──────────────────────────────────────────────────────

/** Tổng hợp DOANH THU BÁN theo kỳ — chỉ tính sale. */
export const salesSummaryFor = (data: AppData, period: 'today' | 'week' | 'month'): PeriodSummary => {
  const since = period === 'today' ? startOfToday() : period === 'week' ? daysAgoMs(6) : daysAgoMs(29);
  return summarize(sales(data).filter((t) => new Date(t.date).getTime() >= since));
};

/** Doanh thu bán theo mặt hàng trong kỳ — chỉ tính sale. */
export const revenueByCrop = (data: AppData, period: 'week' | 'month'): ProductBreakdown[] => {
  const since = period === 'week' ? daysAgoMs(6) : daysAgoMs(29);
  const map = new Map<string, ProductBreakdown>();
  for (const t of sales(data)) {
    if (new Date(t.date).getTime() < since) continue;
    for (const line of t.lines) {
      const lt = lineTotals(line);
      const name = line.productName || 'Mặt hàng';
      const cur = map.get(name) ?? { productName: name, crop: line.crop, spent: 0, weight: 0 };
      map.set(name, {
        productName: name,
        crop: cur.crop ?? line.crop,
        spent: cur.spent + lt.total,
        weight: cur.weight + lt.netWeight,
      });
    }
  }
  return [...map.values()].sort((a, b) => b.spent - a.spent);
};

// ─── Debt (sale side — phải thu) ─────────────────────────────────────────────

/** Tổng công nợ PHẢI THU (nợ bán) — chỉ tính sale. */
export const totalReceivable = (data: AppData): number =>
  sales(data).reduce((sum, t) => sum + transactionTotals(t).debt, 0);

export interface BuyerDebt {
  readonly buyerId: string;
  readonly buyerName: string;
  readonly debt: number;
  readonly transactions: readonly Transaction[];
}

/** Công nợ PHẢI THU theo từng người mua — chỉ tính sale. */
export const debtsByBuyer = (data: AppData): BuyerDebt[] => {
  const map = new Map<string, { name: string; debt: number; txs: Transaction[] }>();
  for (const t of sales(data)) {
    const { debt } = transactionTotals(t);
    if (debt <= 0) continue;
    const buyerId = t.counterpartyId;
    const buyerName = data.buyers.find((b) => b.id === buyerId)?.name ?? t.supplierName;
    const cur = map.get(buyerId) ?? { name: buyerName, debt: 0, txs: [] };
    cur.debt += debt;
    cur.txs.push(t);
    map.set(buyerId, cur);
  }
  return [...map.entries()]
    .map(([buyerId, v]) => ({
      buyerId,
      buyerName: v.name,
      debt: v.debt,
      transactions: v.txs.sort((a, b) => +new Date(a.date) - +new Date(b.date)),
    }))
    .filter((g) => g.debt > 0)
    .sort((a, b) => b.debt - a.debt);
};
