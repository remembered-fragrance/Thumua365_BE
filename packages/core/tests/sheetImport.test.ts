import { describe, expect, it } from 'vitest';
import { parseReceipts, parseSuppliers, type SheetMatrix } from '../src/sheetImport';

const SUPPLIER_HEADER = ['Tên nông hộ', 'Số điện thoại', 'Khu vực', 'Ghi chú'];
const RECEIPT_HEADER = [
  'Ngày',
  'Tên nông hộ',
  'Mặt hàng',
  'Đơn vị',
  'Số lượng',
  'Đơn giá',
  'Đã trả',
  'Ghi chú',
];

describe('parseSuppliers', () => {
  it('đọc được file mẫu', () => {
    const result = parseSuppliers([
      SUPPLIER_HEADER,
      ['Cô Mai', '0912345678', 'Ấp 3', 'Vườn sau cầu'],
    ]);
    expect(result).toEqual({
      ok: true,
      items: [{ name: 'Cô Mai', phone: '0912345678', location: 'Ấp 3', note: 'Vườn sau cầu' }],
    });
  });

  it('nhận tiêu đề cột gõ không dấu và viết hoa', () => {
    const result = parseSuppliers([['TEN NONG HO', 'SDT'], ['Cô Mai', '0912345678']]);
    expect(result.ok).toBe(true);
  });

  it('thiếu cột bắt buộc thì báo ngay ở dòng tiêu đề', () => {
    const result = parseSuppliers([['Số điện thoại'], ['0912345678']]);
    expect(result).toEqual({
      ok: false,
      errors: [{ row: 1, code: 'missingColumn', column: 'Tên nông hộ' }],
    });
  });

  it('bỏ qua dòng trống giữa file', () => {
    const result = parseSuppliers([SUPPLIER_HEADER, ['Cô Mai'], ['', '', '', ''], ['Chú Bảy']]);
    expect(result.ok && result.items).toHaveLength(2);
  });

  it('thiếu tên thì báo đúng số dòng như trong Excel', () => {
    const result = parseSuppliers([SUPPLIER_HEADER, ['Cô Mai'], ['', '0900000000']]);
    expect(result).toEqual({
      ok: false,
      errors: [{ row: 3, code: 'missingName', column: 'Tên nông hộ' }],
    });
  });
});

describe('parseReceipts', () => {
  const row = (patch: unknown[] = []): unknown[] => {
    const base = ['01/08/2026', 'Cô Mai', 'Mủ nước', 'kg', 320, 14500, 0, ''];
    return base.map((value, i) => (patch[i] === undefined ? value : patch[i]));
  };

  /**
   * So bằng ngày GIỜ MÁY, không so chuỗi ISO: ô ngày chỉ nói ngày, và test
   * chạy ở múi giờ nào cũng phải cho cùng kết quả.
   */
  const isDay = (iso: string | undefined, y: number, m: number, d: number): boolean => {
    const date = new Date(iso ?? '');
    return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
  };

  it('đọc ngày kiểu Việt Nam: ngày trước, tháng sau', () => {
    const result = parseReceipts([RECEIPT_HEADER, row()] as SheetMatrix);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(isDay(result.items[0]?.date, 2026, 8, 1)).toBe(true);
    expect(result.items[0]?.grossWeight).toBe(320);
  });

  it('đọc ô ngày mà Excel trả về kiểu Date', () => {
    const result = parseReceipts([RECEIPT_HEADER, row([new Date(2026, 7, 1)])] as SheetMatrix);
    expect(result.ok && isDay(result.items[0]?.date, 2026, 8, 1)).toBe(true);
  });

  it('đọc ô ngày mà Excel trả về số thứ tự của nó', () => {
    // 46235 = 01/08/2026 theo cách Excel đếm ngày từ 30/12/1899.
    const result = parseReceipts([RECEIPT_HEADER, row([46_235])] as SheetMatrix);
    expect(result.ok && isDay(result.items[0]?.date, 2026, 8, 1)).toBe(true);
  });

  it('ngày lưu vào giữa trưa để đổi múi giờ không nhảy lùi một ngày', () => {
    const result = parseReceipts([RECEIPT_HEADER, row()] as SheetMatrix);
    expect(result.ok && new Date(result.items[0]?.date ?? '').getHours()).toBe(12);
  });

  it('đọc số viết theo quy ước Việt Nam: chấm ngăn nghìn, phẩy thập phân', () => {
    const result = parseReceipts([RECEIPT_HEADER, row([undefined, undefined, undefined, undefined, '320,5', '14.500'])] as SheetMatrix);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items[0]?.grossWeight).toBe(320.5);
    expect(result.items[0]?.pricePerUnit).toBe(14_500);
  });

  it('ô "Đã trả" bỏ trống nghĩa là chưa trả đồng nào', () => {
    const result = parseReceipts([RECEIPT_HEADER, row([undefined, undefined, undefined, undefined, undefined, undefined, null])] as SheetMatrix);
    expect(result.ok && result.items[0]?.amountPaid).toBe(0);
  });

  it('ô số có chữ thì báo lỗi chứ không âm thầm thành 0', () => {
    const result = parseReceipts([RECEIPT_HEADER, row([undefined, undefined, undefined, undefined, 'ba tram hai muoi'])] as SheetMatrix);
    expect(result).toEqual({
      ok: false,
      errors: [{ row: 2, code: 'badNumber', column: 'Số lượng' }],
    });
  });

  it('số âm bị chặn, không lặng lẽ thành phiếu 0₫', () => {
    const result = parseReceipts([RECEIPT_HEADER, row([undefined, undefined, undefined, undefined, -320])] as SheetMatrix);
    expect(result).toEqual({
      ok: false,
      errors: [{ row: 2, code: 'badNumber', column: 'Số lượng' }],
    });
  });

  it('ngày hỏng thì báo đúng dòng đó', () => {
    const result = parseReceipts([RECEIPT_HEADER, row(), row(['hôm kia'])] as SheetMatrix);
    expect(result).toEqual({ ok: false, errors: [{ row: 3, code: 'badDate', column: 'Ngày' }] });
  });

  it('một dòng sai là KHÔNG nhập gì cả', () => {
    const result = parseReceipts([RECEIPT_HEADER, row(), row([undefined, ''])] as SheetMatrix);
    expect(result.ok).toBe(false);
  });

  it('file chỉ có tiêu đề thì báo file rỗng', () => {
    expect(parseReceipts([RECEIPT_HEADER])).toEqual({
      ok: false,
      errors: [{ row: 1, code: 'emptyFile' }],
    });
  });
});
