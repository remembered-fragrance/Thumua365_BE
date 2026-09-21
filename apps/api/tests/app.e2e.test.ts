import { ErrorBody, Health, Me } from '@mambo/contracts';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiException } from '../src/common/api-exception';
import {
  ALLOWED_ORIGIN,
  FakeSupabaseUsers,
  USER_ID,
  buildTestApp,
  makeSigner,
  testEnv,
} from './helpers';

let signer: Awaited<ReturnType<typeof makeSigner>>;
let users: FakeSupabaseUsers;
let app: INestApplication;

beforeAll(async () => {
  signer = await makeSigner();
  users = new FakeSupabaseUsers();
  app = await buildTestApp({ jwks: signer.jwks, supabaseUsers: users });
});
afterAll(() => app.close());

const expectError = (body: unknown, code: string) => {
  const parsed = ErrorBody.parse(body);
  expect(parsed.error.code).toBe(code);
  return parsed;
};

describe('GET /v1/health', () => {
  it('trả trạng thái đúng hợp đồng, không cần đăng nhập', async () => {
    const res = await request(app.getHttpServer()).get('/v1/health').expect(200);
    expect(Health.parse(res.body)).toEqual({ status: 'ok', version: '0.2.0', commit: 'abcdef1', env: 'staging' });
  });

  it('mỗi phản hồi có x-request-id; nhận lại mã hợp lệ client gửi lên', async () => {
    const res = await request(app.getHttpServer()).get('/v1/health').set('x-request-id', 'client-abc-123');
    expect(res.headers['x-request-id']).toBe('client-abc-123');

    const bad = await request(app.getHttpServer()).get('/v1/health').set('x-request-id', 'x');
    expect(bad.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('có header bảo mật của helmet, không lộ x-powered-by', async () => {
    const res = await request(app.getHttpServer()).get('/v1/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('GET /v1/me', () => {
  it('không có token → 401 UNAUTHENTICATED, requestId khớp header', async () => {
    const res = await request(app.getHttpServer()).get('/v1/me').expect(401);
    const body = expectError(res.body, 'UNAUTHENTICATED');
    expect(body.error.requestId).toBe(res.headers['x-request-id']);
  });

  it.each([
    ['token rác', async () => 'khong-phai-jwt'],
    ['sai issuer (project Supabase khác)', async () => signer.sign({}, { issuer: 'https://khac.supabase.co/auth/v1' })],
    ['đã hết hạn', async () => signer.sign({}, { expiresIn: '-1m' })],
    ['ký bằng khoá lạ', async () => signer.sign({}, { key: await signer.otherKey() })],
    ['khoá anon (role không phải authenticated)', async () => signer.sign({ role: 'anon' })],
  ])('%s → 401', async (_, makeToken) => {
    const res = await request(app.getHttpServer())
      .get('/v1/me')
      .set('authorization', `Bearer ${await makeToken()}`)
      .expect(401);
    expectError(res.body, 'UNAUTHENTICATED');
  });

  it('token hợp lệ → hồ sơ đúng hợp đồng; giấu email nội bộ; SĐT dạng E.164', async () => {
    const token = await signer.sign();
    const res = await request(app.getHttpServer()).get('/v1/me').set('authorization', `Bearer ${token}`).expect(200);

    expect(Me.parse(res.body)).toEqual({
      user: { id: USER_ID, name: 'Cô Mai', phone: '+84912345678', email: null, phoneVerified: true },
      memberships: [],
      pendingLinks: 0,
    });
    // Gọi Supabase Auth bằng chính token của người dùng, không bằng khoá quản trị.
    expect(users.tokens.at(-1)).toBe(token);
  });

  it('phiên đã bị thu hồi ở Supabase → 401 dù JWT còn hạn', async () => {
    users.failWith = new ApiException('UNAUTHENTICATED', 'Phiên đăng nhập không còn hiệu lực');
    try {
      const res = await request(app.getHttpServer())
        .get('/v1/me')
        .set('authorization', `Bearer ${await signer.sign()}`)
        .expect(401);
      expectError(res.body, 'UNAUTHENTICATED');
    } finally {
      users.failWith = null;
    }
  });

  it('Supabase Auth lỗi → 500 INTERNAL, không lộ thông điệp gốc', async () => {
    users.failWith = new Error('Supabase Auth trả 503 — chi tiết nội bộ');
    try {
      const res = await request(app.getHttpServer())
        .get('/v1/me')
        .set('authorization', `Bearer ${await signer.sign()}`)
        .expect(500);
      const body = expectError(res.body, 'INTERNAL');
      expect(JSON.stringify(body)).not.toContain('chi tiết nội bộ');
    } finally {
      users.failWith = null;
    }
  });
});

describe('lỗi mức ứng dụng', () => {
  it('đường dẫn lạ → 404 NOT_FOUND', async () => {
    const res = await request(app.getHttpServer()).get('/v1/khong-co').expect(404);
    expectError(res.body, 'NOT_FOUND');
  });

  it('JSON sai cú pháp → 422 VALIDATION_FAILED', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/me')
      .set('content-type', 'application/json')
      .send('{"a":')
      .expect(422);
    expectError(res.body, 'VALIDATION_FAILED');
  });

  it('thân request quá 1MB → 413 PAYLOAD_TOO_LARGE', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/me')
      .set('content-type', 'application/json')
      .send(JSON.stringify({ blob: 'x'.repeat(1_100_000) }))
      .expect(413);
    expectError(res.body, 'PAYLOAD_TOO_LARGE');
  });
});

describe('CORS', () => {
  it('domain app được phép', async () => {
    const res = await request(app.getHttpServer()).get('/v1/health').set('origin', ALLOWED_ORIGIN);
    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
    expect(res.headers['access-control-expose-headers']).toContain('x-request-id');
  });

  it('domain lạ không nhận header CORS', async () => {
    const res = await request(app.getHttpServer()).get('/v1/health').set('origin', 'https://evil.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('preflight cho phép header tổ chức', async () => {
    const res = await request(app.getHttpServer())
      .options('/v1/me')
      .set('origin', ALLOWED_ORIGIN)
      .set('access-control-request-method', 'GET')
      .set('access-control-request-headers', 'authorization,x-organization-id');
    expect(res.headers['access-control-allow-headers']).toContain('x-organization-id');
  });
});

describe('giới hạn tần suất', () => {
  it('vượt hạn mức → 429 RATE_LIMITED; /v1/health không bị tính', async () => {
    const limited = await buildTestApp({ jwks: signer.jwks, env: testEnv({ RATE_LIMIT_PER_MINUTE: '3' }) });
    try {
      const server = limited.getHttpServer();
      for (let i = 0; i < 5; i++) await request(server).get('/v1/health').expect(200);
      for (let i = 0; i < 3; i++) await request(server).get('/v1/me').expect(401);

      const res = await request(server).get('/v1/me').expect(429);
      expectError(res.body, 'RATE_LIMITED');
      expect(res.headers['retry-after']).toBeDefined();
    } finally {
      await limited.close();
    }
  });

  it('sau Cloudflare: đếm theo IP thật trong CLIENT_IP_HEADER, mỗi người một hạn mức', async () => {
    const env = testEnv({ RATE_LIMIT_PER_MINUTE: '2', CLIENT_IP_HEADER: 'CF-Connecting-IP' });
    const behindProxy = await buildTestApp({ jwks: signer.jwks, env });
    try {
      const server = behindProxy.getHttpServer();
      const as = (ip: string) => request(server).get('/v1/me').set('cf-connecting-ip', ip);

      await as('203.0.113.7').expect(401);
      await as('203.0.113.7').expect(401);
      await as('203.0.113.7').expect(429);
      // Người khác, cùng lúc, không bị vạ lây.
      await as('198.51.100.9').expect(401);
    } finally {
      await behindProxy.close();
    }
  });

  it('không khai báo CLIENT_IP_HEADER thì đổi header cũng không lách được hạn mức', async () => {
    const direct = await buildTestApp({ jwks: signer.jwks, env: testEnv({ RATE_LIMIT_PER_MINUTE: '2' }) });
    try {
      const server = direct.getHttpServer();
      await request(server).get('/v1/me').set('cf-connecting-ip', '10.0.0.1').expect(401);
      await request(server).get('/v1/me').set('cf-connecting-ip', '10.0.0.2').expect(401);
      await request(server).get('/v1/me').set('cf-connecting-ip', '10.0.0.3').expect(429);
    } finally {
      await direct.close();
    }
  });
});
