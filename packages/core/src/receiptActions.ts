/**
 * Lập phiếu và ghi tiền. Hàm thuần.
 *
 * Bất biến giữ ở đây, không giữ ở giao diện:
 *   amountPaid === sum(payments)   — luôn tính lại, không tin số cũ
 *   không trả vượt tổng phiếu
 *   dòng hàng được đóng băng khi phiếu chốt (freezeLineTotals)
 */

import { freezeLineTotals, transactionTotals } from './calc';
import { newId } from './id';
import { resolveBuyer, resolveSupplier } from './partyActions';
import type { AppData, Payment, Product, Transaction, TransactionLine } from './types';

export type NewTransaction = Omit<Transaction, 'id' | 'supplierId'> & { supplierId?: string };

const sumPayments = (payments: readonly Payment[]): number =>
  payments.reduce((s, p) => s + p.amount, 0);

/** Nhớ giá lần gần nhất của mặt hàng để lần sau gợi ý sẵn. */
const rememberPrices = (
  products: readonly Product[],
  lines: readonly TransactionLine[],
): Product[] =>
  products.map((p) => {
    const line = [...lines].reverse().find((l) => l.productId === p.id);
    return line ? { ...p, lastPricePerUnit: line.pricePerUnit } : p;
  });

export const addTransaction = (
  data: AppData,
  input: NewTransaction,
): { data: AppData; transaction: Transaction } => {
  const party =
    input.kind === 'sale'
      ? resolveBuyer(data, input.counterpartyId ?? input.supplierId, input.supplierName)
      : resolveSupplier(data, input.counterpartyId ?? input.supplierId, input.supplierName);

  const lines = input.lines.map(freezeLineTotals);

  // Chưa có lịch sử trả tiền thì dựng một lần trả từ số đã trả trên form.
  const payments: readonly Payment[] = input.payments?.length
    ? input.payments
    : input.amountPaid > 0
      ? [{ id: newId(), date: input.date, amount: input.amountPaid }]
      : [];

  const transaction: Transaction = {
    ...input,
    id: newId(),
    supplierId: party.id,
    supplierName: party.name,
    counterpartyId: party.id,
    kind: input.kind ?? 'purchase',
    lines,
    payments,
    amountPaid: sumPayments(payments),
  };

  return {
    data: {
      ...party.data,
      products: rememberPrices(party.data.products, lines),
      transactions: [transaction, ...party.data.transactions],
    },
    transaction,
  };
};

/**
 * Ghi một lần trả tiền.
 * Trả về `payment: null` khi không ghi được (phiếu không tồn tại, đã trả đủ,
 * số tiền ≤ 0) — người gọi phải xử lý, không im lặng coi như thành công.
 */
export const recordPayment = (
  data: AppData,
  txId: string,
  amount: number,
): { data: AppData; payment: Payment | null } => {
  const target = data.transactions.find((t) => t.id === txId);
  if (!target) return { data, payment: null };

  const { total } = transactionTotals(target);
  const remaining = Math.max(total - target.amountPaid, 0);
  const actual = Math.min(Math.max(amount, 0), remaining);
  if (actual <= 0) return { data, payment: null };

  const payment: Payment = { id: newId(), date: new Date().toISOString(), amount: actual };
  const payments = [...target.payments, payment];

  return {
    data: {
      ...data,
      transactions: data.transactions.map((t) =>
        t.id === txId ? { ...t, payments, amountPaid: sumPayments(payments) } : t,
      ),
    },
    payment,
  };
};

/**
 * Bỏ một lần trả tiền — dùng cho nút "Hoàn tác" sau khi bấm nhầm "Trả đủ".
 *
 * Bỏ hẳn khỏi danh sách chứ KHÔNG ghi thêm một khoản âm: sổ nợ của chủ vựa
 * không có khái niệm "trả âm", và một dòng −5.000.000₫ trong lịch sử trả tiền
 * là thứ không ai giải thích được khi đối chiếu với nông hộ. Phía máy chủ đây
 * là xoá mềm, nên bản ghi vẫn còn để truy vết.
 */
export const removePayment = (data: AppData, txId: string, paymentId: string): AppData => ({
  ...data,
  transactions: data.transactions.map((t) => {
    if (t.id !== txId) return t;
    const payments = t.payments.filter((p) => p.id !== paymentId);
    return { ...t, payments, amountPaid: sumPayments(payments) };
  }),
});

export const updateTransactionAttachments = (
  data: AppData,
  txId: string,
  attachmentIds: readonly string[],
): AppData => ({
  ...data,
  transactions: data.transactions.map((t) => (t.id === txId ? { ...t, attachmentIds } : t)),
});

export const deleteTransaction = (data: AppData, txId: string): AppData => ({
  ...data,
  transactions: data.transactions.filter((t) => t.id !== txId),
});
