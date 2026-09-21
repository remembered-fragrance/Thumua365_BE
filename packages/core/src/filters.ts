import { transactionTotals } from './calc.js';
import type { Transaction, TransactionKind } from './types.js';

export type TimePeriod = 'day' | 'week' | 'month' | 'year' | 'custom' | 'all';
export type PaymentFilter = 'all' | 'paid' | 'unpaid';

export interface HistoryFilters {
  readonly period: TimePeriod;
  readonly customFrom?: string;
  readonly customTo?: string;
  readonly payment: PaymentFilter;
  readonly supplierId?: string;
  readonly crop?: string;
  readonly query?: string;
  /** F2: lọc theo chiều giao dịch. Mặc định 'purchase' để giữ hành vi cũ. */
  readonly kind?: TransactionKind | 'all';
}

const startOfDay = (d: Date): Date => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

export const periodRange = (filters: HistoryFilters): { from: number; to: number } | null => {
  if (filters.period === 'all') return null;
  const now = new Date();
  const end = startOfDay(now).getTime() + 86_400_000 - 1;

  if (filters.period === 'custom' && filters.customFrom) {
    const from = startOfDay(new Date(filters.customFrom)).getTime();
    const to = filters.customTo
      ? startOfDay(new Date(filters.customTo)).getTime() + 86_400_000 - 1
      : end;
    return { from, to };
  }

  const start = startOfDay(now);
  if (filters.period === 'day') return { from: start.getTime(), to: end };
  if (filters.period === 'week') {
    const dow = start.getDay();
    const mondayOffset = dow === 0 ? 6 : dow - 1;
    start.setDate(start.getDate() - mondayOffset);
    return { from: start.getTime(), to: end };
  }
  if (filters.period === 'month') {
    start.setDate(1);
    return { from: start.getTime(), to: end };
  }
  if (filters.period === 'year') {
    start.setMonth(0, 1);
    return { from: start.getTime(), to: end };
  }
  return null;
};

export const filterTransactions = (
  transactions: readonly Transaction[],
  filters: HistoryFilters,
): Transaction[] => {
  const range = periodRange(filters);
  const q = filters.query?.trim().toLowerCase() ?? '';

  return transactions.filter((t) => {
    // F2: lọc kind trước các filter khác (default 'purchase' nếu chưa chọn)
    const kindFilter = filters.kind ?? 'purchase';
    if (kindFilter !== 'all' && t.kind !== kindFilter) return false;

    const ms = new Date(t.date).getTime();
    if (range && (ms < range.from || ms > range.to)) return false;
    if (filters.supplierId && t.counterpartyId !== filters.supplierId) return false;
    if (
      filters.crop &&
      filters.crop !== 'all' &&
      !t.lines.some((l) => l.productName === filters.crop || l.crop === filters.crop)
    ) {
      return false;
    }
    const { debt } = transactionTotals(t);
    if (filters.payment === 'paid' && debt > 0) return false;
    if (filters.payment === 'unpaid' && debt <= 0) return false;
    if (q) {
      const cropLabels = t.lines.map((l) => l.productName).join(' ');
      const hay = `${t.supplierName} ${cropLabels} ${t.note ?? ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
};
