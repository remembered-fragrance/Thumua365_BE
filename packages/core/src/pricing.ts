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

import type { PriceAdjustment, PricingRule, TransactionLine } from './types.js';

// ─── Context để suggestAdjustments tính toán ─────────────────────────────────

export interface PricingContext {
  readonly lines: readonly TransactionLine[];
  readonly totalKg: number;
  readonly totalAmount: number;
  /** F3: xe đến lấy = true, tự mang tới = false */
  readonly isPickup?: boolean;
}

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

    // Lọc theo khối lượng tối thiểu
    if (rule.minWeightKg !== undefined && ctx.totalKg < rule.minWeightKg) continue;

    // Lọc theo sản phẩm (nếu rule có productId cụ thể)
    if (rule.productId) {
      const hasProduct = ctx.lines.some((l) => l.productId === rule.productId);
      if (!hasProduct) continue;
    }

    // Tính số tiền điều chỉnh
    let amount = 0;
    if (rule.fixedAmount !== undefined) {
      amount += rule.fixedAmount;
    }
    if (rule.percentOfTotal !== undefined) {
      amount += Math.round((ctx.totalAmount * rule.percentOfTotal) / 100);
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
