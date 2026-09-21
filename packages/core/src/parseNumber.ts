/**
 * MỘT quy ước số duy nhất cho toàn app (lỗi chặn L2).
 *
 * Người dùng Việt Nam gõ dấu phẩy là DẤU THẬP PHÂN: `1,5` → 1.5.
 * Dấu chấm được coi là dấu ngăn nghìn khi người dùng gõ từ bàn phím hệ thống,
 * nên bị bỏ đi trước khi parse: `74.000.000` → 74000000.
 *
 * Đây là nơi DUY NHẤT trong `src/` được phép gọi parseFloat.
 */
export const parseNumber = (s: string): number => {
  const cleaned = s.trim().replace(/\./g, '').replace(/\s/g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Nối ký tự mới từ Numpad vào chuỗi đang gõ.
 * Chỉ thao tác chuỗi — không parse. Parent dùng parseNumber() khi cần số.
 */
export const appendDigit = (current: string, digit: string): string => {
  if (digit === 'del') return current.slice(0, -1);
  if (digit === 'clear') return '';
  if (digit === ',') return current.includes(',') ? current : `${current || '0'},`;
  if (digit === '000') {
    if (!current || current === '0') return current;
    return current + '000';
  }
  if (current === '0') return digit;
  return current + digit;
};
