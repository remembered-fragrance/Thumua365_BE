/**
 * BE9 — `/metrics` cho Prometheus: chỉ mở với đúng token; nhãn route là MẪU đường dẫn (không phải id
 * thật — không thì số chuỗi số đo phình vô hạn); không cấu hình token → như không có gì ở đó.
 */

import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, makeSigner, testEnv } from './helpers';

const TOKEN = 'token-prometheus-dai-it-nhat-24';

let app: INestApplication;
let closed: INestApplication;

beforeAll(async () => {
  const signer = await makeSigner();
  app = await buildTestApp({ jwks: signer.jwks, env: testEnv({ METRICS_TOKEN: TOKEN }) });
  closed = await buildTestApp({ jwks: signer.jwks });
});

afterAll(async () => {
  await app.close();
  await closed.close();
});

describe('GET /metrics', () => {
  it('đúng token → số đo dạng Prometheus, nhãn route là mẫu đường dẫn', async () => {
    await request(app.getHttpServer()).get('/v1/health').expect(200);
    await request(app.getHttpServer()).get('/v1/orders/0b9e4c1a-2d3f-4a5b-9c6d-7e8f9a0b1c2d').expect(401);
    const res = await request(app.getHttpServer()).get('/metrics').set('authorization', `Bearer ${TOKEN}`).expect(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.text).toContain('http_request_duration_seconds_bucket');
    expect(res.text).toMatch(/route="\/v1\/health",status="2xx"/);
    expect(res.text).toMatch(/route="\/v1\/orders\/:id",status="4xx"/);
    expect(res.text).not.toContain('0b9e4c1a-2d3f-4a5b-9c6d-7e8f9a0b1c2d');
    expect(res.text).toContain('sync_push_ops_total');
  });

  it('không token, sai token, sai phương thức → 404 như không có gì', async () => {
    await request(app.getHttpServer()).get('/metrics').expect(404);
    await request(app.getHttpServer()).get('/metrics').set('authorization', 'Bearer sai').expect(404);
    await request(app.getHttpServer()).post('/metrics').set('authorization', `Bearer ${TOKEN}`).expect(404);
  });

  it('chưa cấu hình METRICS_TOKEN → 404 với mọi token', async () => {
    await request(closed.getHttpServer()).get('/metrics').set('authorization', `Bearer ${TOKEN}`).expect(404);
  });
});
