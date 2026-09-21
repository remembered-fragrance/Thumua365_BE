import { describe, expect, it } from 'vitest';
import { ApiError, createClient } from '../src/index';

const USER_ID = '6f1c1d2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f';

const me = {
  user: { id: USER_ID, name: 'Cô Mai', phone: '+84912345678', email: null, phoneVerified: true },
  memberships: [],
  pendingLinks: 0,
};

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const recorder = (response: Response) => {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetchFn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return response;
  }) as typeof fetch;
  return { calls, fetchFn };
};

describe('@mambo/sdk', () => {
  it('gửi token và header tổ chức, trả đúng dữ liệu', async () => {
    const { calls, fetchFn } = recorder(json(200, me));
    const client = createClient({
      baseUrl: 'https://api.test',
      getAccessToken: () => 'tok',
      getOrganizationId: () => 'org-1',
      fetch: fetchFn,
    });

    await expect(client.me()).resolves.toEqual(me);
    expect(calls[0]?.url).toBe('https://api.test/v1/me');
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer tok');
    expect(headers['x-organization-id']).toBe('org-1');
  });

  it('chưa đăng nhập thì không gọi mạng', async () => {
    const { calls, fetchFn } = recorder(json(200, me));
    const client = createClient({ baseUrl: 'https://api.test', getAccessToken: () => null, fetch: fetchFn });

    await expect(client.me()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(calls).toHaveLength(0);
  });

  it('endpoint công khai không gửi token', async () => {
    const { calls, fetchFn } = recorder(
      json(200, { status: 'ok', version: '0.2.0', commit: null, env: 'staging' }),
    );
    const client = createClient({ baseUrl: 'https://api.test', getAccessToken: () => 'tok', fetch: fetchFn });

    await client.health();
    const headers = (calls[0]?.init?.headers ?? {}) as Record<string, string>;
    expect(headers.authorization).toBeUndefined();
  });

  it('đọc mã lỗi từ thân lỗi chuẩn', async () => {
    const { fetchFn } = recorder(
      json(402, { error: { code: 'PLAN_EXPIRED', message: 'Gói đã hết hạn', requestId: 'r-1' } }),
    );
    const client = createClient({ baseUrl: 'https://api.test', getAccessToken: () => 'tok', fetch: fetchFn });

    const err = await client.me().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ code: 'PLAN_EXPIRED', status: 402, requestId: 'r-1' });
  });

  it('thân lỗi lạ vẫn ra ApiError, không ném lỗi parse', async () => {
    const { fetchFn } = recorder(new Response('<html>502</html>', { status: 502 }));
    const client = createClient({ baseUrl: 'https://api.test', getAccessToken: () => 'tok', fetch: fetchFn });

    await expect(client.me()).rejects.toMatchObject({ code: 'INTERNAL', status: 502 });
  });

  it('phản hồi sai hợp đồng bị chặn lại', async () => {
    const { fetchFn } = recorder(json(200, { user: { id: 'không-phải-uuid' } }));
    const client = createClient({ baseUrl: 'https://api.test', getAccessToken: () => 'tok', fetch: fetchFn });

    await expect(client.me()).rejects.toMatchObject({ code: 'CONTRACT_MISMATCH' });
  });
});
