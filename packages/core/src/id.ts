/**
 * Sinh id bản ghi.
 *
 * UUID THUẦN, không tiền tố. Cột `id` của mọi bảng là kiểu `uuid` và do client
 * sinh (xem supabase/migrations/0001) — tiền tố kiểu `tx-…` sẽ bị Postgres từ
 * chối. Client sinh id để ghi lạc quan khi mất mạng: biết id ngay, không đợi
 * máy chủ trả về.
 *
 * `crypto.randomUUID()` có sẵn ở trình duyệt và Node. Fallback cho ngữ cảnh
 * không bảo mật (mở app qua http trong mạng nội bộ) — vẫn đúng định dạng uuid.
 */

const HEX = '0123456789abcdef';

const randomHex = (length: number): string => {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += HEX[b % 16];
  return out;
};

/** UUID v4 khi `crypto.randomUUID` không dùng được (http, trình duyệt cũ). */
const fallbackUuid = (): string =>
  [
    randomHex(8),
    randomHex(4),
    `4${randomHex(3)}`,
    HEX[8 + Math.floor(Math.random() * 4)] + randomHex(3),
    randomHex(12),
  ].join('-');

export const newId = (): string =>
  typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : fallbackUuid();
