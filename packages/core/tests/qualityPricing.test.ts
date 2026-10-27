/**
 * V19 / V20 — giá theo chỉ tiêu chất lượng, mủ nước + mủ tạp trên cùng phiếu.
 *
 * Số mốc ở đây là SỐ MINH HOẠ (KE_HOACH_GOI_PRO §4.4: tiêu 500 g/l, ẩm 13,5%; mủ nước bậc TSC ≥ 30), chưa phải
 * bảng mốc của vựa thật — khi có bảng thật thì thay số, giữ nguyên cách tính.
 */

import { describe, expect, it } from 'vitest';
import { lineTotals, transactionTotals } from '../src/calc';
import { normalizeLine } from '../src/normalizeTransaction';
import { qualityStepOf, suggestAdjustments } from '../src/pricing';
import type { PricingRule, TransactionLine } from '../src/types';
import { line, tx } from './fixtures';

const qualityRule = (patch: Partial<PricingRule>): PricingRule => ({
  id: 'q1',
  name: 'Theo chất lượng',
  kind: 'manual',
  active: true,
  ...patch,
});

const adjustFor = (rules: readonly PricingRule[], lines: readonly TransactionLine[]) =>
  suggestAdjustments(rules, { lines, totalKg: 0, totalAmount: 0 });

describe('qualityStepOf — mốc nào đang áp', () => {
  const steps = [
    { from: 500, amountPerUnit: 0 },
    { from: 480, amountPerUnit: -1_500 },
    { from: 520, amountPerUnit: 1_500 },
  ];

  it('dưới mốc đầu tiên thì không có mốc nào', () => {
    expect(qualityStepOf(steps, 479)).toBeUndefined();
  });

  it('đúng bằng mốc thì lấy mốc đó (TỪ mốc trở lên)', () => {
    expect(qualityStepOf(steps, 520)?.amountPerUnit).toBe(1_500);
    expect(qualityStepOf(steps, 480)?.amountPerUnit).toBe(-1_500);
  });

  it('giữa hai mốc thì lấy mốc dưới — bảng nhập lộn thứ tự vẫn đúng', () => {
    expect(qualityStepOf(steps, 519.9)?.amountPerUnit).toBe(0);
    expect(qualityStepOf(steps, 700)?.amountPerUnit).toBe(1_500);
  });
});

describe('suggestAdjustments — quy tắc theo chỉ tiêu', () => {
  const density = qualityRule({
    name: 'Dung trọng',
    qualityMetric: 'bulkDensity',
    qualitySteps: [{ from: 520, amountPerUnit: 1_000 }],
  });

  it('nhân mốc với lượng tính tiền của dòng (kg sau trừ bì)', () => {
    const l = line({ formulaType: 'netAfterTare', grossWeight: 110, tareWeight: 10, bulkDensity: 530 });
    expect(adjustFor([density], [l])).toEqual([
      { id: 'rule-q1', kind: 'manual', label: 'Dung trọng', amount: 100_000, ruleId: 'q1' },
    ]);
  });

  it('dòng không nhập chỉ tiêu thì không bị cộng / trừ', () => {
    expect(adjustFor([density], [line({ grossWeight: 100 })])).toEqual([]);
  });

  it('bỏ qua số tiền cố định và % của quy tắc thường', () => {
    const rule = { ...density, fixedAmount: -50_000, percentOfTotal: 10 };
    expect(adjustFor([rule], [line({ grossWeight: 100, bulkDensity: 530 })])[0]?.amount).toBe(100_000);
  });

  it('quy tắc của một mặt hàng không đụng dòng mặt hàng khác', () => {
    const rule = { ...density, productId: 'tieu' };
    const lines = [
      line({ id: 'a', productId: 'tieu', grossWeight: 100, bulkDensity: 530 }),
      line({ id: 'b', productId: 'ca-phe', grossWeight: 900, bulkDensity: 530 }),
    ];
    expect(adjustFor([rule], lines)[0]?.amount).toBe(100_000);
  });

  it('quy tắc đang tắt thì không áp', () => {
    expect(adjustFor([{ ...density, active: false }], [line({ bulkDensity: 530 })])).toEqual([]);
  });
});

describe('nghiệm thu §8 — tiêu 520 g/l, ẩm 14%', () => {
  const tieu = line({
    productId: 'tieu',
    productName: 'Tiêu',
    formulaType: 'netAfterTare',
    grossWeight: 1_010,
    tareWeight: 10,
    pricePerUnit: 150_000,
    bulkDensity: 520,
    moisturePercent: 14,
  });
  const rules = [
    qualityRule({
      id: 'dung-trong',
      name: 'Dung trọng',
      productId: 'tieu',
      qualityMetric: 'bulkDensity',
      qualitySteps: [
        { from: 0, amountPerUnit: -3_000 },
        { from: 480, amountPerUnit: -1_500 },
        { from: 500, amountPerUnit: 0 },
        { from: 520, amountPerUnit: 1_500 },
      ],
    }),
    qualityRule({
      id: 'do-am',
      name: 'Độ ẩm',
      productId: 'tieu',
      qualityMetric: 'moisturePercent',
      qualitySteps: [
        { from: 13.6, amountPerUnit: -1_000 },
        { from: 14, amountPerUnit: -2_000 },
        { from: 15, amountPerUnit: -4_000 },
      ],
    }),
  ];

  it('1.000 kg × 150.000 đ, +1.500 đ/kg dung trọng, −2.000 đ/kg độ ẩm = 149.500.000 đ', () => {
    const adjustments = adjustFor(rules, [tieu]);
    expect(adjustments.map((a) => [a.label, a.amount])).toEqual([
      ['Dung trọng', 1_500_000],
      ['Độ ẩm', -2_000_000],
    ]);
    expect(transactionTotals(tx({ lines: [tieu], adjustments })).total).toBe(149_500_000);
  });

  it('ẩm đúng 13,5% (mức tối đa) thì không bị trừ', () => {
    expect(adjustFor(rules, [{ ...tieu, moisturePercent: 13.5 }]).map((a) => a.label)).toEqual(['Dung trọng']);
  });
});

describe('nghiệm thu §8 — mủ nước 28 độ + mủ chén DRC 55% trên một phiếu', () => {
  const muNuoc = line({
    id: 'mu-nuoc',
    productId: 'mu-nuoc',
    productName: 'Mủ nước',
    formulaType: 'rubberLatex',
    rubberKind: 'latex',
    grossWeight: 1_000,
    qualityPercent: 28,
    // 420 đ/độ TSC/kg mủ nước = 42.000 đ/kg quy khô.
    pricePerUnit: 42_000,
  });
  const muChen = line({
    id: 'mu-chen',
    productId: 'mu-chen',
    productName: 'Mủ chén',
    formulaType: 'rubberLatex',
    rubberKind: 'cuplump',
    grossWeight: 500,
    qualityPercent: 55,
    pricePerUnit: 30_000,
  });
  const bacTsc = qualityRule({
    id: 'bac-tsc',
    name: 'Bậc độ TSC',
    productId: 'mu-nuoc',
    qualityMetric: 'qualityPercent',
    // Từ 30 độ: giá gốc; 25–30 độ: 400 đ/độ (−2.000 đ/kg khô); dưới 25: 380 đ/độ.
    qualitySteps: [
      { from: 0, amountPerUnit: -4_000 },
      { from: 25, amountPerUnit: -2_000 },
      { from: 30, amountPerUnit: 0 },
    ],
  });

  it('mỗi loại một giá, theo độ của nó: 11.760.000 + 8.250.000 đ', () => {
    expect(lineTotals(muNuoc)).toEqual({ netWeight: 280, rawTotal: 11_760_000, total: 11_760_000 });
    expect(lineTotals(muChen)).toEqual({ netWeight: 275, rawTotal: 8_250_000, total: 8_250_000 });
  });

  it('bậc độ chỉ áp lên mủ nước: 280 kg khô × −2.000 đ; cả phiếu 19.450.000 đ', () => {
    const adjustments = adjustFor([bacTsc], [muNuoc, muChen]);
    expect(adjustments.map((a) => a.amount)).toEqual([-560_000]);
    expect(transactionTotals(tx({ lines: [muNuoc, muChen], adjustments })).total).toBe(19_450_000);
  });
});

describe('sổ cao su cũ tính như trước', () => {
  // Ví dụ gốc trong fixtures: 320 kg, hàm lượng 31%, 14.500 đ/kg → 99,2 kg khô → 1.438.400 → 1.438.000 đ.
  const raw = {
    id: 'cu',
    productName: 'Cao su',
    unit: 'kg',
    formulaType: 'rubberLatex',
    grossWeight: 320,
    qualityPercent: 31,
    pricePerUnit: 14_500,
  };

  it('dòng cũ (không có loại mủ, không có chỉ tiêu) đọc lên ra đúng số cũ', () => {
    const l = normalizeLine(raw);
    expect(l.rubberKind).toBeUndefined();
    expect(l.bulkDensity).toBeUndefined();
    expect([l.rawTotal, l.roundedTotal]).toEqual([1_438_400, 1_438_000]);
  });

  it('mủ tạp (DRC) cùng phép tính: đổi nhãn không đổi tiền', () => {
    expect(lineTotals(normalizeLine({ ...raw, rubberKind: 'cuplump' }))).toEqual(lineTotals(normalizeLine(raw)));
  });

  it('loại mủ lạ thì bỏ, không làm hỏng dòng', () => {
    expect(normalizeLine({ ...raw, rubberKind: 'muDong' }).rubberKind).toBeUndefined();
  });

  it('quy tắc giá cũ (không có chỉ tiêu) không đổi cách tính', () => {
    const old: PricingRule = { id: 'xe', name: 'Phí xe', kind: 'logistics', active: true, fixedAmount: -50_000 };
    expect(adjustFor([old], [normalizeLine(raw)])[0]?.amount).toBe(-50_000);
  });
});
