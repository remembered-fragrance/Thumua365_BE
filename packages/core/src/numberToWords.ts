/**
 * Đọc số bằng chữ — cách kiểm tra duy nhất mà người dùng ít rành công nghệ tin được
 * ("74.000.000" chỉ là một dãy số; "bảy mươi bốn triệu" thì đếm được bằng tai).
 *
 * Chỉ đọc phần nguyên: dùng cho tiền, không dùng cho khối lượng lẻ.
 */

const DIGITS = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'] as const;
const GROUP_UNITS = ['', 'nghìn', 'triệu', 'tỷ', 'nghìn tỷ', 'triệu tỷ'] as const;

const digitWord = (n: number): string => DIGITS[n] ?? '';

/** Đọc một nhóm 0..999. `full` = luôn đọc cả hàng trăm (nhóm không đứng đầu). */
const readTriple = (n: number, full: boolean): string => {
  const hundreds = Math.floor(n / 100);
  const tens = Math.floor((n % 100) / 10);
  const ones = n % 10;
  const parts: string[] = [];

  if (hundreds > 0 || full) parts.push(`${digitWord(hundreds)} trăm`);

  if (tens === 0) {
    if (ones > 0) {
      if (hundreds > 0 || full) parts.push('linh');
      parts.push(digitWord(ones));
    }
  } else if (tens === 1) {
    parts.push('mười');
    if (ones === 5) parts.push('lăm');
    else if (ones > 0) parts.push(digitWord(ones));
  } else {
    // "mốt" và "lăm" là bắt buộc trong tiếng Việt; số 4 giữ nguyên "bốn"
    // (bảy mươi bốn triệu) vì đó là cách đọc dùng khi đối chiếu tiền.
    parts.push(`${digitWord(tens)} mươi`);
    if (ones === 1) parts.push('mốt');
    else if (ones === 5) parts.push('lăm');
    else if (ones > 0) parts.push(digitWord(ones));
  }

  return parts.join(' ');
};

export const numberToVietnameseWords = (value: number): string => {
  const rounded = Math.round(value);
  if (!Number.isFinite(rounded) || rounded === 0) return 'không';

  const sign = rounded < 0 ? 'âm ' : '';
  let rest = Math.abs(rounded);

  const groups: number[] = [];
  while (rest > 0) {
    groups.push(rest % 1000);
    rest = Math.floor(rest / 1000);
  }

  const parts: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    const group = groups[i] ?? 0;
    if (group === 0) continue;
    const isLeading = parts.length === 0;
    const unit = GROUP_UNITS[i] ?? '';
    parts.push(`${readTriple(group, !isLeading)}${unit ? ` ${unit}` : ''}`.trim());
  }

  return `${sign}${parts.join(' ')}`.trim();
};

/** Dạng dùng cho ô nhập tiền: "bảy mươi bốn triệu đồng". */
export const moneyToVietnameseWords = (value: number): string =>
  `${numberToVietnameseWords(value)} đồng`;
