/**
 * Ma trận quyền — KH backend §1.6. Đây là bản DUY NHẤT: server (PermissionGuard,
 * kiểm từng op sync), frontend (ẩn/hiện) và test cùng đọc bảng này.
 *
 * Quyền ở đây là "được làm loại việc này". Phạm vi (chỉ chi nhánh của mình, chỉ
 * đơn gửi tới mình) do server suy ra từ membership, không mã hoá vào tên quyền.
 *
 * Ô nào ma trận chưa định nghĩa (nông dân manager/staff, vựa manager) để mảng
 * rỗng = không có quyền gì. Mở ra khi có nhu cầu thật, qua PR có cả hai người duyệt.
 */

import { z } from 'zod';
import type { MemberRole, OrgType } from './organization.js';

export const PERMISSIONS = [
  'order:create',
  'order:respond',
  'book:sync',
  'receipt:create',
  'receipt:delete',
  'payment:record',
  'payment:void',
  'partner:manage',
  'pricing:manage',
  'linked:read',
  'staff:manage',
  'branch:manage',
  'report:view',
  'billing:manage',
  'account:delete',
] as const;

export const Permission = z.enum(PERMISSIONS);
export type Permission = z.infer<typeof Permission>;

/** Quyền đầy đủ của người đứng đầu một tổ chức có sổ (vựa, doanh nghiệp). */
const BOOK_OWNER: readonly Permission[] = PERMISSIONS;

export const PERMISSIONS_BY: Readonly<Record<OrgType, Readonly<Record<MemberRole, readonly Permission[]>>>> = {
  farmer: {
    owner: ['order:create', 'order:respond', 'linked:read', 'report:view', 'billing:manage', 'account:delete'],
    manager: [],
    staff: [],
  },
  trader: {
    owner: BOOK_OWNER,
    // Ma trận đã chốt không có cột "vựa manager": vựa chỉ có chủ và người cân.
    manager: [],
    staff: ['order:create', 'order:respond', 'book:sync', 'receipt:create', 'payment:record'],
  },
  enterprise: {
    owner: BOOK_OWNER,
    manager: [
      'order:create',
      'order:respond',
      'book:sync',
      'receipt:create',
      'receipt:delete',
      'payment:record',
      'payment:void',
      'partner:manage',
      'pricing:manage',
      'linked:read',
      'report:view',
    ],
    staff: ['order:create', 'book:sync', 'receipt:create', 'payment:record'],
  },
};

export const permissionsOf = (type: OrgType, role: MemberRole): readonly Permission[] =>
  PERMISSIONS_BY[type][role];

export const can = (type: OrgType, role: MemberRole, permission: Permission): boolean =>
  PERMISSIONS_BY[type][role].includes(permission);
