import { describe, expect, it } from 'vitest';
import { quotaFor, receiptsThisMonth } from '../src/receiptQuota';
import { data, tx } from './fixtures';

const NOW = new Date('2026-08-10T10:00:00.000Z');
const LIMIT = 30;

const inMonth = (count: number, day = 5) =>
  Array.from({ length: count }, (_, i) =>
    tx({ id: `tx-${i}`, date: `2026-08-${String(day).padStart(2, '0')}T03:00:00.000Z` }),
  );

describe('receiptsThisMonth', () => {
  it('chỉ đếm phiếu trong tháng dương lịch hiện tại', () => {
    const rows = [...inMonth(3), tx({ id: 'cu', date: '2026-07-31T03:00:00.000Z' })];
    expect(receiptsThisMonth(rows, NOW)).toBe(3);
  });

  it('ngày hỏng không làm vỡ phép đếm', () => {
    expect(receiptsThisMonth([tx({ date: 'không phải ngày' })], NOW)).toBe(0);
  });
});

describe('quotaFor', () => {
  it('gói trả phí thì không giới hạn', () => {
    const state = quotaFor(data({ transactions: inMonth(99) }), NOW, { premium: true, limit: LIMIT });
    expect(state.blocked).toBe(false);
    expect(state.limit).toBe(Infinity);
  });

  it('phiếu thứ 30 vẫn ghi được', () => {
    const state = quotaFor(data({ transactions: inMonth(29) }), NOW, {
      premium: false,
      limit: LIMIT,
    });
    expect(state.blocked).toBe(false);
    expect(state.remaining).toBe(1);
  });

  it('chặn đúng ở phiếu thứ 31', () => {
    const state = quotaFor(data({ transactions: inMonth(30) }), NOW, {
      premium: false,
      limit: LIMIT,
    });
    expect(state.blocked).toBe(true);
    expect(state.remaining).toBe(0);
  });

  it('phiếu tháng trước không tính vào hạn mức tháng này', () => {
    const old = Array.from({ length: 40 }, (_, i) =>
      tx({ id: `cu-${i}`, date: '2026-07-15T03:00:00.000Z' }),
    );
    const state = quotaFor(data({ transactions: old }), NOW, { premium: false, limit: LIMIT });
    expect(state.used).toBe(0);
    expect(state.blocked).toBe(false);
  });
});
