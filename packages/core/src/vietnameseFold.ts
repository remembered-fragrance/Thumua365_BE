/**
 * Bỏ dấu tiếng Việt và hạ chữ thường.
 *
 * Dùng ở hai chỗ khác nhau nên đứng riêng một file: tìm kiếm toàn cục (gõ
 * "co mai" phải ra "Cô Mai") và đọc tiêu đề cột file Excel người dùng gửi tới
 * ("Số điện thoại", "So dien thoai", "SỐ ĐIỆN THOẠI" là cùng một cột).
 */
export const fold = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
