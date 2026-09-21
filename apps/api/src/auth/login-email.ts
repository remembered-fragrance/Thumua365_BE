/**
 * Email nội bộ cho người chỉ đăng ký bằng số điện thoại: `84912345678@id.thumua365.vn`
 * (xem `data/auth.ts` của frontend). Tên miền ta sở hữu, không gửi thư tới. Đó là
 * khoá đăng nhập, không phải email thật của người dùng.
 */

import { normalizePhone } from '@mambo/core/identifier';

export const INTERNAL_EMAIL_DOMAIN = '@id.thumua365.vn';

const INTERNAL_EMAIL = /^(84\d{8,10})@id\.thumua365\.vn$/i;

export const isInternalEmail = (email: string): boolean => email.toLowerCase().endsWith(INTERNAL_EMAIL_DOMAIN);

/** `+84912345678` → `84912345678@id.thumua365.vn`. */
export const internalEmailOf = (phoneE164: string): string => `${phoneE164.replace('+', '')}${INTERNAL_EMAIL_DOMAIN}`;

/** Số điện thoại mã hoá trong email nội bộ (`+84…`), hoặc null nếu không phải email nội bộ. */
export const phoneFromLoginEmail = (email: string | null | undefined): string | null => {
  const match = email ? INTERNAL_EMAIL.exec(email.trim()) : null;
  return match?.[1] ? normalizePhone(match[1]) || null : null;
};
