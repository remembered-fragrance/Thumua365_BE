/**
 * Báo cáo thuế — phần thuần.
 * Gộp số liệu mua/bán/lãi gộp theo kỳ. Việc xuất XLSX nằm ở `export/taxReportXlsx.ts`.
 */

import { transactionTotals } from './calc.js';
import type { AppData } from './types.js';

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

export const TAX_REPORT_DISCLAIMER =
  'Số liệu ước tính, vui lòng đối soát với kế toán trước khi nộp thuế.';

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
