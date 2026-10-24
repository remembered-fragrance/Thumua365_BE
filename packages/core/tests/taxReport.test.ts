import { describe, expect, it } from 'vitest';
import { buildPurchaseLedger, buildTaxReport, isInRange, ledgerPaidBy, TAX_REPORT_DISCLAIMER } from '../src/taxReport';
import { data, line, tx } from './fixtures';

const range = {
  from: new Date('2026-08-01T00:00:00.000Z'),
  to: new Date('2026-08-31T23:59:59.999Z'),
  label: 'Tháng 8/2026',
};

const purchase1M = (patch = {}) =>
  tx({ lines: [line({ grossWeight: 100, pricePerUnit: 10_000 })], ...patch });

describe('isInRange — mốc đầu và cuối kỳ đều tính vào', () => {
  it('đúng thời điểm bắt đầu kỳ', () => {
    expect(isInRange('2026-08-01T00:00:00.000Z', range)).toBe(true);
  });

  it('đúng thời điểm kết thúc kỳ', () => {
    expect(isInRange('2026-08-31T23:59:59.999Z', range)).toBe(true);
  });

  it('trước kỳ một mili giây', () => {
    expect(isInRange('2026-07-31T23:59:59.999Z', range)).toBe(false);
  });

  it('sau kỳ một mili giây', () => {
    expect(isInRange('2026-09-01T00:00:00.000Z', range)).toBe(false);
  });
});

describe('buildTaxReport', () => {
  it('kỳ không có phiếu nào → mọi số bằng 0, vẫn kèm dòng lưu ý', () => {
    const report = buildTaxReport(data(), range);
    expect(report).toMatchObject({
      totalPurchase: 0,
      totalSale: 0,
      grossProfit: 0,
      purchaseCount: 0,
      saleCount: 0,
      disclaimer: TAX_REPORT_DISCLAIMER,
    });
  });

  it('kỳ có cả mua và bán: lời gộp = tiền bán trừ tiền mua', () => {
    const report = buildTaxReport(
      data({
        transactions: [
          purchase1M({ id: 'mua-1', date: '2026-08-05T02:00:00.000Z' }),
          purchase1M({ id: 'mua-2', date: '2026-08-06T02:00:00.000Z' }),
          tx({
            id: 'ban-1',
            date: '2026-08-20T02:00:00.000Z',
            kind: 'sale',
            counterpartyId: 'buy-1',
            lines: [line({ grossWeight: 100, pricePerUnit: 30_000 })],
          }),
        ],
      }),
      range,
    );

    expect(report.totalPurchase).toBe(2_000_000);
    expect(report.totalSale).toBe(3_000_000);
    expect(report.grossProfit).toBe(1_000_000);
    expect(report.purchaseCount).toBe(2);
    expect(report.saleCount).toBe(1);
  });

  it('phiếu ngoài kỳ không được lọt vào báo cáo', () => {
    const report = buildTaxReport(
      data({
        transactions: [
          purchase1M({ id: 'trong-ky', date: '2026-08-15T02:00:00.000Z' }),
          purchase1M({ id: 'thang-truoc', date: '2026-07-15T02:00:00.000Z' }),
          purchase1M({ id: 'thang-sau', date: '2026-09-15T02:00:00.000Z' }),
        ],
      }),
      range,
    );
    expect(report.purchaseCount).toBe(1);
    expect(report.totalPurchase).toBe(1_000_000);
  });

  it('phiếu ngay mốc đầu và mốc cuối kỳ đều được tính', () => {
    const report = buildTaxReport(
      data({
        transactions: [
          purchase1M({ id: 'dau-ky', date: range.from.toISOString() }),
          purchase1M({ id: 'cuoi-ky', date: range.to.toISOString() }),
        ],
      }),
      range,
    );
    expect(report.purchaseCount).toBe(2);
  });
});

describe('bảng kê thu mua dạng 02/TNDN (V12)', () => {
  const pay = (amount: number, method?: 'cash' | 'transfer') => ({ id: `p${amount}${method ?? ''}`, date: '2026-08-05T02:00:00.000Z', amount, ...(method ? { method } : {}) });

  it('mỗi dòng hàng một dòng, phiếu cũ trước; bỏ phiếu bán và phiếu ngoài kỳ; khoản cộng / trừ thành một dòng riêng', () => {
    const rows = buildPurchaseLedger(
      data({
        transactions: [
          tx({
            id: 'b',
            date: '2026-08-09T02:00:00.000Z',
            supplierName: 'Chú Tư',
            lines: [line({ productName: 'Cà phê', grossWeight: 100, pricePerUnit: 10_000 }), line({ id: 'l2', productName: 'Tiêu', grossWeight: 10, pricePerUnit: 100_000 })],
            adjustments: [{ id: 'a', kind: 'logistics', label: 'Phí xe', amount: -50_000 }],
            payments: [pay(1_000_000, 'transfer'), pay(900_000)],
            amountPaid: 1_900_000,
          }),
          purchase1M({ id: 'a', date: '2026-08-02T02:00:00.000Z', supplierName: 'Cô Năm' }),
          purchase1M({ id: 'ban', kind: 'sale', date: '2026-08-03T02:00:00.000Z' }),
          purchase1M({ id: 'cu', date: '2026-07-30T02:00:00.000Z' }),
        ],
      }),
      range,
    );
    expect(rows.map((r) => [r.transactionId, r.sellerName, r.product, r.quantity, r.unitPrice, r.amount, r.paidBy])).toEqual([
      ['a', 'Cô Năm', expect.any(String), 100, 10_000, 1_000_000, 'unpaid'],
      ['b', 'Chú Tư', 'Cà phê', 100, 10_000, 1_000_000, 'mixed'],
      ['b', 'Chú Tư', 'Tiêu', 10, 100_000, 1_000_000, 'mixed'],
      ['b', 'Chú Tư', null, null, null, -50_000, 'mixed'],
    ]);
  });

  it('hình thức trả: lần trả không ghi hình thức (app cũ) là tiền mặt', () => {
    expect(ledgerPaidBy({ payments: [pay(1)] })).toBe('cash');
    expect(ledgerPaidBy({ payments: [pay(1, 'transfer')] })).toBe('transfer');
    expect(ledgerPaidBy({ payments: [] })).toBe('unpaid');
  });

  it('câu tự chịu trách nhiệm theo §4.2', () => {
    expect(TAX_REPORT_DISCLAIMER).toBe('Số liệu tổng hợp từ sổ của bạn. Bạn tự kiểm tra và chịu trách nhiệm khi dùng để kê khai thuế.');
  });
});
