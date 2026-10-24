/**
 * Phân tích theo mặt hàng (V8) và đối chiếu độ mủ với nhà máy (V21) — phần thuần, tính từ sổ ở máy.
 *
 * Lời của một mặt hàng là lời ƯỚC TÍNH: lượng bán × (giá bán bình quân − giá mua bình quân) trong kỳ. Không lấy
 * "tiền bán − tiền mua" vì vựa mua về để kho rồi mới bán: tháng gom nhiều thì tiền mua lớn hơn hẳn tiền bán mà
 * không phải lỗ. Khoản cộng / trừ của phiếu (phí xe, chiết khấu) gắn với cả phiếu, không vào mặt hàng nào.
 */

import { lineTotals } from './calc.js';
import { isInRange, type TaxReportRange } from './taxReport.js';
import type { AppData, RubberKind, TransactionLine } from './types.js';

export interface ProductAnalytics {
  /** `productId` của dòng, không có thì tên mặt hàng. */
  readonly key: string;
  readonly product: string;
  readonly unit: string;
  /** Lượng tính tiền (cao su: kg quy khô). */
  readonly boughtQty: number;
  readonly boughtAmount: number;
  readonly soldQty: number;
  readonly soldAmount: number;
  readonly avgBuyPrice: number | null;
  readonly avgSellPrice: number | null;
  /** `null` khi trong kỳ chỉ mua hoặc chỉ bán — chưa đủ để ước lời. */
  readonly profit: number | null;
}

export interface AnalyticsReport {
  readonly range: TaxReportRange;
  /** Lời nhiều trước; mặt hàng chưa ước được lời xếp cuối, theo tiền mua. */
  readonly products: readonly ProductAnalytics[];
  /** Cộng các `profit` khác `null`. */
  readonly profit: number;
}

const round = (n: number, digits = 0): number => {
  const f = 10 ** digits;
  return Math.round((n + Number.EPSILON) * f) / f;
};

const lineKey = (line: TransactionLine): string => line.productId ?? line.productName;

interface Acc {
  product: string;
  unit: string;
  boughtQty: number;
  boughtAmount: number;
  soldQty: number;
  soldAmount: number;
}

export const buildAnalytics = (data: AppData, range: TaxReportRange): AnalyticsReport => {
  const acc = new Map<string, Acc>();
  for (const t of data.transactions) {
    if (!isInRange(t.date, range)) continue;
    for (const line of t.lines) {
      const key = lineKey(line);
      const row = acc.get(key) ?? { product: line.productName, unit: line.unit, boughtQty: 0, boughtAmount: 0, soldQty: 0, soldAmount: 0 };
      const { netWeight, total } = lineTotals(line);
      if (t.kind === 'sale') {
        row.soldQty += netWeight;
        row.soldAmount += total;
      } else {
        row.boughtQty += netWeight;
        row.boughtAmount += total;
      }
      acc.set(key, row);
    }
  }

  const products = [...acc].map(([key, r]): ProductAnalytics => {
    const avgBuyPrice = r.boughtQty > 0 ? round(r.boughtAmount / r.boughtQty) : null;
    const avgSellPrice = r.soldQty > 0 ? round(r.soldAmount / r.soldQty) : null;
    const profit =
      avgBuyPrice !== null && avgSellPrice !== null
        ? round(r.soldQty * ((r.soldAmount / r.soldQty) - (r.boughtAmount / r.boughtQty)))
        : null;
    return {
      key,
      product: r.product,
      unit: r.unit,
      boughtQty: round(r.boughtQty, 2),
      boughtAmount: r.boughtAmount,
      soldQty: round(r.soldQty, 2),
      soldAmount: r.soldAmount,
      avgBuyPrice,
      avgSellPrice,
      profit,
    };
  });

  products.sort((a, b) => {
    if (a.profit !== null && b.profit !== null) return b.profit - a.profit;
    if (a.profit !== null) return -1;
    if (b.profit !== null) return 1;
    return b.boughtAmount - a.boughtAmount;
  });

  return { range, products, profit: products.reduce((sum, p) => sum + (p.profit ?? 0), 0) };
};

// ─── Đối chiếu độ mủ với nhà máy (V21) ──────────────────────────────────────

/**
 * Độ trung bình của một nhóm dòng mủ, có trọng số theo kg mủ tươi: Σ kg khô / Σ kg tươi × 100. Một hộ bán 100 kg
 * độ 30 và 10 kg độ 40 là độ ~30,9, không phải 35.
 */
interface RubberAcc {
  wet: number;
  dry: number;
  amount: number;
}

export interface RubberSide {
  /** Kg mủ tươi trên cân. */
  readonly wetKg: number;
  /** Kg quy khô (kg × độ). */
  readonly dryKg: number;
  /** Độ trung bình theo trọng số, 1 chữ số lẻ. `null` khi không có dòng nào. */
  readonly avgPercent: number | null;
  readonly amount: number;
}

export interface RubberReconcile {
  readonly key: string;
  readonly product: string;
  readonly rubberKind: RubberKind;
  /** Vựa đo lúc mua của các hộ. */
  readonly bought: RubberSide;
  /** Nhà máy đo lúc vựa bán (độ trên phiếu bán chính là độ nhà máy chốt). */
  readonly sold: RubberSide;
  /** Độ vựa đo − độ nhà máy đo. Dương = vựa đo cao hơn nhà máy, vựa đang trả dư cho hộ. `null` khi thiếu một bên. */
  readonly gapPercent: number | null;
  /**
   * Tiền chênh vì lệch độ, tính trên lượng đã bán: kg tươi bán × lệch độ × giá bán bình quân / kg khô. Dương = vựa
   * mất. `null` khi thiếu một bên.
   */
  readonly gapAmount: number | null;
}

export interface SellerRubber {
  readonly sellerName: string;
  readonly product: string;
  readonly wetKg: number;
  readonly avgPercent: number | null;
}

export interface RubberReport {
  readonly range: TaxReportRange;
  readonly products: readonly RubberReconcile[];
  /** Độ trung bình theo từng hộ bán (phiếu mua), nhiều kg trước. */
  readonly sellers: readonly SellerRubber[];
}

const side = (a: RubberAcc | undefined): RubberSide => {
  const wet = a?.wet ?? 0;
  const dry = a?.dry ?? 0;
  return {
    wetKg: round(wet, 2),
    dryKg: round(dry, 2),
    avgPercent: wet > 0 ? round((dry / wet) * 100, 1) : null,
    amount: a?.amount ?? 0,
  };
};

const add = (map: Map<string, RubberAcc>, key: string, line: TransactionLine): void => {
  const a = map.get(key) ?? { wet: 0, dry: 0, amount: 0 };
  const { netWeight, total } = lineTotals(line);
  a.wet += Math.max(line.grossWeight, 0);
  a.dry += netWeight;
  a.amount += total;
  map.set(key, a);
};

export const buildRubberReconcile = (data: AppData, range: TaxReportRange): RubberReport => {
  const bought = new Map<string, RubberAcc>();
  const sold = new Map<string, RubberAcc>();
  const meta = new Map<string, { product: string; rubberKind: RubberKind }>();
  const sellers = new Map<string, RubberAcc & { sellerName: string; product: string }>();

  for (const t of data.transactions) {
    if (!isInRange(t.date, range)) continue;
    for (const line of t.lines) {
      if (line.formulaType !== 'rubberLatex') continue;
      const key = lineKey(line);
      if (!meta.has(key)) meta.set(key, { product: line.productName, rubberKind: line.rubberKind ?? 'latex' });
      if (t.kind === 'sale') {
        add(sold, key, line);
        continue;
      }
      add(bought, key, line);
      const sellerKey = `${t.counterpartyId || t.supplierName}\u0000${key}`;
      const s = sellers.get(sellerKey) ?? { sellerName: t.supplierName, product: line.productName, wet: 0, dry: 0, amount: 0 };
      s.wet += Math.max(line.grossWeight, 0);
      s.dry += lineTotals(line).netWeight;
      sellers.set(sellerKey, s);
    }
  }

  const products = [...meta].map(([key, m]): RubberReconcile => {
    const b = side(bought.get(key));
    const s = side(sold.get(key));
    const both = b.avgPercent !== null && s.avgPercent !== null;
    const buyRaw = b.wetKg > 0 ? (b.dryKg / b.wetKg) * 100 : 0;
    const sellRaw = s.wetKg > 0 ? (s.dryKg / s.wetKg) * 100 : 0;
    const pricePerDry = s.dryKg > 0 ? s.amount / s.dryKg : 0;
    return {
      key,
      product: m.product,
      rubberKind: m.rubberKind,
      bought: b,
      sold: s,
      gapPercent: both ? round(buyRaw - sellRaw, 1) : null,
      gapAmount: both ? round(s.wetKg * ((buyRaw - sellRaw) / 100) * pricePerDry) : null,
    };
  });

  return {
    range,
    products,
    sellers: [...sellers.values()]
      .map((s) => ({
        sellerName: s.sellerName,
        product: s.product,
        wetKg: round(s.wet, 2),
        avgPercent: s.wet > 0 ? round((s.dry / s.wet) * 100, 1) : null,
      }))
      .sort((a, b) => b.wetKg - a.wetKg),
  };
};
