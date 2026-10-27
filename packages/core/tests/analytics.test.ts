import { describe, expect, it } from 'vitest';
import { buildAnalytics, buildRubberReconcile } from '../src/analytics';
import { monthRange, previousRange } from '../src/taxPeriods';
import { data, line, tx } from './fixtures';

const august = monthRange(2026, 7);

describe('phân tích theo mặt hàng (V8)', () => {
  it('lời ước tính = lượng bán × (giá bán bình quân − giá mua bình quân), không phải tiền bán − tiền mua', () => {
    const report = buildAnalytics(
      data({
        transactions: [
          // Mua 1.000 kg tiêu: 600 kg giá 140.000 + 400 kg giá 145.000 ⇒ bình quân 142.000.
          tx({ id: 'm1', lines: [line({ productId: 'tieu', productName: 'Tiêu', grossWeight: 600, pricePerUnit: 140_000 })] }),
          tx({ id: 'm2', lines: [line({ productId: 'tieu', productName: 'Tiêu', grossWeight: 400, pricePerUnit: 145_000 })] }),
          // Mới bán 300 kg giá 150.000 ⇒ lời 300 × 8.000 = 2.400.000 (không phải lỗ 97 triệu).
          tx({ id: 'b1', kind: 'sale', lines: [line({ productId: 'tieu', productName: 'Tiêu', grossWeight: 300, pricePerUnit: 150_000 })] }),
          // Cà phê chỉ mua, chưa bán ⇒ chưa ước được lời.
          tx({ id: 'm3', lines: [line({ productId: 'cf', productName: 'Cà phê', grossWeight: 100, pricePerUnit: 100_000 })] }),
        ],
      }),
      august,
    );
    expect(report.products.map((p) => p.product)).toEqual(['Tiêu', 'Cà phê']);
    const [tieu, cafe] = report.products;
    expect(tieu).toMatchObject({ boughtQty: 1000, avgBuyPrice: 142_000, soldQty: 300, avgSellPrice: 150_000, profit: 2_400_000 });
    expect(cafe?.profit).toBeNull();
    expect(report.profit).toBe(2_400_000);
  });

  it('ngoài kỳ không tính; mặt hàng lỗ xếp dưới mặt hàng lời', () => {
    const report = buildAnalytics(
      data({
        transactions: [
          tx({ id: 'a', lines: [line({ productName: 'Điều', grossWeight: 100, pricePerUnit: 30_000 })] }),
          tx({ id: 'b', kind: 'sale', lines: [line({ productName: 'Điều', grossWeight: 100, pricePerUnit: 29_000 })] }),
          tx({ id: 'c', lines: [line({ productName: 'Tiêu', grossWeight: 10, pricePerUnit: 100_000 })] }),
          tx({ id: 'd', kind: 'sale', lines: [line({ productName: 'Tiêu', grossWeight: 10, pricePerUnit: 110_000 })] }),
          tx({ id: 'e', date: '2026-09-02T03:00:00.000Z', kind: 'sale', lines: [line({ productName: 'Tiêu', grossWeight: 10, pricePerUnit: 999_000 })] }),
        ],
      }),
      august,
    );
    expect(report.products.map((p) => [p.product, p.profit])).toEqual([
      ['Tiêu', 100_000],
      ['Điều', -100_000],
    ]);
  });

  it('kỳ trước: tháng 1 lùi về tháng 12 năm trước, quý 1 về quý 4', () => {
    expect(previousRange('month', new Date(2026, 0, 5)).label).toBe('Tháng 12/2025');
    expect(previousRange('quarter', new Date(2026, 1, 5)).label).toBe('Quý 4/2025');
    expect(previousRange('quarter', new Date(2026, 7, 5)).label).toBe('Quý 2/2026');
    expect(previousRange('year', new Date(2026, 7, 5)).label).toBe('Năm 2025');
  });
});

describe('đối chiếu độ mủ với nhà máy (V21)', () => {
  const latex = (patch: Parameters<typeof line>[0]) =>
    line({ productId: 'mu', productName: 'Mủ nước', formulaType: 'rubberLatex', ...patch });

  it('độ bình quân theo kg tươi; lệch độ ra tiền trên lượng đã bán', () => {
    const report = buildRubberReconcile(
      data({
        transactions: [
          // Hộ A 1.000 kg độ 30, hộ B 1.000 kg độ 32 ⇒ vựa đo bình quân 31.
          tx({ id: 'a', counterpartyId: 'A', supplierName: 'Hộ A', lines: [latex({ grossWeight: 1000, qualityPercent: 30, pricePerUnit: 400 * 100 })] }),
          tx({ id: 'b', counterpartyId: 'B', supplierName: 'Hộ B', lines: [latex({ grossWeight: 1000, qualityPercent: 32, pricePerUnit: 400 * 100 })] }),
          // Bán nhà máy 2.000 kg, nhà máy đo 30 ⇒ lệch 1 độ: 2.000 × 1% = 20 kg khô × 42.000 = 840.000.
          tx({ id: 's', kind: 'sale', lines: [latex({ grossWeight: 2000, qualityPercent: 30, pricePerUnit: 42_000 })] }),
        ],
      }),
      august,
    );
    const [mu] = report.products;
    expect(mu?.bought.avgPercent).toBe(31);
    expect(mu?.sold.avgPercent).toBe(30);
    expect(mu?.gapPercent).toBe(1);
    expect(mu?.gapAmount).toBe(840_000);
    expect(report.sellers.map((s) => [s.sellerName, s.avgPercent])).toEqual([
      ['Hộ A', 30],
      ['Hộ B', 32],
    ]);
  });

  it('chưa bán cho nhà máy thì chưa có lệch độ; mặt hàng không phải mủ bị bỏ qua', () => {
    const report = buildRubberReconcile(
      data({
        transactions: [
          tx({ lines: [latex({ grossWeight: 100, qualityPercent: 30 }), line({ productName: 'Tiêu' })] }),
        ],
      }),
      august,
    );
    expect(report.products).toHaveLength(1);
    expect(report.products[0]?.gapPercent).toBeNull();
    expect(report.products[0]?.gapAmount).toBeNull();
  });
});
