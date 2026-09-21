const vnd = new Intl.NumberFormat('vi-VN');

export const formatVnd = (n: number): string => `${vnd.format(Math.round(n))}₫`;

export const formatVndShort = (n: number): string => {
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${vnd.format(round(n / 1_000_000_000, 1))} tỷ`;
  if (abs >= 1_000_000) return `${vnd.format(round(n / 1_000_000, 1))}tr`;
  if (abs >= 1_000) return `${vnd.format(round(n / 1_000, 0))}k`;
  return vnd.format(n);
};

export const formatQuantity = (value: number, unit = 'kg'): string =>
  `${vnd.format(round(value, 2))} ${unit}`;

export const formatWeight = (kg: number): string => formatQuantity(kg, 'kg');

/**
 * Thêm dấu ngăn nghìn vào chuỗi người dùng ĐANG GÕ: `74000000` → `74.000.000`.
 * Giữ nguyên phần thập phân đang gõ dở (`1,` vẫn là `1,`), nếu không thì dấu
 * phẩy biến mất ngay khi vừa gõ xong.
 */
export const groupThousands = (raw: string): string => {
  if (!raw) return '';
  const [whole = '', fraction] = raw.split(',');
  const digits = whole.replace(/\D/g, '');
  const head = digits ? vnd.format(Number(digits)) : '';
  return fraction === undefined ? head : `${head},${fraction}`;
};

export const formatDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });

export const formatDateTime = (iso: string): string =>
  new Date(iso).toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

const round = (n: number, digits = 0): number => {
  const f = 10 ** digits;
  return Math.round((n + Number.EPSILON) * f) / f;
};
