import { describe, expect, it } from 'vitest';
import { moneyToVietnameseWords, numberToVietnameseWords } from '../src/numberToWords';

describe('numberToVietnameseWords', () => {
  it.each([
    [0, 'không'],
    [5, 'năm'],
    [10, 'mười'],
    [15, 'mười lăm'],
    [21, 'hai mươi mốt'],
    [24, 'hai mươi bốn'],
    [25, 'hai mươi lăm'],
    [100, 'một trăm'],
    [105, 'một trăm linh năm'],
    [320, 'ba trăm hai mươi'],
    [1_000, 'một nghìn'],
    [14_500, 'mười bốn nghìn năm trăm'],
    [1_438_000, 'một triệu bốn trăm ba mươi tám nghìn'],
    [74_000_000, 'bảy mươi bốn triệu'],
    [1_000_000_000, 'một tỷ'],
  ])('%i đọc là "%s"', (value, words) => {
    expect(numberToVietnameseWords(value)).toBe(words);
  });

  it('số âm đọc kèm chữ "âm"', () => {
    expect(numberToVietnameseWords(-50_000)).toBe('âm năm mươi nghìn');
  });

  it('chỉ đọc phần nguyên — tiền không có số lẻ', () => {
    expect(numberToVietnameseWords(1_500.6)).toBe(numberToVietnameseWords(1_501));
  });

  it('kèm đơn vị tiền để đọc dưới ô nhập', () => {
    expect(moneyToVietnameseWords(74_000_000)).toBe('bảy mươi bốn triệu đồng');
  });
});
