import { describe, expect, it } from 'vitest';
import { inventoryByProduct } from '../src/inventory';
import { data, line, tx } from './fixtures';

describe('inventoryByProduct — tồn kho đếm hàng THẬT trong kho', () => {
  it('cao su hàm lượng 30%: kho tăng 320kg (vật lý), KHÔNG phải 96kg (quy khô)', () => {
    // Đây là bất biến dễ vỡ nhất của cả app: dùng nhầm khối lượng tính tiền
    // cho tồn kho thì mua 1 tấn mủ tươi chỉ thấy 300kg trong kho.
    const rows = inventoryByProduct(
      data({
        transactions: [
          tx({
            lines: [
              line({
                productName: 'Cao su',
                formulaType: 'rubberLatex',
                grossWeight: 320,
                qualityPercent: 30,
                pricePerUnit: 14_500,
              }),
            ],
          }),
        ],
      }),
    );

    expect(rows).toEqual([
      { productName: 'Cao su', purchasedKg: 320, soldKg: 0, stockKg: 320 },
    ]);
  });

  it('mua 320 bán 120 → còn 200', () => {
    const rows = inventoryByProduct(
      data({
        transactions: [
          tx({ id: 'mua', lines: [line({ productName: 'Điều', grossWeight: 320 })] }),
          tx({
            id: 'ban',
            kind: 'sale',
            counterpartyId: 'buy-1',
            lines: [line({ productName: 'Điều', grossWeight: 120 })],
          }),
        ],
      }),
    );

    expect(rows).toEqual([
      { productName: 'Điều', purchasedKg: 320, soldKg: 120, stockKg: 200 },
    ]);
  });

  it('bán nhiều hơn mua → tồn âm, hiện đúng để chủ vựa biết sổ lệch', () => {
    const rows = inventoryByProduct(
      data({
        transactions: [
          tx({
            kind: 'sale',
            counterpartyId: 'buy-1',
            lines: [line({ productName: 'Cà phê', grossWeight: 50 })],
          }),
        ],
      }),
    );
    expect(rows[0]?.stockKg).toBe(-50);
  });

  it('sắp xếp mặt hàng tồn nhiều lên trước', () => {
    const rows = inventoryByProduct(
      data({
        transactions: [
          tx({ id: 't1', lines: [line({ productName: 'Điều', grossWeight: 10 })] }),
          tx({ id: 't2', lines: [line({ productName: 'Cao su', grossWeight: 900 })] }),
        ],
      }),
    );
    expect(rows.map((r) => r.productName)).toEqual(['Cao su', 'Điều']);
  });

  it('sổ trống → không có dòng nào', () => {
    expect(inventoryByProduct(data())).toEqual([]);
  });
});
