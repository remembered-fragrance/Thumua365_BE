/**
 * Công nợ nhìn từ một khuôn duy nhất.
 *
 * `selectors.ts` đã có `debtsBySupplier` (phải trả) và `debtsByBuyer` (phải
 * thu) với hai kiểu trả về khác nhau. Màn Công nợ vẽ hai bên bằng CÙNG một
 * component, nên ở đây quy về một kiểu `DebtGroup` chung — không sửa hai hàm
 * cũ, chỉ bọc lại.
 *
 * Quá hạn tính theo `creditTerms` của phiếu: đến hẹn mà còn nợ thì quá hạn.
 * Phiếu không hẹn ngày thì không bao giờ quá hạn — không tự bịa ra hạn.
 */

import { transactionTotals } from './calc.js';
import { debtsByBuyer, debtsBySupplier } from './selectors.js';
import type { AppData, Transaction } from './types.js';

export type DebtSide = 'payable' | 'receivable';

export interface DebtGroup {
  readonly partyId: string;
  readonly partyName: string;
  readonly debt: number;
  /** Còn nợ mà đã qua ngày hẹn. */
  readonly overdue: boolean;
  /** Hạn gần nhất trong nhóm — dùng để hiện "Hẹn 12/08". */
  readonly dueDate?: string;
  readonly transactions: readonly Transaction[];
}

const startOfDayMs = (ms: number): number => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** Hạn trả SỚM NHẤT của phiếu. Không hẹn ngày thì không có hạn. */
export const dueDateOf = (tx: Pick<Transaction, 'creditTerms'>): string | undefined =>
  (tx.creditTerms ?? []).reduce<string | undefined>(
    (soonest, term) => (!soonest || term.dueDate < soonest ? term.dueDate : soonest),
    undefined,
  );

/**
 * Phiếu này đã quá hạn chưa.
 *
 * So theo ĐẦU NGÀY: hẹn hôm nay thì hôm nay chưa quá hạn, sang ngày mai mới
 * quá. Chủ vựa hẹn "ngày 12 trả" nghĩa là hết ngày 12.
 */
export const isOverdue = (tx: Transaction, now: number = Date.now()): boolean => {
  const due = dueDateOf(tx);
  if (!due) return false;
  if (transactionTotals(tx).debt <= 0) return false;
  return startOfDayMs(new Date(due).getTime()) < startOfDayMs(now);
};

const toGroup = (
  partyId: string,
  partyName: string,
  debt: number,
  transactions: readonly Transaction[],
  now: number,
): DebtGroup => {
  const unpaid = transactions.filter((t) => transactionTotals(t).debt > 0);
  const dues = unpaid.map(dueDateOf).filter((d): d is string => d !== undefined);
  return {
    partyId,
    partyName,
    debt,
    overdue: unpaid.some((t) => isOverdue(t, now)),
    dueDate: dues.length > 0 ? dues.reduce((a, b) => (a < b ? a : b)) : undefined,
    transactions,
  };
};

/**
 * Nhóm công nợ của một bên, đã sắp xếp: **quá hạn trước, rồi tiền nhiều
 * trước**. Người ta mở màn này để biết hôm nay phải trả ai — thứ tự đó là
 * câu trả lời, không phải bảng chữ cái.
 */
export const debtGroups = (
  data: AppData,
  side: DebtSide,
  now: number = Date.now(),
): DebtGroup[] => {
  const groups =
    side === 'payable'
      ? debtsBySupplier(data).map((g) =>
          toGroup(g.supplierId, g.supplierName, g.debt, g.transactions, now),
        )
      : debtsByBuyer(data).map((g) =>
          toGroup(g.buyerId, g.buyerName, g.debt, g.transactions, now),
        );

  return groups.sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    return b.debt - a.debt;
  });
};

export const overdueCount = (data: AppData, now: number = Date.now()): number =>
  [...debtGroups(data, 'payable', now), ...debtGroups(data, 'receivable', now)].filter(
    (g) => g.overdue,
  ).length;

export const totalOf = (groups: readonly DebtGroup[]): number =>
  groups.reduce((sum, g) => sum + g.debt, 0);
