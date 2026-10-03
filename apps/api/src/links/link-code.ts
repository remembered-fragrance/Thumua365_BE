/**
 * Mã kết nối — bên sổ đưa tận tay cho bên được mời (quyết định 01/10/2026, thay OTP SMS tới
 * khi > 100 tổ chức trả phí).
 *
 * 8 ký tự trên bảng 31 chữ/số (≈ 8,5 × 10¹¹ mã) + hạn 7 ngày + 10 lần thử/phút/IP ở route
 * `/links/claim`: đoán trúng một mã đang sống là không thực tế. Mã lưu nguyên văn (không băm)
 * để bên sổ mở lại màn hình là thấy đúng mã cũ / QR cũ — ai đọc được bảng này thì đã đọc được
 * chính phần sổ mà mã mở ra, băm không che thêm được gì.
 */

import { randomInt } from 'node:crypto';
import { LINK_CODE_ALPHABET, LINK_CODE_LENGTH, LINK_CODE_TTL_DAYS } from '@mambo/contracts';
import { Prisma } from '../generated/prisma/client';

const DAY_MS = 86_400_000;
/** Mã sắp hết hạn trong khoảng này thì cấp mã mới luôn — đưa ra rồi người kia chưa kịp nhập. */
const RENEW_BEFORE_MS = 60 * 60 * 1000;
/** Trùng mã với một lời mời khác (xác suất ~10⁻⁸) thì làm lại cả lượt, tối đa ngần này lần. */
const MAX_ATTEMPTS = 3;

/** Ngẫu nhiên an toàn (`crypto.randomInt`), phân bố đều trên bảng chữ. */
export const generateLinkCode = (): string =>
  Array.from({ length: LINK_CODE_LENGTH }, () => LINK_CODE_ALPHABET[randomInt(LINK_CODE_ALPHABET.length)]).join('');

export const freshLinkCode = (now = Date.now()): { inviteCode: string; inviteCodeExpiresAt: Date } => ({
  inviteCode: generateLinkCode(),
  inviteCodeExpiresAt: new Date(now + LINK_CODE_TTL_DAYS * DAY_MS),
});

/** Lời mời đang chờ cần mã mới: chưa có mã, mã đã hết hạn, hoặc sắp hết hạn. */
export const needsFreshCode = (expiresAt: Date | null, now = Date.now()): boolean =>
  !expiresAt || expiresAt.getTime() - now < RENEW_BEFORE_MS;

const isCodeCollision = (err: unknown): boolean =>
  err instanceof Prisma.PrismaClientKnownRequestError &&
  err.code === 'P2002' &&
  `${JSON.stringify(err.meta ?? {})} ${err.message}`.includes('invite_code');

/**
 * Chạy lại cả transaction khi mã vừa sinh trùng mã của lời mời khác. Không thử lại TRONG
 * transaction được: Postgres huỷ transaction ngay ở lỗi trùng khoá.
 */
export const withFreshCodeRetry = async <T>(work: () => Promise<T>): Promise<T> => {
  for (let attempt = 1; ; attempt++) {
    try {
      return await work();
    } catch (err) {
      if (attempt >= MAX_ATTEMPTS || !isCodeCollision(err)) throw err;
    }
  }
};
