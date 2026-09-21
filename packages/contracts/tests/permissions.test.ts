import { describe, expect, it } from 'vitest';
import { MEMBER_ROLES, ORG_TYPES, hasBook } from '../src/organization';
import { PERMISSIONS, can, type Permission } from '../src/permissions';

/**
 * Bảng ma trận chép từ KH backend §1.6, từng ô một — cố ý viết lại ở dạng khác
 * `PERMISSIONS_BY` để một lần sửa nhầm bên kia bị bắt ngay tại đây.
 * Cột: nông dân · vựa owner · vựa staff · DN owner · DN manager · DN staff.
 */
const COLUMNS = [
  ['farmer', 'owner'],
  ['trader', 'owner'],
  ['trader', 'staff'],
  ['enterprise', 'owner'],
  ['enterprise', 'manager'],
  ['enterprise', 'staff'],
] as const;

const MATRIX: Readonly<Record<Permission, readonly [boolean, boolean, boolean, boolean, boolean, boolean]>> = {
  'order:create': [true, true, true, true, true, true],
  'order:respond': [true, true, true, true, true, false],
  'book:sync': [false, true, true, true, true, true],
  'receipt:create': [false, true, true, true, true, true],
  'payment:record': [false, true, true, true, true, true],
  'receipt:delete': [false, true, false, true, true, false],
  'payment:void': [false, true, false, true, true, false],
  'partner:manage': [false, true, false, true, true, false],
  'pricing:manage': [false, true, false, true, true, false],
  'linked:read': [true, true, false, true, true, false],
  'staff:manage': [false, true, false, true, false, false],
  'branch:manage': [false, true, false, true, false, false],
  'report:view': [true, true, false, true, true, false],
  'billing:manage': [true, true, false, true, false, false],
  'account:delete': [true, true, false, true, false, false],
};

describe('ma trận quyền', () => {
  it('bảng kiểm phủ đủ mọi quyền', () => {
    expect(Object.keys(MATRIX).sort()).toEqual([...PERMISSIONS].sort());
  });

  for (const permission of PERMISSIONS) {
    it(`${permission} khớp KH backend §1.6`, () => {
      const actual = COLUMNS.map(([type, role]) => can(type, role, permission));
      expect(actual).toEqual(MATRIX[permission]);
    });
  }

  it('ô chưa định nghĩa không có quyền gì', () => {
    for (const permission of PERMISSIONS) {
      expect(can('farmer', 'manager', permission)).toBe(false);
      expect(can('farmer', 'staff', permission)).toBe(false);
      expect(can('trader', 'manager', permission)).toBe(false);
    }
  });

  it('chỉ tổ chức có sổ mới được đồng bộ sổ', () => {
    for (const type of ORG_TYPES) {
      for (const role of MEMBER_ROLES) {
        if (can(type, role, 'book:sync')) expect(hasBook(type)).toBe(true);
      }
    }
  });
});
