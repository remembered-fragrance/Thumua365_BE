/**
 * Định danh đăng nhập — MỘT ô duy nhất (lỗi chặn L4).
 *
 * Người dùng gõ tên tài khoản, số điện thoại hoặc email vào cùng một ô.
 * Tầng dữ liệu tra cứu bằng `normalizeIdentifier()`, không bằng chuỗi thô —
 * nhờ vậy `0905112233`, `0905 112 233`, `+84 905 112 233` là CÙNG một tài khoản.
 */

export type IdentifierKind = 'phone' | 'email' | 'username';

const PHONE_CHARS = /[\s.\-()]/g;
const LOCAL_PHONE = /^0\d{8,10}$/;
const INTL_PHONE = /^(?:\+?84)\d{8,10}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const stripPhoneChars = (raw: string): string => raw.trim().replace(PHONE_CHARS, '');

export const isPhoneLike = (raw: string): boolean => {
  const s = stripPhoneChars(raw);
  return LOCAL_PHONE.test(s) || INTL_PHONE.test(s);
};

export const detectIdentifierKind = (raw: string): IdentifierKind => {
  const s = raw.trim();
  if (EMAIL.test(s)) return 'email';
  if (isPhoneLike(s)) return 'phone';
  return 'username';
};

/**
 * Chuẩn hoá số điện thoại Việt Nam về dạng E.164 `+84…`.
 * Trả về chuỗi rỗng nếu không phải số điện thoại.
 */
export const normalizePhone = (raw: string): string => {
  const s = stripPhoneChars(raw);
  if (LOCAL_PHONE.test(s)) return `+84${s.slice(1)}`;
  if (INTL_PHONE.test(s)) return `+84${s.replace(/^\+?84/, '')}`;
  return '';
};

/** Hiển thị lại số đã chuẩn hoá theo cách người Việt đọc: `0905 112 233`. */
export const formatPhoneVn = (e164: string): string => {
  if (!e164.startsWith('+84')) return e164;
  const local = `0${e164.slice(3)}`;
  if (local.length === 10) return `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`;
  return `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`.trim();
};

/**
 * Khoá tra cứu tài khoản. Mọi so sánh định danh phải đi qua hàm này.
 * - điện thoại → `+84…`
 * - email / tên tài khoản → chữ thường, bỏ khoảng trắng thừa
 */
export const normalizeIdentifier = (raw: string): string => {
  const kind = detectIdentifierKind(raw);
  if (kind === 'phone') return normalizePhone(raw);
  return raw.trim().toLowerCase();
};
