import { describe, expect, it } from 'vitest';
import { inventoryValues } from '../src/inventory';
import { data, line, tx } from './fixtures';

describe('inventoryValues', () => {
  it('giá vốn chia cho khối lượng VẬT LÝ, không phải khối lượng tính tiền', () => {
    // Cao su 100kg × 50% hàm lượng × 20.000đ = 1.000.000đ cho 100kg hàng thật.
    const book = data({
      transactions: [
        tx({
          lines: [
            line({ formulaType: 'rubberLatex', grossWeight: 100, qualityPercent: 50, pricePerUnit: 20_000 }),
          ],
        }),
      ],
    });

    const [row] = inventoryValues(book);
    expect(row?.purchasedKg).toBe(100);
    // Chia cho 50kg quy đổi sẽ ra 20.000 — sai gấp đôi.
    expect(row?.avgCostPerKg).toBe(10_000);
    expect(row?.stockValue).toBe(1_000_000);
  });

  it('bán bớt thì tồn và giá trị tồn giảm theo, giá vốn giữ nguyên', () => {
    const book = data({
      transactions: [
        tx({ id: 'mua', lines: [line({ grossWeight: 100, pricePerUnit: 10_000 })] }),
        tx({
          id: 'ban',
          kind: 'sale',
          counterpartyId: 'buy-1',
          lines: [line({ grossWeight: 40, pricePerUnit: 12_000 })],
        }),
      ],
    });

    const [row] = inventoryValues(book);
    expect(row?.stockKg).toBe(60);
    expect(row?.avgCostPerKg).toBe(10_000);
    expect(row?.stockValue).toBe(600_000);
  });

  it('tồn âm không quy ra tiền — đó là dấu hiệu nhập sai, không phải tài sản âm', () => {
    const book = data({
      transactions: [
        tx({ id: 'mua', lines: [line({ grossWeight: 10, pricePerUnit: 10_000 })] }),
        tx({
          id: 'ban',
          kind: 'sale',
          counterpartyId: 'buy-1',
          lines: [line({ grossWeight: 30, pricePerUnit: 12_000 })],
        }),
      ],
    });

    const [row] = inventoryValues(book);
    expect(row?.stockKg).toBe(-20);
    expect(row?.stockValue).toBe(0);
  });

  it('mặt hàng chỉ có phiếu bán thì không có giá vốn', () => {
    const book = data({
      transactions: [
        tx({ kind: 'sale', counterpartyId: 'buy-1', lines: [line({ grossWeight: 5 })] }),
      ],
    });

    const [row] = inventoryValues(book);
    expect(row?.avgCostPerKg).toBe(0);
    expect(row?.stockValue).toBe(0);
  });
});
