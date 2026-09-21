import type { MeMembership, MemberRole, OrgType } from '@mambo/contracts';

/** Người gọi đang thao tác trong tổ chức nào, với vai trò gì. Guard gắn vào request. */
export interface MembershipContext {
  readonly organizationId: string;
  readonly orgType: OrgType;
  readonly role: MemberRole;
  readonly branchId: string | null;
}

/**
 * Tra membership. Chỉ đếm membership `active`.
 *
 * BE1 chưa có database ⇒ `NoMembershipsYet`: không ai thuộc tổ chức nào, mọi
 * route `auth: 'org'` trả NOT_A_MEMBER. BE2 thay bằng bản đọc qua Prisma — guard
 * và controller không phải sửa.
 */
export interface MembershipLookup {
  find(userId: string, organizationId: string): Promise<MembershipContext | null>;
  listForUser(userId: string): Promise<MeMembership[]>;
}

export const MEMBERSHIP_LOOKUP = Symbol('MEMBERSHIP_LOOKUP');

export class NoMembershipsYet implements MembershipLookup {
  async find(): Promise<MembershipContext | null> {
    return null;
  }

  async listForUser(): Promise<MeMembership[]> {
    return [];
  }
}
