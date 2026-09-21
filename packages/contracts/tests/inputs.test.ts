import { describe, expect, it } from 'vitest';
import { MeBootstrapInput, ResolveIdentifierInput } from '../src/index.js';

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

describe('ResolveIdentifierInput', () => {
  it('bắt buộc một chuỗi khác rỗng', () => {
    expect(ResolveIdentifierInput.safeParse({ identifier: '  ' }).success).toBe(false);
    expect(ResolveIdentifierInput.parse({ identifier: ' 0912 345 678 ' })).toEqual({ identifier: '0912 345 678' });
  });
});
