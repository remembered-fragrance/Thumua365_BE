import type { MeMembership, MemberRole, OrgType } from '@mambo/contracts';

/** Người gọi đang thao tác trong tổ chức nào, với vai trò gì. Guard gắn vào request. */
export interface MembershipContext {
  readonly organizationId: string;
  readonly orgType: OrgType;
  readonly role: MemberRole;
  readonly branchId: string | null;
}

/**
 * Tra membership. Chỉ đếm membership `active` của tổ chức chưa bị xoá.
 *
 * Bản thật: `PrismaMemberships` (đọc qua RLS). `NoMembershipsYet` chỉ còn cho test
 * không cần database: không ai thuộc tổ chức nào.
 */
export interface MembershipLookup {
  find(userId: string, organizationId: string): Promise<MembershipContext | null>;
  listForUser(userId: string): Promise<MeMembership[]>;
  /** Lời mời kết nối đang chờ, cộng trên mọi tổ chức người này thuộc (`/v1/me`). */
  pendingLinks(userId: string): Promise<number>;
}

export const MEMBERSHIP_LOOKUP = Symbol('MEMBERSHIP_LOOKUP');

export class NoMembershipsYet implements MembershipLookup {
  async find(): Promise<MembershipContext | null> {
    return null;
  }

  async listForUser(): Promise<MeMembership[]> {
    return [];
  }

  async pendingLinks(): Promise<number> {
    return 0;
  }
}
