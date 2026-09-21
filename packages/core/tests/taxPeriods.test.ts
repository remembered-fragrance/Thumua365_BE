import { describe, expect, it } from 'vitest';
import { buildTaxReport, isInRange } from '../src/taxReport';
import { currentRange, monthRange, monthsOfYear, quarterRange, yearRange } from '../src/taxPeriods';
import { data, line, tx } from './fixtures';

describe('taxPeriods', () => {
  it('kỳ tháng ôm trọn ngày cuối tháng', () => {
    const range = monthRange(2026, 7); // tháng 8
    expect(range.label).toBe('Tháng 8/2026');
    // Mốc tính theo GIỜ MÁY: chủ vựa chốt sổ lúc 23h ngày 31 là còn trong tháng.
    expect(isInRange(new Date(2026, 7, 31, 23, 0).toISOString(), range)).toBe(true);
    expect(isInRange(new Date(2026, 8, 1, 0, 30).toISOString(), range)).toBe(false);
  });

  it('kỳ quý gồm đúng ba tháng', () => {
    const q3 = quarterRange(2026, 2);
    expect(q3.label).toBe('Quý 3/2026');
    expect(q3.from.getMonth()).toBe(6);
    expect(q3.to.getMonth()).toBe(8);
  });

  it('kỳ năm từ 1/1 đến hết 31/12', () => {
    const year = yearRange(2026);
    expect(year.from.getMonth()).toBe(0);
    expect(year.to.getMonth()).toBe(11);
    expect(year.to.getDate()).toBe(31);
  });

  it('mười hai tháng, không thiếu tháng nào', () => {
    const months = monthsOfYear(2026);
    expect(months).toHaveLength(12);
    expect(months[11]?.label).toBe('Tháng 12/2026');
  });

  it('kỳ đang diễn ra tính theo hôm nay', () => {
    const now = new Date(2026, 7, 10);
    expect(currentRange('month', now).label).toBe('Tháng 8/2026');
    expect(currentRange('quarter', now).label).toBe('Quý 3/2026');
    expect(currentRange('year', now).label).toBe('Năm 2026');
  });

  it('ghép với buildTaxReport thì chỉ gộp phiếu trong kỳ', () => {
    const book = data({
      transactions: [
        tx({ id: 'trong-ky', date: new Date(2026, 7, 5).toISOString(), lines: [line()] }),
        tx({ id: 'ngoai-ky', date: new Date(2026, 6, 5).toISOString(), lines: [line()] }),
      ],
    });

    const report = buildTaxReport(book, monthRange(2026, 7));
    expect(report.purchaseCount).toBe(1);
    expect(report.totalPurchase).toBe(1_000_000);
  });
});
