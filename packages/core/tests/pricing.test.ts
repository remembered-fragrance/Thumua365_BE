import { describe, expect, it } from 'vitest';
import { suggestAdjustments, type PricingContext } from '../src/pricing';
import type { PricingRule } from '../src/types';
import { line } from './fixtures';

const rule = (patch: Partial<PricingRule> = {}): PricingRule => ({
  id: 'r1',
  name: 'Phí xe đến lấy',
  kind: 'logistics',
  active: true,
  fixedAmount: -50_000,
  ...patch,
});

const ctx = (patch: Partial<PricingContext> = {}): PricingContext => ({
  lines: [line()],
  totalKg: 1_000,
  totalAmount: 10_000_000,
  ...patch,
});

describe('suggestAdjustments — quy tắc bật/tắt', () => {
  it('quy tắc đang tắt thì không sinh khoản nào', () => {
    expect(suggestAdjustments([rule({ active: false })], ctx())).toEqual([]);
  });

  it('quy tắc đang bật sinh đúng một khoản, giữ liên kết về quy tắc gốc', () => {
    expect(suggestAdjustments([rule()], ctx())).toEqual([
      { id: 'rule-r1', kind: 'logistics', label: 'Phí xe đến lấy', amount: -50_000, ruleId: 'r1' },
    ]);
  });

  it('quy tắc ra số 0 thì bỏ qua, không rác trên phiếu', () => {
    expect(suggestAdjustments([rule({ fixedAmount: 0 })], ctx())).toEqual([]);
  });
});

describe('suggestAdjustments — ngưỡng khối lượng', () => {
  it('đúng bằng ngưỡng thì ÁP DỤNG', () => {
    const r = rule({ minWeightKg: 1_000, kind: 'volumeDiscount', fixedAmount: -100_000 });
    expect(suggestAdjustments([r], ctx({ totalKg: 1_000 }))).toHaveLength(1);
  });

  it('thiếu 1kg so với ngưỡng thì KHÔNG áp dụng', () => {
    const r = rule({ minWeightKg: 1_000 });
    expect(suggestAdjustments([r], ctx({ totalKg: 999 }))).toEqual([]);
  });
});

describe('suggestAdjustments — xe đến lấy hay tự mang tới', () => {
  it('quy tắc chỉ cho xe đến lấy: có xe thì áp', () => {
    expect(suggestAdjustments([rule({ appliesOnPickup: true })], ctx({ isPickup: true }))).toHaveLength(1);
  });

  it('quy tắc chỉ cho xe đến lấy: tự mang tới thì bỏ qua', () => {
    expect(suggestAdjustments([rule({ appliesOnPickup: true })], ctx({ isPickup: false }))).toEqual([]);
  });

  it('quy tắc chỉ cho tự mang tới: không nêu cách giao thì coi như tự mang', () => {
    expect(suggestAdjustments([rule({ appliesOnPickup: false })], ctx())).toHaveLength(1);
  });

  it('appliesOnPickup = null nghĩa là áp cho cả hai kiểu giao', () => {
    expect(suggestAdjustments([rule({ appliesOnPickup: null })], ctx({ isPickup: true }))).toHaveLength(1);
    expect(suggestAdjustments([rule({ appliesOnPickup: null })], ctx({ isPickup: false }))).toHaveLength(1);
  });
});

describe('suggestAdjustments — theo mặt hàng', () => {
  it('phiếu không có mặt hàng của quy tắc thì bỏ qua', () => {
    const r = rule({ productId: 'prod-rubber' });
    expect(suggestAdjustments([r], ctx({ lines: [line({ productId: 'prod-cashew' })] }))).toEqual([]);
  });

  it('phiếu có mặt hàng của quy tắc thì áp', () => {
    const r = rule({ productId: 'prod-rubber' });
    expect(suggestAdjustments([r], ctx({ lines: [line({ productId: 'prod-rubber' })] }))).toHaveLength(1);
  });
});

describe('suggestAdjustments — phần trăm của tổng phiếu', () => {
  it('2% của 10.000.000 = 200.000', () => {
    const r = rule({ kind: 'manual', fixedAmount: undefined, percentOfTotal: 2 });
    expect(suggestAdjustments([r], ctx())[0]?.amount).toBe(200_000);
  });

  it('phần trăm ra số lẻ được làm tròn về đồng', () => {
    const r = rule({ kind: 'manual', fixedAmount: undefined, percentOfTotal: 1.5 });
    expect(suggestAdjustments([r], ctx({ totalAmount: 333_333 }))[0]?.amount).toBe(5_000);
  });

  it('cộng cả số cố định lẫn phần trăm trong cùng một quy tắc', () => {
    const r = rule({ kind: 'manual', fixedAmount: 10_000, percentOfTotal: 1 });
    expect(suggestAdjustments([r], ctx({ totalAmount: 1_000_000 }))[0]?.amount).toBe(20_000);
  });
});
