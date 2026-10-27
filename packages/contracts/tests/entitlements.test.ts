import { describe, expect, it } from 'vitest';
import { ENTITLEMENTS, STAFF_LIMIT, entitled, entitlementsFor } from '../src/entitlements';
import { PlanTier } from '../src/me';
import { ORG_TYPES } from '../src/organization';
import { routes } from '../src/routes';
import type { RouteDef } from '../src/route-def';

/**
 * Bảng chép tay từ KE_HOACH_GOI_PRO §1, §6 — cố ý viết lại ở dạng khác `entitlementsFor` để một lần sửa
 * nhầm bên kia bị bắt tại đây. Cột: dùng thử · đang trả tiền · ân hạn · hết gói · chưa có gói.
 */
const TIERS = ['trial', 'premium', 'grace', 'free', null] as const;
const HAS: Readonly<Record<(typeof ORG_TYPES)[number], readonly boolean[]>> = {
  farmer: [false, false, false, false, false],
  trader: [true, true, true, false, false],
  enterprise: [true, true, true, false, false],
};

describe('quyền lợi theo gói', () => {
  it('bảng kiểm phủ mọi bậc gói', () => {
    expect([...TIERS.filter((t) => t !== null)].sort()).toEqual([...PlanTier.options].sort());
  });

  for (const type of ORG_TYPES) {
    for (const entitlement of ENTITLEMENTS) {
      it(`${type} · ${entitlement}`, () => {
        expect(TIERS.map((tier) => entitled(type, tier, entitlement))).toEqual(HAS[type]);
      });
    }
  }

  it('bậc có quyền lợi thì có đủ, không có bậc nào có một nửa', () => {
    for (const type of ORG_TYPES) {
      for (const tier of TIERS) {
        expect([0, ENTITLEMENTS.length]).toContain(entitlementsFor(type, tier).length);
      }
    }
  });

  it('vựa tối đa 3 người cân; doanh nghiệp và nông dân không giới hạn theo người', () => {
    expect(STAFF_LIMIT).toEqual({ trader: 3 });
  });

  it('route gắn quyền lợi thì khai PLAN_REQUIRED và là route của tổ chức', () => {
    for (const [name, route] of Object.entries(routes) as [string, RouteDef][]) {
      if (!route.entitlement) continue;
      expect(route.auth, name).toBe('org');
      expect(route.errors ?? [], name).toContain('PLAN_REQUIRED');
    }
  });

  it('những gì không được chặn theo gói (N2, N3) không gắn quyền lợi', () => {
    const free = ['syncPull', 'attachmentUrl', 'ordersCreate', 'linksAccept', 'orgBranchUpdate', 'orgMembersList'];
    for (const name of free) {
      const route = (routes as Record<string, RouteDef>)[name];
      expect(route, name).toBeDefined();
      expect(route?.entitlement, name).toBeUndefined();
    }
  });
});
