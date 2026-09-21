/**
 * Guard tổ chức, guard quyền và interceptor hợp đồng — thử bằng route giả vì BE1
 * chưa có route `auth: 'org'` thật nào. Route thật từ BE2 dùng đúng các guard này.
 */

import { ErrorBody, type RouteDef } from '@mambo/contracts';
import type { INestApplication } from '@nestjs/common';
import { Controller } from '@nestjs/common';
import request from 'supertest';
import { z } from 'zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Endpoint } from '../src/common/endpoint';
import { FakeMemberships, ORG_ID, buildTestApp, makeSigner } from './helpers';

const deleteReceipt = {
  method: 'DELETE',
  path: '/v1/test/receipt',
  summary: 'test',
  auth: 'org',
  permission: 'receipt:delete',
  response: z.object({ ok: z.literal(true) }),
} as const satisfies RouteDef;

const leaky = {
  method: 'GET',
  path: '/v1/test/leaky',
  summary: 'test',
  auth: 'public',
  response: z.object({ name: z.string() }),
} as const satisfies RouteDef;

const broken = { ...leaky, path: '/v1/test/broken' } as const satisfies RouteDef;

@Controller()
class TestController {
  @Endpoint(deleteReceipt)
  del() {
    return { ok: true };
  }

  /** Lỡ tay trả cả trường nội bộ. */
  @Endpoint(leaky)
  leaky() {
    return { name: 'Vựa Tư Hùng', passwordHash: 'bí mật' };
  }

  /** Trả sai hình dạng. */
  @Endpoint(broken)
  broken() {
    return { name: 42 };
  }
}

let signer: Awaited<ReturnType<typeof makeSigner>>;
let memberships: FakeMemberships;
let app: INestApplication;
let token: string;

beforeAll(async () => {
  signer = await makeSigner();
  memberships = new FakeMemberships();
  app = await buildTestApp({ jwks: signer.jwks, memberships, extraControllers: [TestController] });
  token = await signer.sign();
});
afterAll(() => app.close());

const del = (orgId?: string) => {
  const req = request(app.getHttpServer()).delete('/v1/test/receipt').set('authorization', `Bearer ${token}`);
  return orgId === undefined ? req : req.set('x-organization-id', orgId);
};

describe('OrgContextGuard', () => {
  it('thiếu header tổ chức → 422', async () => {
    const res = await del().expect(422);
    expect(ErrorBody.parse(res.body).error.details).toEqual({ header: 'X-Organization-Id' });
  });

  it('header không phải UUID → 422', async () => {
    await del('org-1').expect(422);
  });

  it('không phải thành viên → 403 NOT_A_MEMBER', async () => {
    const res = await del(ORG_ID).expect(403);
    expect(ErrorBody.parse(res.body).error.code).toBe('NOT_A_MEMBER');
  });

  it('chưa đăng nhập bị chặn trước khi tra tổ chức', async () => {
    const res = await request(app.getHttpServer()).delete('/v1/test/receipt').set('x-organization-id', ORG_ID);
    expect(res.status).toBe(401);
  });
});

describe('PermissionGuard — theo ma trận của @mambo/contracts', () => {
  it('người cân của vựa không được xoá phiếu → 403 FORBIDDEN', async () => {
    memberships.byOrg.set(ORG_ID, { organizationId: ORG_ID, orgType: 'trader', role: 'staff', branchId: null });
    const res = await del(ORG_ID).expect(403);
    expect(ErrorBody.parse(res.body).error).toMatchObject({
      code: 'FORBIDDEN',
      details: { permission: 'receipt:delete' },
    });
  });

  it('chủ vựa được xoá phiếu → 200', async () => {
    memberships.byOrg.set(ORG_ID, { organizationId: ORG_ID, orgType: 'trader', role: 'owner', branchId: null });
    await del(ORG_ID).expect(200, { ok: true });
  });

  it('nông dân không có quyền này dù là owner', async () => {
    memberships.byOrg.set(ORG_ID, { organizationId: ORG_ID, orgType: 'farmer', role: 'owner', branchId: null });
    await del(ORG_ID.toUpperCase()).expect(403);
  });
});

describe('ContractInterceptor', () => {
  it('lọc bỏ trường không có trong hợp đồng', async () => {
    const res = await request(app.getHttpServer()).get('/v1/test/leaky').expect(200);
    expect(res.body).toEqual({ name: 'Vựa Tư Hùng' });
  });

  it('phản hồi sai hợp đồng → 500 INTERNAL, không lộ chi tiết', async () => {
    const res = await request(app.getHttpServer()).get('/v1/test/broken').expect(500);
    const body = ErrorBody.parse(res.body);
    expect(body.error.code).toBe('INTERNAL');
    expect(body.error.details).toBeUndefined();
  });
});
