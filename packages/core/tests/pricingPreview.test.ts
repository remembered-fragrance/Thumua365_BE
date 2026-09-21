import { describe, expect, it } from 'vitest';
import { previewRule, SAMPLE_KG, SAMPLE_PRICE } from '../src/pricingPreview';
import type { PricingRule } from '../src/types';

const rule = (patch: Partial<PricingRule> = {}): PricingRule => ({
  id: 'rule-1',
  name: 'Phí xe đến lấy',
  kind: 'logistics',
  active: true,
  ...patch,
});

describe('previewRule', () => {
  it('đơn mẫu là 1 tấn × 20.000đ = 20 triệu', () => {
    const preview = previewRule(rule({ fixedAmount: -50_000 }));
    expect(preview.totalKg).toBe(SAMPLE_KG);
    expect(preview.pricePerUnit).toBe(SAMPLE_PRICE);
    expect(preview.totalAmount).toBe(20_000_000);
    expect(preview.amount).toBe(-50_000);
  });

  it('phần trăm tính trên tổng đơn mẫu', () => {
    expect(previewRule(rule({ percentOfTotal: -1 })).amount).toBe(-200_000);
  });

  it('xem trước được cả khi quy tắc đang TẮT — cần biết trước khi bật', () => {
    const preview = previewRule(rule({ fixedAmount: 30_000, active: false }));
    expect(preview.applies).toBe(true);
    expect(preview.amount).toBe(30_000);
  });

  it('chưa đạt ngưỡng khối lượng thì báo không kích hoạt', () => {
    const preview = previewRule(rule({ fixedAmount: -50_000, minWeightKg: 5_000 }));
    expect(preview.applies).toBe(false);
    expect(preview.amount).toBe(0);
  });

  it('quy tắc của mặt hàng khác vẫn xem trước được trên đơn mẫu của chính nó', () => {
    const preview = previewRule(rule({ productId: 'prod-cashew', fixedAmount: -10_000 }));
    expect(preview.amount).toBe(-10_000);
  });

  it('đổi đơn mẫu thì số tiền phần trăm đổi theo', () => {
    expect(previewRule(rule({ percentOfTotal: 10 }), 100, 10_000).amount).toBe(100_000);
  });
});
