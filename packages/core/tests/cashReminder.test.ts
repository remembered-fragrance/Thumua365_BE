import { describe, expect, it } from 'vitest';
import { cashPaidOnDay, needsCashReminder } from '../src/cashReminder';
import { normalizeTransaction } from '../src/normalizeTransaction';
import { recordPayment } from '../src/receiptActions';
import { data, line, tx } from './fixtures';

const today = new Date(2026, 9, 24, 15, 0);
const at = (hour: number, dayOffset = 0) => new Date(2026, 9, 24 + dayOffset, hour, 0).toISOString();
const pay = (amount: number, date: string, method?: 'cash' | 'transfer') => ({ id: `p-${amount}-${date}`, date, amount, ...(method ? { method } : {}) });

describe('nhắc tiền mặt từ 5 triệu đồng/ngày cho một người (V13)', () => {
  const book = data({
    transactions: [
      tx({ id: 'a', payments: [pay(3_000_000, at(8)), pay(9_000_000, at(9), 'transfer')] }),
      tx({ id: 'b', payments: [pay(1_500_000, at(10), 'cash'), pay(7_000_000, at(10, -1))] }),
      tx({ id: 'c', counterpartyId: 'sup-2', payments: [pay(4_900_000, at(11))] }),
      tx({ id: 'd', kind: 'sale', payments: [pay(8_000_000, at(12))] }),
    ],
  });

  it('cộng tiền mặt hôm nay của đúng người, bỏ chuyển khoản, hôm qua, phiếu bán', () => {
    expect(cashPaidOnDay(book, 'sup-1', today)).toBe(4_500_000);
  });

  it('chạm ngưỡng thì nhắc; dưới ngưỡng, chuyển khoản, khách lẻ nhỏ thì không', () => {
    expect(needsCashReminder(book, 'sup-1', 500_000, 'cash', today)).toBe(true);
    expect(needsCashReminder(book, 'sup-1', 499_999, 'cash', today)).toBe(false);
    expect(needsCashReminder(book, 'sup-1', 6_000_000, 'transfer', today)).toBe(false);
    expect(needsCashReminder(book, undefined, 4_000_000, undefined, today)).toBe(false);
    expect(needsCashReminder(book, undefined, 5_000_000, undefined, today)).toBe(true);
  });

  it('ghi trả có hình thức; mở lại sổ vẫn giữ, giá trị lạ thì bỏ', () => {
    const book2 = data({ transactions: [tx({ lines: [line()] })] });
    const { payment } = recordPayment(book2, 'tx-1', 100_000, 'transfer');
    expect(payment?.method).toBe('transfer');
    expect(recordPayment(book2, 'tx-1', 100_000).payment).not.toHaveProperty('method');
    const raw = { ...tx(), payments: [{ id: 'x', date: at(8), amount: 1, method: 'transfer' }, { id: 'y', date: at(8), amount: 1, method: 'momo' }] };
    expect(normalizeTransaction(raw as never).payments.map((p) => p.method)).toEqual(['transfer', undefined]);
  });
});
