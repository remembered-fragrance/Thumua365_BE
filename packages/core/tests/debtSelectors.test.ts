import { describe, expect, it } from 'vitest';
import { debtGroups, dueDateOf, isOverdue, overdueCount, totalOf } from '../src/debtSelectors';
import { data, buyer, line, supplier, tx } from './fixtures';

const DAY = 86_400_000;
const iso = (offsetDays: number): string => new Date(Date.now() + offsetDays * DAY).toISOString();

/** Phiếu 1.000.000₫ (100kg × 10.000đ), trả bao nhiêu thì truyền vào. */
const debtTx = (patch: Parameters<typeof tx>[0] = {}) =>
  tx({ lines: [line()], amountPaid: 0, ...patch });

describe('dueDateOf', () => {
  it('không hẹn ngày thì không có hạn', () => {
    expect(dueDateOf(debtTx())).toBeUndefined();
  });

  it('nhiều kỳ hạn thì lấy hạn sớm nhất', () => {
    const t = debtTx({
      creditTerms: [
        { dueDate: iso(10), amount: 500_000 },
        { dueDate: iso(3), amount: 500_000 },
      ],
    });
    expect(dueDateOf(t)).toBe(t.creditTerms?.[1]?.dueDate);
  });
});

describe('isOverdue', () => {
  it('quá ngày hẹn mà còn nợ là quá hạn', () => {
    expect(isOverdue(debtTx({ creditTerms: [{ dueDate: iso(-1), amount: 1_000_000 }] }))).toBe(true);
  });

  it('hẹn đúng hôm nay thì HÔM NAY chưa quá hạn', () => {
    expect(isOverdue(debtTx({ creditTerms: [{ dueDate: iso(0), amount: 1_000_000 }] }))).toBe(false);
  });

  it('đã trả đủ thì không quá hạn dù đã qua ngày hẹn', () => {
    const t = debtTx({
      amountPaid: 1_000_000,
      creditTerms: [{ dueDate: iso(-30), amount: 1_000_000 }],
    });
    expect(isOverdue(t)).toBe(false);
  });

  it('không hẹn ngày thì không bao giờ quá hạn — không tự bịa ra hạn', () => {
    expect(isOverdue(debtTx())).toBe(false);
  });
});

describe('debtGroups', () => {
  const book = data({
    suppliers: [supplier({ id: 'sup-1', name: 'Cô Mai' }), supplier({ id: 'sup-2', name: 'Chú Bảy' })],
    buyers: [buyer({ id: 'buy-1', name: 'Nhà máy' })],
    transactions: [
      // Nợ ít nhưng QUÁ HẠN
      debtTx({
        id: 'tx-late',
        counterpartyId: 'sup-1',
        supplierId: 'sup-1',
        lines: [line({ grossWeight: 10 })],
        creditTerms: [{ dueDate: iso(-2), amount: 100_000 }],
      }),
      // Nợ nhiều, chưa tới hạn
      debtTx({
        id: 'tx-big',
        counterpartyId: 'sup-2',
        supplierId: 'sup-2',
        lines: [line({ grossWeight: 500 })],
        creditTerms: [{ dueDate: iso(5), amount: 5_000_000 }],
      }),
      // Phía bán — phải thu
      debtTx({
        id: 'tx-sale',
        kind: 'sale',
        counterpartyId: 'buy-1',
        supplierId: 'buy-1',
        supplierName: 'Nhà máy',
      }),
    ],
  });

  it('quá hạn xếp trước, dù nợ ít hơn', () => {
    const groups = debtGroups(book, 'payable');
    expect(groups.map((g) => g.partyName)).toEqual(['Cô Mai', 'Chú Bảy']);
    expect(groups[0]?.overdue).toBe(true);
    expect(groups[1]?.overdue).toBe(false);
  });

  it('phải thu chỉ gồm phiếu bán', () => {
    const groups = debtGroups(book, 'receivable');
    expect(groups).toHaveLength(1);
    expect(groups[0]?.partyName).toBe('Nhà máy');
  });

  it('tổng của một bên là tổng nợ các nhóm', () => {
    expect(totalOf(debtGroups(book, 'payable'))).toBe(100_000 + 5_000_000);
  });

  it('đếm được số nhóm quá hạn của cả hai bên', () => {
    expect(overdueCount(book)).toBe(1);
  });
});
