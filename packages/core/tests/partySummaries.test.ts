import { describe, expect, it } from 'vitest';
import { supplierSummaries } from '../src/supplierSelectors';
import { buyerSummaries } from '../src/buyerSelectors';
import { receiptShareText } from '../src/receiptText';
import { buyer, data, line, supplier, tx } from './fixtures';

const purchase = (patch = {}) =>
  tx({ lines: [line({ grossWeight: 100, pricePerUnit: 10_000 })], ...patch });

describe('supplierSummaries — thống kê người bán', () => {
  const d = data({
    suppliers: [supplier(), supplier({ id: 'sup-2', name: 'Chú Bảy' })],
    transactions: [
      purchase({ id: 'p1', date: '2026-08-01T02:00:00.000Z', amountPaid: 400_000 }),
      purchase({ id: 'p2', date: '2026-08-05T02:00:00.000Z', amountPaid: 1_000_000 }),
      tx({
        id: 's1',
        kind: 'sale',
        counterpartyId: 'buy-1',
        supplierId: 'buy-1',
        lines: [line({ grossWeight: 100, pricePerUnit: 30_000 })],
      }),
    ],
  });

  it('người bán chưa giao dịch lần nào vẫn có mặt với số 0', () => {
    expect(d.suppliers).toHaveLength(2);
    expect(supplierSummaries(d).find((s) => s.id === 'sup-2')).toMatchObject({
      txCount: 0,
      totalSpent: 0,
      debt: 0,
    });
  });

  it('cộng dồn số phiếu, tiền và nợ — KHÔNG tính phiếu bán vào', () => {
    expect(supplierSummaries(d).find((s) => s.id === 'sup-1')).toMatchObject({
      txCount: 2,
      totalSpent: 2_000_000,
      totalWeight: 200,
      debt: 600_000,
      lastDate: '2026-08-05T02:00:00.000Z',
    });
  });
});

describe('buyerSummaries — thống kê người mua', () => {
  const d = data({
    buyers: [buyer()],
    transactions: [
      purchase({ id: 'p1' }),
      tx({
        id: 's1',
        kind: 'sale',
        counterpartyId: 'buy-1',
        supplierId: 'buy-1',
        supplierName: 'Nhà máy Bình Long',
        date: '2026-08-09T02:00:00.000Z',
        lines: [line({ grossWeight: 100, pricePerUnit: 30_000 })],
        amountPaid: 500_000,
      }),
    ],
  });

  it('chỉ tính phiếu bán, ra doanh thu và tiền còn phải thu', () => {
    expect(buyerSummaries(d)).toEqual([
      {
        id: 'buy-1',
        name: 'Nhà máy Bình Long',
        phone: undefined,
        location: undefined,
        txCount: 1,
        totalRevenue: 3_000_000,
        totalWeight: 100,
        debt: 2_500_000,
        lastDate: '2026-08-09T02:00:00.000Z',
      },
    ]);
  });
});

describe('receiptShareText — nội dung gửi Zalo', () => {
  const text = receiptShareText(
    tx({
      lines: [
        line({
          productName: 'Cao su',
          formulaType: 'rubberLatex',
          grossWeight: 320,
          qualityPercent: 31,
          pricePerUnit: 14_500,
        }),
      ],
      amountPaid: 1_000_000,
    }),
  );

  it('nêu rõ là phiếu mua và tên người bán', () => {
    expect(text).toContain('PHIẾU THU MUA');
    expect(text).toContain('Cô Lê Thị Mai');
  });

  it('có hàm lượng mủ, thành tiền và số còn nợ', () => {
    expect(text).toContain('hàm lượng 31%');
    expect(text).toContain('1.438.000₫');
    expect(text).toContain('Còn nợ: 438.000₫');
  });

  it('phiếu bán đổi cách xưng hô', () => {
    const saleText = receiptShareText(tx({ kind: 'sale', counterpartyId: 'buy-1' }));
    expect(saleText).toContain('PHIẾU BÁN HÀNG');
    expect(saleText).toContain('Người mua');
  });

  it('trả đủ thì không hiện dòng còn nợ', () => {
    const paid = receiptShareText(
      tx({ lines: [line({ grossWeight: 100, pricePerUnit: 10_000 })], amountPaid: 1_000_000 }),
    );
    expect(paid).not.toContain('Còn nợ');
  });
});
