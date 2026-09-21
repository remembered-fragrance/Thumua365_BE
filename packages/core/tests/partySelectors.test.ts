import { describe, expect, it } from 'vitest';
import { partySummaries, partyTransactions } from '../src/partySelectors';
import { buyer, data, line, supplier, tx } from './fixtures';

const book = data({
  suppliers: [supplier({ id: 'sup-1', name: 'Cô Mai', phone: '0912345678' })],
  buyers: [buyer({ id: 'buy-1', name: 'Nhà máy' })],
  transactions: [
    tx({ id: 'tx-1', date: '2026-08-01T00:00:00.000Z', lines: [line()], amountPaid: 400_000 }),
    tx({ id: 'tx-2', date: '2026-08-05T00:00:00.000Z', lines: [line()], amountPaid: 1_000_000 }),
    tx({
      id: 'tx-3',
      kind: 'sale',
      counterpartyId: 'buy-1',
      supplierId: 'buy-1',
      supplierName: 'Nhà máy',
      lines: [line({ pricePerUnit: 12_000 })],
    }),
    // Phiếu ghi cho khách lẻ — có trong thống kê nhưng không có hồ sơ để sửa.
    tx({ id: 'tx-4', counterpartyId: 'guest', supplierId: 'guest', supplierName: 'Khách lẻ' }),
  ],
});

describe('partySummaries', () => {
  it('người bán chỉ cộng phiếu mua', () => {
    const mai = partySummaries(book, 'supplier').find((p) => p.id === 'sup-1');
    expect(mai?.txCount).toBe(2);
    expect(mai?.total).toBe(2_000_000);
    expect(mai?.debt).toBe(600_000);
  });

  it('người mua chỉ cộng phiếu bán', () => {
    const factory = partySummaries(book, 'buyer').find((p) => p.id === 'buy-1');
    expect(factory?.txCount).toBe(1);
    expect(factory?.total).toBe(1_200_000);
  });

  it('khách lẻ không có hồ sơ nên không sửa/xoá được', () => {
    const guest = partySummaries(book, 'supplier').find((p) => p.id === 'guest');
    expect(guest?.hasProfile).toBe(false);
    expect(partySummaries(book, 'supplier').find((p) => p.id === 'sup-1')?.hasProfile).toBe(true);
  });

  it('lấy được lịch sử phiếu của một đối tác, mới nhất trước', () => {
    const history = partyTransactions(book, 'sup-1');
    expect(history.map((t) => t.id)).toEqual(['tx-2', 'tx-1']);
  });

  it('giới hạn số phiếu trả về', () => {
    expect(partyTransactions(book, 'sup-1', 1)).toHaveLength(1);
  });
});
