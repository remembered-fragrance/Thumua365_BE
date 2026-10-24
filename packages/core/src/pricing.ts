/**
 * Pricing Engine — Workstream G
 *
 * PricingRule: quy tắc điều chỉnh giá tự động (chiết khấu theo khối lượng,
 * phí vận chuyển, thưởng/phạt chất lượng, v.v.).
 *
 * Bất biến quan trọng:
 * - suggestAdjustments() KHÔNG sửa calc.ts, KHÔNG thay đổi pricePerUnit.
 * - Điều chỉnh là PriceAdjustment[] — được cộng vào tổng phiếu qua totalAdjustments().
 * - Công thức dòng (lineNetWeight, lineTotals) KHÔNG thay đổi.
 */

import { computeReceiptTotal, lineNetWeight } from './calc.js';
import type { PriceAdjustment, PricingRule, QualityStep, TransactionLine } from './types.js';

// ─── Context để suggestAdjustments tính toán ─────────────────────────────────

export interface PricingContext {
  readonly lines: readonly TransactionLine[];
  readonly totalKg: number;
  readonly totalAmount: number;
  /** F3: xe đến lấy = true, tự mang tới = false */
  readonly isPickup?: boolean;
}

// ─── Quy tắc theo chỉ tiêu chất lượng (V19) ─────────────────────────────────

/** Mốc đang áp cho `value`: mốc có `from` lớn nhất mà ≤ `value`. Dưới mốc đầu tiên thì không có mốc nào. */
export const qualityStepOf = (
  steps: readonly QualityStep[],
  value: number,
): QualityStep | undefined =>
  [...steps].sort((a, b) => a.from - b.from).findLast((step) => value >= step.from);

/**
 * Tiền một quy tắc chỉ tiêu cộng/trừ trên cả phiếu: mỗi dòng có chỉ tiêu đó lấy mốc của nó × lượng tính
 * tiền của dòng (`lineNetWeight` — với mủ là kg quy khô). Dòng không nhập chỉ tiêu thì bỏ qua.
 */
const qualityAmount = (rule: PricingRule, lines: readonly TransactionLine[]): number => {
  if (!rule.qualityMetric) return 0;
  let amount = 0;
  for (const line of lines) {
    if (rule.productId && line.productId !== rule.productId) continue;
    const value = line[rule.qualityMetric];
    if (value === undefined) continue;
    const step = qualityStepOf(rule.qualitySteps ?? [], value);
    if (step) amount += step.amountPerUnit * lineNetWeight(line);
  }
  return Math.round(amount);
};

// ─── Suggest adjustments ─────────────────────────────────────────────────────

/**
 * Tính danh sách điều chỉnh tự động từ rules.
 * Trả về mảng PriceAdjustment[] để ghép vào phiếu — KHÔNG sửa lines.
 */
export const suggestAdjustments = (
  rules: readonly PricingRule[],
  ctx: PricingContext,
): PriceAdjustment[] => {
  const suggestions: PriceAdjustment[] = [];

  for (const rule of rules) {
    if (!rule.active) continue;

    // Lọc theo loại xe
    if (rule.appliesOnPickup !== null && rule.appliesOnPickup !== undefined) {
      if (rule.appliesOnPickup !== Boolean(ctx.isPickup)) continue;
    }

    // Quy tắc gắn một mặt hàng chỉ đọc dòng của mặt hàng đó: "mua cà phê từ 500 kg bớt 1%" không tính
    // 300 kg tiêu cùng phiếu vào ngưỡng, không bớt 1% trên tiền tiêu.
    let { totalKg, totalAmount } = ctx;
    if (rule.productId) {
      const own = ctx.lines.filter((l) => l.productId === rule.productId);
      if (own.length === 0) continue;
      ({ netWeight: totalKg, total: totalAmount } = computeReceiptTotal(own));
    }

    // Lọc theo khối lượng tối thiểu
    if (rule.minWeightKg !== undefined && totalKg < rule.minWeightKg) continue;

    // Tính số tiền điều chỉnh
    let amount = 0;
    if (rule.qualityMetric) {
      amount = qualityAmount(rule, ctx.lines);
    } else {
      if (rule.fixedAmount !== undefined) {
        amount += rule.fixedAmount;
      }
      if (rule.percentOfTotal !== undefined) {
        amount += Math.round((totalAmount * rule.percentOfTotal) / 100);
      }
    }

    if (amount !== 0) {
      suggestions.push({
        id: `rule-${rule.id}`,
        kind: rule.kind,
        label: rule.name,
        amount,
        ruleId: rule.id,
      });
    }
  }

  return suggestions;
};
