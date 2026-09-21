import { describe, expect, it } from 'vitest';
import { searchBook } from '../src/search';
import { buyer, data, line, product, supplier, tx } from './fixtures';

const book = data({
  suppliers: [supplier({ id: 'sup-1', name: 'Cô Mai', phone: '0912345678', location: 'Lộc Ninh' })],
  buyers: [buyer({ id: 'buy-1', name: 'Nhà máy Phước Hoà' })],
  products: [product({ id: 'prod-1', name: 'Cao su' })],
  transactions: [
    tx({
      id: 'tx-1',
      supplierName: 'Cô Mai',
      lines: [line({ productName: 'Cao su' })],
      note: 'hẹn cân lại chiều mai',
    }),
  ],
});

describe('searchBook', () => {
  it('gõ không dấu vẫn tìm ra tên có dấu', () => {
    expect(searchBook(book, 'co mai').some((h) => h.title === 'Cô Mai')).toBe(true);
  });

  it('tìm được theo số điện thoại', () => {
    const hits = searchBook(book, '0912');
    expect(hits[0]?.kind).toBe('supplier');
  });

  it('đối tác và mặt hàng đứng trước phiếu', () => {
    const kinds = searchBook(book, 'cao su').map((h) => h.kind);
    expect(kinds.indexOf('product')).toBeLessThan(kinds.indexOf('transaction'));
  });

  it('tìm được theo ghi chú của phiếu', () => {
    const hits = searchBook(book, 'chiều mai');
    expect(hits.some((h) => h.kind === 'transaction')).toBe(true);
  });

  it('gõ dưới hai ký tự thì không trả về gì — tránh đổ cả sổ ra màn hình', () => {
    expect(searchBook(book, 'c')).toEqual([]);
  });

  it('giới hạn số kết quả', () => {
    expect(searchBook(book, 'co mai', 1)).toHaveLength(1);
  });
});
