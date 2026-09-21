import { describe, expect, it } from 'vitest';
import {
  detectIdentifierKind,
  formatPhoneVn,
  isPhoneLike,
  normalizeIdentifier,
  normalizePhone,
} from '../src/identifier';

describe('L4 — một ô đăng nhập, tự nhận dạng', () => {
  it('nhận ra email', () => {
    expect(detectIdentifierKind('co.mai@gmail.com')).toBe('email');
  });

  it('nhận ra số điện thoại ở mọi cách gõ', () => {
    expect(detectIdentifierKind('0905112233')).toBe('phone');
    expect(detectIdentifierKind('0905 112 233')).toBe('phone');
    expect(detectIdentifierKind('+84 905 112 233')).toBe('phone');
    expect(detectIdentifierKind('0905-112-233')).toBe('phone');
  });

  it('còn lại là tên tài khoản', () => {
    expect(detectIdentifierKind('comai')).toBe('username');
    expect(isPhoneLike('comai')).toBe(false);
  });
});

describe('chuẩn hoá số điện thoại về +84', () => {
  it.each(['0905112233', '0905 112 233', '+84905112233', '+84 905 112 233', '84905112233'])(
    '"%s" → +84905112233',
    (input) => {
      expect(normalizePhone(input)).toBe('+84905112233');
    },
  );

  it('không phải số điện thoại thì trả về rỗng', () => {
    expect(normalizePhone('comai')).toBe('');
  });

  it('hiện lại theo cách người Việt đọc', () => {
    expect(formatPhoneVn('+84905112233')).toBe('0905 112 233');
  });

  it('chuỗi không phải +84 thì để nguyên', () => {
    expect(formatPhoneVn('comai')).toBe('comai');
  });
});

describe('khoá tra cứu tài khoản', () => {
  it('gõ số kiểu nào cũng vào ĐÚNG MỘT tài khoản', () => {
    const keys = ['0905112233', '0905 112 233', '+84 905 112 233'].map(normalizeIdentifier);
    expect(new Set(keys).size).toBe(1);
  });

  it('email không phân biệt hoa thường', () => {
    expect(normalizeIdentifier('  Co.Mai@Gmail.COM ')).toBe('co.mai@gmail.com');
  });

  it('tên tài khoản không phân biệt hoa thường', () => {
    expect(normalizeIdentifier('CoMai')).toBe('comai');
  });
});
