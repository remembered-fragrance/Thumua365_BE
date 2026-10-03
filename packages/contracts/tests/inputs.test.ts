import { describe, expect, it } from 'vitest';
import { LINK_CODE_ALPHABET, LINK_CODE_LENGTH, LinkClaimInput, MeBootstrapInput, MeProfilePatch, ResolveIdentifierInput } from '../src/index.js';

describe('MeBootstrapInput', () => {
  it('chuẩn hoá: cắt khoảng trắng, tên đăng nhập về chữ thường', () => {
    const input = MeBootstrapInput.parse({
      orgType: 'trader',
      orgName: '  Vựa Tư Hùng ',
      name: 'Tư Hùng',
      username: 'VuaTuHung',
    });
    expect(input).toEqual({ orgType: 'trader', orgName: 'Vựa Tư Hùng', name: 'Tư Hùng', username: 'vuatuhung' });
  });

  it('từ chối trường lạ — client không tự đặt được vai trò hay gói', () => {
    const res = MeBootstrapInput.safeParse({ orgType: 'farmer', orgName: 'Hộ cô Mai', name: 'Mai', role: 'owner' });
    expect(res.success).toBe(false);
  });

  it('từ chối loại tổ chức lạ, tên rỗng, tên đăng nhập có dấu hay khoảng trắng', () => {
    expect(MeBootstrapInput.safeParse({ orgType: 'admin', orgName: 'x', name: 'x' }).success).toBe(false);
    expect(MeBootstrapInput.safeParse({ orgType: 'farmer', orgName: '   ', name: 'x' }).success).toBe(false);
    expect(MeBootstrapInput.safeParse({ orgType: 'farmer', orgName: 'x', name: 'x', username: 'vựa' }).success).toBe(false);
    expect(MeBootstrapInput.safeParse({ orgType: 'farmer', orgName: 'x', name: 'x', username: 'a b' }).success).toBe(false);
  });
});

describe('Tên đăng nhập không được giống số điện thoại', () => {
  // Đăng nhập một ô tra SĐT trước: tên đăng nhập "0912345678" sẽ chen vào việc đăng nhập bằng số đó.
  const phoneLike = ['0912345678', '0912.345.678', '84912345678', '843456789012'];

  it('lúc đăng ký và lúc sửa hồ sơ đều từ chối', () => {
    for (const username of phoneLike) {
      expect(MeBootstrapInput.safeParse({ orgType: 'farmer', orgName: 'x', name: 'x', username }).success, username).toBe(false);
      expect(MeProfilePatch.safeParse({ username }).success, username).toBe(false);
    }
  });

  it('chữ số nhưng không phải SĐT vẫn được', () => {
    for (const username of ['12345', 'vua.tu.hung', 'tuhung_0912']) {
      expect(MeProfilePatch.safeParse({ username }).success, username).toBe(true);
    }
  });
});

describe('ResolveIdentifierInput', () => {
  it('bắt buộc một chuỗi khác rỗng', () => {
    expect(ResolveIdentifierInput.safeParse({ identifier: '  ' }).success).toBe(false);
    expect(ResolveIdentifierInput.parse({ identifier: ' 0912 345 678 ' })).toEqual({ identifier: '0912 345 678' });
  });
});

describe('LinkClaimInput — mã kết nối', () => {
  it('chuẩn hoá cách người dùng gõ: chữ thường, khoảng trắng, gạch nối', () => {
    for (const typed of ['K7M2QX9P', 'k7m2qx9p', 'k7m2-qx9p', ' K7M2 QX9P ']) {
      expect(LinkClaimInput.parse({ code: typed })).toEqual({ code: 'K7M2QX9P' });
    }
  });

  it('từ chối mã sai độ dài, ký tự dễ nhầm (0 O 1 I L), trường lạ', () => {
    for (const code of ['', 'K7M2QX9', 'K7M2QX9PA', 'K7M2QX90', 'K7M2QXOP', 'K7M2QX1P', 'K7M2QXIP', 'K7M2QXLP']) {
      expect(LinkClaimInput.safeParse({ code }).success).toBe(false);
    }
    expect(LinkClaimInput.safeParse({ code: 'K7M2QX9P', linkId: 'x' }).success).toBe(false);
  });

  it('bảng chữ không có ký tự dễ nhầm, không trùng, độ dài 8', () => {
    expect(LINK_CODE_ALPHABET).not.toMatch(/[01OIL]/);
    expect(new Set(LINK_CODE_ALPHABET).size).toBe(LINK_CODE_ALPHABET.length);
    expect(LINK_CODE_LENGTH).toBe(8);
  });
});
