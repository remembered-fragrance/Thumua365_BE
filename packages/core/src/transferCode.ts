/**
 * Mã đối soát chuyển khoản — nội dung người dùng gõ vào app ngân hàng.
 *
 * 🔴 File này còn được Edge Function `payment-webhook` nạp (Deno) để dò mã
 * trong nội dung biến động số dư. Cùng một hàm ở cả hai đầu là điều kiện để
 * "mã sinh ra" và "mã đọc lại được" không bao giờ lệch nhau. Vì vậy giữ đúng
 * luật của `core/`: không import gì, không chạm DOM, không dùng thư viện.
 */

/**
 * Bỏ 0 · O · 1 · I · L. Mã này được đọc qua điện thoại và chép tay ở điểm thu
 * mua; nhầm một ký tự là tiền vào mà gói không kích hoạt.
 */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

export const TRANSFER_PREFIX = 'TM365';
export const TRANSFER_CODE_LENGTH = 6;

/** @param random Bơm vào để test được. Mặc định `Math.random`. */
export const newTransferCode = (random: () => number = Math.random): string => {
  let code = '';
  for (let i = 0; i < TRANSFER_CODE_LENGTH; i++) {
    code += ALPHABET[Math.floor(random() * ALPHABET.length)] ?? ALPHABET[0];
  }
  return code;
};

/** Nội dung chuyển khoản hiện trên màn QR. Có khoảng trắng cho dễ đọc. */
export const transferContent = (code: string): string => `${TRANSFER_PREFIX} ${code}`;

/**
 * Dò mã trong nội dung biến động số dư.
 *
 * Ngân hàng viết hoa, cắt dấu, và bỏ hoặc thêm khoảng trắng tuỳ ý — có nơi trả
 * về `TM365 K7M2P9`, có nơi `CT DEN:TM365K7M2P9-MBVCB...`. Vì vậy bỏ hết ký tự
 * không phải chữ-số trước khi dò, rồi mới cắt đúng 6 ký tự sau tiền tố.
 *
 * Trả `null` khi không tìm thấy hoặc mã có ký tự ngoài bảng chữ. Không đoán
 * bừa: gõ sai nội dung là chuyện thường xuyên, và đường xử lý đúng của nó là
 * kích hoạt tay (`scripts/admin-activate.ts`), không phải khớp gần đúng.
 */
export const findTransferCode = (description: string): string | null => {
  const packed = description.toUpperCase().replace(/[^0-9A-Z]/g, '');
  const at = packed.indexOf(TRANSFER_PREFIX);
  if (at === -1) return null;

  const code = packed.slice(at + TRANSFER_PREFIX.length, at + TRANSFER_PREFIX.length + TRANSFER_CODE_LENGTH);
  if (code.length < TRANSFER_CODE_LENGTH) return null;

  for (const ch of code) {
    if (!ALPHABET.includes(ch)) return null;
  }
  return code;
};
