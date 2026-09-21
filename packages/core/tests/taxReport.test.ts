import { describe, expect, it } from 'vitest';
import { buildTaxReport, isInRange, TAX_REPORT_DISCLAIMER } from '../src/taxReport';
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
