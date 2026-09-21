import { describe, expect, it } from 'vitest';
import { transactionTotals } from '../src/calc';
import { debtGroups } from '../src/debtSelectors';
import { demoBook } from '../src/demoSeed';
import { inventoryValues } from '../src/inventory';
import { emptyData, normalize } from '../src/normalize';
import { partySummaries } from '../src/partySelectors';

describe('demoBook — sổ mẫu của chế độ trình diễn', () => {
  it('KHÔNG bao giờ tự xuất hiện: sổ mới vẫn rỗng (lỗi chặn L1)', () => {
    expect(emptyData().transactions).toHaveLength(0);
    expect(normalize(undefined).suppliers).toHaveLength(0);
  });

  it('đi qua normalize được — nó nạp bằng chính đường nhập file', () => {
    const book = normalize(demoBook());
    expect(book.transactions.length).toBeGreaterThan(0);
    expect(book.suppliers.length).toBeGreaterThan(0);
  });

  it('mỗi lần gọi là một sổ mới, id không trùng nhau', () => {
    const first = demoBook();
    const second = demoBook();
    expect(first.transactions[0]?.id).not.toBe(second.transactions[0]?.id);
  });

  it('có cả phiếu mua lẫn phiếu bán — để trình diễn được lời lỗ', () => {
    const book = demoBook();
    expect(book.transactions.some((t) => t.kind === 'purchase')).toBe(true);
    expect(book.transactions.some((t) => t.kind === 'sale')).toBe(true);
  });

  it('có nợ và có nợ QUÁ HẠN — thứ màn Công nợ cần để nói lên điều gì đó', () => {
    const book = demoBook();
    const payable = debtGroups(book, 'payable');
    expect(payable.length).toBeGreaterThan(0);
    expect(payable.some((g) => g.overdue)).toBe(true);
  });

  it('có một mặt hàng tồn âm — cho thấy app bắt được lỗi nhập sai', () => {
    expect(inventoryValues(demoBook()).some((r) => r.stockKg < 0)).toBe(true);
  });

  it('amountPaid không vượt tổng phiếu', () => {
    for (const t of demoBook().transactions) {
      expect(t.amountPaid).toBeLessThanOrEqual(transactionTotals(t).total);
    }
  });

  it('mọi phiếu đều gắn với một đối tác có hồ sơ', () => {
    const book = demoBook();
    const known = [
      ...partySummaries(book, 'supplier'),
      ...partySummaries(book, 'buyer'),
    ].filter((p) => p.hasProfile);
    for (const t of book.transactions) {
      expect(known.some((p) => p.id === t.counterpartyId)).toBe(true);
    }
  });
});
