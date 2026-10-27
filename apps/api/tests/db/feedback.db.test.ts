/**
 * 0.25.0 trên Postgres thật — góp ý + chấm sao: người và tổ chức lấy từ phiên (app không khai hộ được),
 * góp ý rỗng thành null, sai hình dạng → 422, không phải thành viên → 403, api_service không đọc lại được.
 */

import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaMemberships } from '../../src/auth/prisma-memberships';
import { Database } from '../../src/db/database';
import { FakeSupabaseUsers, buildTestApp, makeSigner, testEnv } from '../helpers';
import { SERVICE_URL, admin, createOrg, newId, service, serviceError, truncateAll } from './db';

let app: INestApplication;
let signer: Awaited<ReturnType<typeof makeSigner>>;

beforeAll(async () => {
  signer = await makeSigner();
  const db = new Database(SERVICE_URL);
  app = await buildTestApp({
    // Hạn mức riêng của route là 5/phút/IP — mỗi request một IP giả, trừ test hạn mức.
    env: testEnv({ DATABASE_URL: SERVICE_URL, RATE_LIMIT_PER_MINUTE: '10000', CLIENT_IP_HEADER: 'x-test-ip' }),
    jwks: signer.jwks,
    supabaseUsers: new FakeSupabaseUsers(),
    db,
    memberships: new PrismaMemberships(db),
  });
});

afterAll(async () => {
  await app.close();
  await admin.end();
  await service.end();
});

beforeEach(truncateAll);

const send = async (userId: string, orgId: string, body: object, status = 200, ip = newId()) =>
  request(app.getHttpServer())
    .post('/v1/feedback')
    .set('authorization', `Bearer ${await signer.sign({ sub: userId })}`)
    .set('x-organization-id', orgId)
    .set('x-test-ip', ip)
    .send(body)
    .expect(status);

const rows = async () =>
  (await admin.query<{ organization_id: string; user_id: string; rating: number; comment: string | null; platform: string; app_version: string | null }>(
    'select organization_id, user_id, rating, comment, platform, app_version from feedback order by created_at',
  )).rows;

describe('POST /v1/feedback', () => {
  it('ghi đúng người và tổ chức của phiên; góp ý được trim, bỏ trống thành null', async () => {
    const owner = newId();
    const vua = await createOrg('trader', owner);

    expect((await send(owner, vua, { rating: 5, comment: '  Dễ dùng lắm  ', platform: 'pwa', appVersion: '1.0.0' })).body).toEqual({ ok: true });
    await send(owner, vua, { rating: 2, comment: '   ', platform: 'web' });

    expect(await rows()).toEqual([
      { organization_id: vua, user_id: owner, rating: 5, comment: 'Dễ dùng lắm', platform: 'pwa', app_version: '1.0.0' },
      { organization_id: vua, user_id: owner, rating: 2, comment: null, platform: 'web', app_version: null },
    ]);
  });

  it('sai hình dạng → 422, kể cả khai hộ tổ chức / người; không ghi gì', async () => {
    const owner = newId();
    const vua = await createOrg('trader', owner);
    for (const body of [
      { rating: 0, platform: 'pwa' },
      { rating: 6, platform: 'pwa' },
      { rating: 4.5, platform: 'pwa' },
      { rating: 4, platform: 'ios' },
      { rating: 4, platform: 'pwa', comment: 'x'.repeat(1001) },
      { rating: 4, platform: 'pwa', organizationId: newId() },
      { rating: 4, platform: 'pwa', userId: newId() },
    ]) {
      expect((await send(owner, vua, body, 422)).body.error.code, JSON.stringify(body)).toBe('VALIDATION_FAILED');
    }
    expect(await rows()).toEqual([]);
  });

  it('không thuộc tổ chức → 403; nông dân và người làm thuê gửi được', async () => {
    const owner = newId();
    const vua = await createOrg('trader', owner);
    expect((await send(newId(), vua, { rating: 3, platform: 'pwa' }, 403)).body.error.code).toBe('NOT_A_MEMBER');

    const staff = newId();
    await admin.query(`insert into memberships (user_id, organization_id, role) values ($1, $2, 'staff')`, [staff, vua]);
    await send(staff, vua, { rating: 3, platform: 'pwa' });
    const mai = newId();
    await send(mai, await createOrg('farmer', mai), { rating: 4, platform: 'twa' });
    expect((await rows()).map((r) => r.user_id)).toEqual([staff, mai]);
  });

  it('5 lần mỗi phút mỗi IP — lần 6 → 429', async () => {
    const owner = newId();
    const vua = await createOrg('trader', owner);
    for (let i = 0; i < 5; i++) await send(owner, vua, { rating: 5, platform: 'pwa' }, 200, '203.0.113.9');
    expect((await send(owner, vua, { rating: 5, platform: 'pwa' }, 429, '203.0.113.9')).body.error.code).toBe('RATE_LIMITED');
    expect(await rows()).toHaveLength(5);
  });

  it('🔴 api_service chỉ ghi: không đọc lại, không ghi hộ người / tổ chức khác', async () => {
    const owner = newId();
    const vua = await createOrg('trader', owner);
    const scope = { userId: owner, orgId: vua };
    expect(await serviceError(scope, 'select * from feedback')).toMatch(/permission denied/);
    expect(
      await serviceError(scope, `insert into feedback (organization_id, user_id, rating, platform) values ($1, $2, 5, 'pwa')`, [vua, newId()]),
    ).toMatch(/row-level security/);
    expect(
      await serviceError(scope, `insert into feedback (organization_id, user_id, rating, platform) values ($1, $2, 5, 'pwa')`, [newId(), owner]),
    ).toMatch(/row-level security/);
  });
});
