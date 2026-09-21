import type { PriceAdjustment, Transaction, TransactionLine } from './types.js';

export interface LineTotals {
  readonly netWeight: number;
  readonly rawTotal: number;
  readonly total: number;
}

export interface ReceiptTotals {
  readonly netWeight: number;
  readonly total: number;
  readonly debt: number;
}

const round = (n: number, digits = 0): number => {
  const f = 10 ** digits;
  return Math.round((n + Number.EPSILON) * f) / f;
};

export const roundToThousand = (n: number): number => Math.round(n / 1000) * 1000;

export const linePrice = (line: Pick<TransactionLine, 'pricePerUnit' | 'pricePerKg'>): number =>
  line.pricePerUnit ?? line.pricePerKg ?? 0;

/**
 * Số lượng tính tiền — KHÔNG nhất thiết là khối lượng vật lý.
 * Với rubberLatex: KL × hàm lượng % (là KL quy đổi).
 * Với lossPercent: KL × (1 − hao hụt%).
 * Với netAfterTare: KL − bì.
 * Với standard: KL thô.
 *
 * ⚠️ KHÔNG dùng hàm này để tính tồn kho — dùng linePhysicalWeight() thay thế.
 */
export const lineNetWeight = (
  line: Pick<
    TransactionLine,
    'formulaType' | 'grossWeight' | 'tareWeight' | 'qualityPercent' | 'lossPercent'
  >,
): number => {
  if (line.formulaType === 'rubberLatex') {
    return round(Math.max(line.grossWeight * ((line.qualityPercent ?? 0) / 100), 0), 2);
  }
  if (line.formulaType === 'lossPercent') {
    return round(Math.max(line.grossWeight * (1 - (line.lossPercent ?? 0) / 100), 0), 2);
  }
  if (line.formulaType === 'netAfterTare') {
    return round(Math.max(line.grossWeight - (line.tareWeight ?? 0), 0), 2);
  }
  return round(Math.max(line.grossWeight, 0), 2);
};

/**
 * Khối lượng VẬT LÝ của dòng — luôn dùng grossWeight, không quy đổi.
 * Dùng cho tính TỒN KHO (inventory.ts).
 *
 * Lý do tách riêng: cao su rubberLatex trả về KL quy đổi (lineNetWeight)
 * khác với KL vật lý thực tế — nếu dùng lineNetWeight cho kho sẽ SAI số tồn.
 */
export const linePhysicalWeight = (
  line: Pick<TransactionLine, 'grossWeight'>,
): number => round(Math.max(line.grossWeight, 0), 2);

export const lineTotals = (line: TransactionLine): LineTotals => {
  const netWeight = lineNetWeight(line);
  const rawTotal = line.rawTotal ?? netWeight * linePrice(line);
  return {
    netWeight,
    rawTotal: round(rawTotal),
    total: line.roundedTotal ?? roundToThousand(rawTotal),
  };
};

export const freezeLineTotals = (line: TransactionLine): TransactionLine => {
  const { rawTotal, total } = lineTotals({ ...line, rawTotal: undefined, roundedTotal: undefined });
  return { ...line, rawTotal, roundedTotal: total };
};

/**
 * Tổng adjustments (phí logistics, chiết khấu volume, điều chỉnh tay).
 * Làm tròn đến nghìn đồng ở TỔNG (không làm tròn từng dòng riêng lẻ) — đúng
 * quy định "Tổng phiếu = Σ dòng + Σ adjustments, làm tròn nghìn ở tổng
 * adjustments" (kế hoạch Giai đoạn 2, Workstream G).
 * Với dữ liệu cũ (adjustments rỗng/undefined): roundToThousand(0) = 0,
 * không ảnh hưởng tổng — giữ backward-compat.
 */
export const totalAdjustments = (adjustments?: readonly PriceAdjustment[]): number =>
  roundToThousand((adjustments ?? []).reduce((sum, adj) => sum + adj.amount, 0));

export const computeReceiptTotal = (
  lines: readonly TransactionLine[],
): Pick<ReceiptTotals, 'netWeight' | 'total'> =>
  lines.reduce(
    (acc, line) => {
      const { netWeight, total } = lineTotals(line);
      return { netWeight: acc.netWeight + netWeight, total: acc.total + total };
    },
    { netWeight: 0, total: 0 },
  );

/**
 * Tính tổng phiếu + nợ còn lại.
 *
 * Bất biến (v3): debt = total - sum(payments) = total - amountPaid
 * (amountPaid luôn = sum(payments) sau migrate)
 *
 * Backward compat: với dữ liệu v2 (chưa có adjustments), kết quả
 * phải bằng y hệt kết quả cũ.
 */
export const transactionTotals = (
  t: Pick<Transaction, 'lines' | 'amountPaid' | 'adjustments'>,
): ReceiptTotals => {
  const { netWeight, total: linesTotal } = computeReceiptTotal(t.lines);
  const adj = totalAdjustments(t.adjustments);
  const total = linesTotal + adj;
  return {
    netWeight: round(netWeight, 2),
    total: round(total),
    debt: round(Math.max(total - t.amountPaid, 0)),
  };
};

export const transactionProducts = (t: Pick<Transaction, 'lines'>): readonly string[] => [
  ...new Set(t.lines.map((l) => l.productName || 'Mặt hàng')),
];

export const transactionHasProduct = (t: Pick<Transaction, 'lines'>, product: string): boolean =>
  t.lines.some((l) => l.productName === product || l.crop === product);
