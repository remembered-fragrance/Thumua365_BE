/**
 * Xem trước tác dụng của một quy tắc giá trên MỘT đơn hàng mẫu.
 *
 * Không viết lại logic áp quy tắc — gọi thẳng `suggestAdjustments`. Nếu preview
 * tự tính lấy thì đến một lúc nào đó nó nói một đằng, phiếu thật tính một nẻo,
 * và người dùng mất niềm tin vào cả hai.
 */

import { suggestAdjustments } from './pricing';
import type { PricingRule, TransactionLine } from './types';

/** Đơn hàng mẫu: 1 tấn × 20.000đ = 20 triệu. Số tròn để nhẩm được trong đầu. */
export const SAMPLE_KG = 1_000;
export const SAMPLE_PRICE = 20_000;

export interface RulePreview {
  readonly totalKg: number;
  readonly pricePerUnit: number;
  readonly totalAmount: number;
  /** Số tiền cộng/trừ trên đơn mẫu. Dương = cộng thêm, âm = trừ bớt. */
  readonly amount: number;
  /** Quy tắc có kích hoạt với đơn mẫu này không (ngưỡng khối lượng, mặt hàng…). */
  readonly applies: boolean;
}

export const previewRule = (
  rule: PricingRule,
  totalKg: number = SAMPLE_KG,
  pricePerUnit: number = SAMPLE_PRICE,
): RulePreview => {
  const totalAmount = totalKg * pricePerUnit;

  const sampleLine: TransactionLine = {
    id: 'preview',
    productId: rule.productId,
    productName: '',
    unit: 'kg',
    formulaType: 'standard',
    grossWeight: totalKg,
    pricePerUnit,
  };

  // Xem trước cả khi quy tắc đang tắt: người dùng cần biết nó làm gì TRƯỚC khi bật.
  const [suggestion] = suggestAdjustments([{ ...rule, active: true }], {
    lines: [sampleLine],
    totalKg,
    totalAmount,
    isPickup: rule.appliesOnPickup ?? false,
  });

  return {
    totalKg,
    pricePerUnit,
    totalAmount,
    amount: suggestion?.amount ?? 0,
    applies: suggestion !== undefined,
  };
};
