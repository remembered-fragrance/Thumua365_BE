import { describe, expect, it } from 'vitest';
import { filterTransactions, periodRange, type HistoryFilters } from '../src/filters';
import { line, tx } from './fixtures';

const filters = (patch: Partial<HistoryFilters> = {}): HistoryFilters => ({
  period: 'all',
  payment: 'all',
  kind: 'all',
  ...patch,
});

const today = new Date().toISOString();
const longAgo = '2020-01-01T02:00:00.000Z';

const all = [
  tx({
    id: 'mua-no',
    date: today,
    lines: [line({ productName: 'Điều', grossWeight: 100, pricePerUnit: 10_000 })],
    amountPaid: 0,
  }),
  tx({
    id: 'mua-tra-du',
    date: today,
    supplierId: 'sup-2',
    counterpartyId: 'sup-2',
    supplierName: 'Chú Bảy',
    lines: [line({ productName: 'Cao su', grossWeight: 100, pricePerUnit: 10_000 })],
    amountPaid: 1_000_000,
    note: 'giao tận kho',
  }),
  tx({ id: 'ban', date: today, kind: 'sale', counterpartyId: 'buy-1', amountPaid: 0 }),
  tx({ id: 'cu', date: longAgo, amountPaid: 0 }),
];

describe('periodRange', () => {
  it('"tất cả" thì không giới hạn thời gian', () => {
    expect(periodRange(filters({ period: 'all' }))).toBeNull();
  });

  it('"hôm nay" bắt đầu từ 0 giờ', () => {
    const range = periodRange(filters({ period: 'day' }));
    expect(new Date(range?.from ?? 0).getHours()).toBe(0);
  });

  it('khoảng tự chọn không nêu ngày kết thúc thì lấy tới hết hôm nay', () => {
    const range = periodRange(filters({ period: 'custom', customFrom: '2026-08-01' }));
    expect(range?.from).toBeLessThan(range?.to ?? 0);
  });

  it('tuần bắt đầu từ thứ Hai', () => {
    const range = periodRange(filters({ period: 'week' }));
    expect(new Date(range?.from ?? 0).getDay()).toBe(1);
  });

  it('tháng bắt đầu từ ngày 1, năm bắt đầu từ 1/1', () => {
    expect(new Date(periodRange(filters({ period: 'month' }))?.from ?? 0).getDate()).toBe(1);
    expect(new Date(periodRange(filters({ period: 'year' }))?.from ?? 0).getMonth()).toBe(0);
  });
});

describe('filterTransactions', () => {
  it('mặc định chỉ hiện phiếu MUA khi chưa chọn chiều giao dịch', () => {
    const ids = filterTransactions(all, { period: 'all', payment: 'all' }).map((t) => t.id);
    expect(ids).not.toContain('ban');
  });

  it('lọc riêng phiếu bán', () => {
    expect(filterTransactions(all, filters({ kind: 'sale' })).map((t) => t.id)).toEqual(['ban']);
  });

  it('lọc theo người bán dùng ĐỐI TÁC, không dùng trường cũ', () => {
    expect(filterTransactions(all, filters({ supplierId: 'sup-2' })).map((t) => t.id)).toEqual([
      'mua-tra-du',
    ]);
  });

  it('lọc phiếu còn nợ và phiếu đã trả đủ', () => {
    expect(filterTransactions(all, filters({ payment: 'unpaid' })).map((t) => t.id)).toEqual([
      'mua-no',
      'ban',
      'cu',
    ]);
    expect(filterTransactions(all, filters({ payment: 'paid' })).map((t) => t.id)).toEqual([
      'mua-tra-du',
    ]);
  });

  it('lọc theo mặt hàng', () => {
    expect(filterTransactions(all, filters({ crop: 'Điều' })).map((t) => t.id)).toEqual(['mua-no']);
    expect(filterTransactions(all, filters({ crop: 'all' }))).toHaveLength(4);
  });

  it('tìm theo tên người bán, tên hàng hoặc ghi chú', () => {
    expect(filterTransactions(all, filters({ query: 'bảy' })).map((t) => t.id)).toEqual([
      'mua-tra-du',
    ]);
    expect(filterTransactions(all, filters({ query: 'tận kho' })).map((t) => t.id)).toEqual([
      'mua-tra-du',
    ]);
    expect(filterTransactions(all, filters({ query: 'không có ai tên vậy' }))).toEqual([]);
  });

  it('lọc theo kỳ loại bỏ phiếu quá cũ', () => {
    expect(filterTransactions(all, filters({ period: 'day' })).map((t) => t.id)).not.toContain('cu');
  });
});
