import { describe, expect, it } from 'vitest';
import { appendDigit, parseNumber } from '../src/parseNumber';

describe('L2 — MỘT cách hiểu dấu phẩy cho cả app', () => {
  it('gõ "1,5" luôn ra 1,5 — không bao giờ ra 15', () => {
    expect(parseNumber('1,5')).toBe(1.5);
  });

  it('dấu chấm là ngăn nghìn: "74.000.000" ra bảy mươi bốn triệu', () => {
    expect(parseNumber('74.000.000')).toBe(74_000_000);
  });

  it('vừa ngăn nghìn vừa thập phân: "1.234,5"', () => {
    expect(parseNumber('1.234,5')).toBe(1234.5);
  });

  it('bỏ khoảng trắng người dùng lỡ gõ', () => {
    expect(parseNumber(' 320 ')).toBe(320);
    expect(parseNumber('1 000')).toBe(1000);
  });

  it('ô trống hoặc chữ vô nghĩa ra 0, không ra NaN', () => {
    expect(parseNumber('')).toBe(0);
    expect(parseNumber('abc')).toBe(0);
    expect(parseNumber(',')).toBe(0);
  });

  it('số âm vẫn đọc được (khoản trừ bớt)', () => {
    expect(parseNumber('-50000')).toBe(-50_000);
  });
});

describe('appendDigit — gõ trên bàn phím số', () => {
  it('nối chữ số vào cuối', () => {
    expect(appendDigit('14', '5')).toBe('145');
  });

  it('không cho số 0 dẫn đầu', () => {
    expect(appendDigit('0', '5')).toBe('5');
  });

  it('nút 000 thêm ba số 0, nhưng không bấm được khi ô trống', () => {
    expect(appendDigit('74', '000')).toBe('74000');
    expect(appendDigit('', '000')).toBe('');
    expect(appendDigit('0', '000')).toBe('0');
  });

  it('chỉ cho đúng một dấu phẩy', () => {
    expect(appendDigit('1', ',')).toBe('1,');
    expect(appendDigit('1,5', ',')).toBe('1,5');
  });

  it('gõ dấu phẩy đầu tiên thì tự thêm số 0 phía trước', () => {
    expect(appendDigit('', ',')).toBe('0,');
  });

  it('xoá từng ký tự', () => {
    expect(appendDigit('145', 'del')).toBe('14');
    expect(appendDigit('', 'del')).toBe('');
  });

  it('"Xoá hết" xoá một lần thay vì bấm ⌫ tám lần', () => {
    expect(appendDigit('74000000', 'clear')).toBe('');
  });
});
