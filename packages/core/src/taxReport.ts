/**
 * Báo cáo thuế — phần thuần.
 * Gộp số liệu mua/bán/lãi gộp theo kỳ. Việc xuất XLSX nằm ở `export/taxReportXlsx.ts`.
 */

import { linePrice, lineTotals, totalAdjustments, transactionTotals } from './calc.js';
import type { AppData, Transaction } from './types.js';

export interface TaxReportRange {
  readonly from: Date;
  readonly to: Date;
  readonly label: string;
}

export interface TaxReport {
  readonly range: TaxReportRange;
  readonly totalPurchase: number;
  readonly totalSale: number;
  readonly grossProfit: number;
  readonly purchaseCount: number;
  readonly saleCount: number;
  readonly disclaimer: string;
}

/**
 * KE_HOACH_GOI_PRO §4.2: file thuế chỉ là số tổng hợp từ sổ của chính người dùng — app không kiểm đúng luật, không
 * hứa "đúng mẫu". Mọi file và màn hình thuế mang câu này.
 */
export const TAX_REPORT_DISCLAIMER =
  'Số liệu tổng hợp từ sổ của bạn. Bạn tự kiểm tra và chịu trách nhiệm khi dùng để kê khai thuế.';

/** Giao dịch nằm trong kỳ [from, to] — mốc đầu và cuối kỳ đều TÍNH VÀO. */
export const isInRange = (isoDate: string, range: TaxReportRange): boolean => {
  const ms = new Date(isoDate).getTime();
  return ms >= range.from.getTime() && ms <= range.to.getTime();
};

export const buildTaxReport = (data: AppData, range: TaxReportRange): TaxReport => {
  let totalPurchase = 0;
  let purchaseCount = 0;
  let totalSale = 0;
  let saleCount = 0;

  for (const t of data.transactions) {
    if (!isInRange(t.date, range)) continue;
    const { total } = transactionTotals(t);
    if (t.kind === 'sale') {
      totalSale += total;
      saleCount++;
    } else {
      totalPurchase += total;
      purchaseCount++;
    }
  }

  return {
    range,
    totalPurchase,
    totalSale,
    grossProfit: totalSale - totalPurchase,
    purchaseCount,
    saleCount,
    disclaimer: TAX_REPORT_DISCLAIMER,
  };
};

// ─── Bảng kê thu mua dạng 02/TNDN (V12) ──────────────────────────────────────

/** Hình thức trả của cả phiếu: theo các lần trả; lần trả không ghi hình thức (app cũ) coi là tiền mặt. */
export type LedgerPaidBy = 'cash' | 'transfer' | 'mixed' | 'unpaid';

/**
 * Một dòng bảng kê = một dòng hàng của phiếu mua. Phiếu có khoản cộng / trừ thêm một dòng `product: null`
 * (tổng các khoản) để cộng cột thành tiền ra đúng tổng phiếu. KHÔNG có CCCD, địa chỉ: sổ không lưu (§4.2) —
 * file chừa cột trống cho người dùng tự điền.
 */
export interface PurchaseLedgerRow {
  readonly transactionId: string;
  readonly date: string;
  readonly sellerName: string;
  /** `null` = dòng cộng / trừ của phiếu. */
  readonly product: string | null;
  /** Lượng tính tiền (cao su: kg quy khô). `null` ở dòng cộng / trừ. */
  readonly quantity: number | null;
  readonly unit: string | null;
  readonly unitPrice: number | null;
  readonly amount: number;
  readonly paidBy: LedgerPaidBy;
}

export const ledgerPaidBy = (t: Pick<Transaction, 'payments'>): LedgerPaidBy => {
  const paid = t.payments.filter((p) => p.amount > 0);
  if (paid.length === 0) return 'unpaid';
  const transfer = paid.filter((p) => p.method === 'transfer').length;
  if (transfer === 0) return 'cash';
  return transfer === paid.length ? 'transfer' : 'mixed';
};

/** Phiếu mua trong kỳ, cũ trước — đúng thứ tự ghi bảng kê. */
export const buildPurchaseLedger = (data: AppData, range: TaxReportRange): readonly PurchaseLedgerRow[] =>
  data.transactions
    .filter((t) => t.kind !== 'sale' && isInRange(t.date, range))
    .sort((a, b) => a.date.localeCompare(b.date))
    .flatMap((t) => {
      const base = { transactionId: t.id, date: t.date, sellerName: t.supplierName, paidBy: ledgerPaidBy(t) };
      const rows: PurchaseLedgerRow[] = t.lines.map((line) => {
        const { netWeight, total } = lineTotals(line);
        return {
          ...base,
          product: line.productName,
          quantity: netWeight,
          unit: line.unit,
          unitPrice: linePrice(line),
          amount: total,
        };
      });
      const adjustments = totalAdjustments(t.adjustments);
      if (adjustments !== 0) rows.push({ ...base, product: null, quantity: null, unit: null, unitPrice: null, amount: adjustments });
      return rows;
    });
