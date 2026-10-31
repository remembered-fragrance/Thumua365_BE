import { describe, expect, it } from 'vitest';
import { ENTITLEMENTS, PLAN_EXCLUDES, entitled, entitlementsFor, staffLimit } from '../src/entitlements';
import { PlanCode, PlanTier } from '../src/me';
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

  // Không có mã gói (doanh nghiệp) và gói Vựa: đủ mọi quyền lợi ở bậc có gói.
  for (const plan of [null, 'vua'] as const) {
    for (const type of ORG_TYPES) {
      for (const entitlement of ENTITLEMENTS) {
        it(`${type} · ${plan ?? 'không mã gói'} · ${entitlement}`, () => {
          expect(TIERS.map((tier) => entitled(type, tier, plan, entitlement))).toEqual(HAS[type]);
        });
      }
    }
  }

  it('bậc có quyền lợi thì có đủ, không có bậc nào có một nửa (trừ phần gói Thương lái không có)', () => {
    for (const type of ORG_TYPES) {
      for (const tier of TIERS) {
        expect([0, ENTITLEMENTS.length]).toContain(entitlementsFor(type, tier, null).length);
        expect([0, ENTITLEMENTS.length]).toContain(entitlementsFor(type, tier, 'vua').length);
      }
    }
  });
});

describe('gói Thương lái (0.28.0, chốt 30/10/2026)', () => {
  /** Chép tay từ TODO §3 — không đọc lại `PLAN_EXCLUDES` để một lần sửa nhầm bên kia bị bắt. */
  const SOLO_LACKS = ['members:add', 'audit:view', 'reports:org'];

  it('bảng loại trừ phủ đủ mọi mã gói', () => {
    expect(Object.keys(PLAN_EXCLUDES).sort()).toEqual([...PlanCode.options].sort());
  });

  for (const entitlement of ENTITLEMENTS) {
    const has = !SOLO_LACKS.includes(entitlement);
    it(`thương lái · ${entitlement} → ${has ? 'có' : 'không'} ở dùng thử / trả tiền / ân hạn`, () => {
      expect(TIERS.map((tier) => entitled('trader', tier, 'thuong_lai', entitlement))).toEqual([has, has, has, false, false]);
    });
  }

  it('người cân: Thương lái 0, Vựa 3 + số mua thêm, không mã gói (doanh nghiệp) không giới hạn', () => {
    expect(staffLimit('thuong_lai', 0)).toBe(0);
    expect(staffLimit('vua', 0)).toBe(3);
    expect(staffLimit('vua', 5)).toBe(8);
    expect(staffLimit(null, 0)).toBeNull();
  });
});

describe('route và quyền lợi', () => {
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
