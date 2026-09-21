import { describe, expect, it } from 'vitest';
import {
  dailySpend,
  debtsByBuyer,
  debtsBySupplier,
  purchases,
  revenueByCrop,
  sales,
  salesSummaryFor,
  spentByCrop,
  summaryFor,
  totalOutstandingDebt,
  totalReceivable,
} from '../src/selectors';
import { buyer, data, line, supplier, tx } from './fixtures';

const today = new Date().toISOString();

const purchase = (patch = {}) =>
  tx({ date: today, lines: [line({ grossWeight: 100, pricePerUnit: 10_000 })], ...patch });

const sale = (patch = {}) =>
  tx({
    date: today,
    kind: 'sale',
    counterpartyId: 'buy-1',
    supplierId: 'buy-1',
    supplierName: 'Nhà máy Bình Long',
    lines: [line({ grossWeight: 100, pricePerUnit: 30_000 })],
    ...patch,
  });

describe('purchases / sales — không bao giờ lẫn hai chiều', () => {
  const d = data({ transactions: [purchase({ id: 'p' }), sale({ id: 's' })] });

  it('mua chỉ ra phiếu mua', () => {
    expect(purchases(d).map((t) => t.id)).toEqual(['p']);
  });

  it('bán chỉ ra phiếu bán', () => {
    expect(sales(d).map((t) => t.id)).toEqual(['s']);
  });

  it('"chi mua hôm nay" không cộng nhầm tiền bán ra', () => {
    expect(summaryFor(d, 'today')).toEqual({ count: 1, weight: 100, spent: 1_000_000 });
  });

  it('"doanh thu hôm nay" không cộng nhầm tiền mua vào', () => {
    expect(salesSummaryFor(d, 'today')).toEqual({ count: 1, weight: 100, spent: 3_000_000 });
  });
});

describe('spentByCrop / revenueByCrop', () => {
  const d = data({
    transactions: [
      purchase({ id: 'p1', lines: [line({ productName: 'Điều', grossWeight: 100, pricePerUnit: 10_000 })] }),
      purchase({ id: 'p2', lines: [line({ productName: 'Cao su', grossWeight: 100, pricePerUnit: 20_000 })] }),
      sale({ id: 's1', lines: [line({ productName: 'Điều', grossWeight: 50, pricePerUnit: 40_000 })] }),
    ],
  });

  it('chi mua theo mặt hàng, nhiều tiền lên trước', () => {
    expect(spentByCrop(d, 'week').map((r) => [r.productName, r.spent])).toEqual([
      ['Cao su', 2_000_000],
      ['Điều', 1_000_000],
    ]);
  });

  it('doanh thu bán theo mặt hàng chỉ đếm phiếu bán', () => {
    expect(revenueByCrop(d, 'week')).toEqual([
      { productName: 'Điều', crop: undefined, spent: 2_000_000, weight: 50 },
    ]);
  });
});

describe('công nợ', () => {
  const d = data({
    suppliers: [supplier()],
    buyers: [buyer()],
    transactions: [
      purchase({ id: 'p1', amountPaid: 400_000 }),
      purchase({ id: 'p2', amountPaid: 1_000_000 }),
      sale({ id: 's1', amountPaid: 500_000 }),
    ],
  });

  it('tổng phải trả chỉ gồm phiếu mua còn nợ', () => {
    expect(totalOutstandingDebt(d)).toBe(600_000);
  });

  it('tổng phải thu chỉ gồm phiếu bán còn thiếu', () => {
    expect(totalReceivable(d)).toBe(2_500_000);
  });

  it('phiếu đã trả đủ không hiện trong danh sách nợ', () => {
    const rows = debtsBySupplier(d);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.transactions.map((t) => t.id)).toEqual(['p1']);
  });

  it('gom nợ theo ĐỐI TÁC, không theo trường supplierId cũ còn sót lại', () => {
    // Phiếu mua sau khi sửa người bán: counterpartyId là nguồn sự thật,
    // supplierId chỉ còn để đọc dữ liệu v1/v2.
    const stale = data({
      suppliers: [supplier()],
      transactions: [
        purchase({ id: 'p1', supplierId: 'sup-cu', counterpartyId: 'sup-1', amountPaid: 0 }),
        purchase({ id: 'p2', supplierId: 'sup-1', counterpartyId: 'sup-1', amountPaid: 0 }),
      ],
    });
    const rows = debtsBySupplier(stale);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.supplierId).toBe('sup-1');
    expect(rows[0]?.debt).toBe(2_000_000);
  });

  it('gom nợ phải thu theo người mua', () => {
    const rows = debtsByBuyer(d);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ buyerId: 'buy-1', buyerName: 'Nhà máy Bình Long', debt: 2_500_000 });
  });
});

describe('dailySpend', () => {
  it('trả về đủ số ngày yêu cầu, ngày hôm nay nằm cuối', () => {
    const points = dailySpend(data({ transactions: [purchase()] }), 7);
    expect(points).toHaveLength(7);
    expect(points.at(-1)?.spent).toBe(1_000_000);
  });

  it('ngày không có phiếu thì bằng 0, không bị khuyết', () => {
    const points = dailySpend(data(), 3);
    expect(points.map((p) => p.spent)).toEqual([0, 0, 0]);
  });
});
