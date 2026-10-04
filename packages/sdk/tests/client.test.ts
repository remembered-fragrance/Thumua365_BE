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

  it('route có thân request: gửi JSON đúng phương thức và đường dẫn', async () => {
    const { calls, fetchFn } = recorder(json(200, { email: '84912345678@id.thumua365.vn' }));
    const client = createClient({ baseUrl: 'https://api.test', getAccessToken: () => null, fetch: fetchFn });

    await expect(client.resolveIdentifier({ identifier: '0912 345 678' })).resolves.toEqual({
      email: '84912345678@id.thumua365.vn',
    });
    expect(calls[0]?.url).toBe('https://api.test/v1/auth/resolve-identifier');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ identifier: '0912 345 678' }));
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers['content-type']).toBe('application/json');
  });

  const emptyPull = {
    cursor: 'c2',
    hasMore: false,
    resetRequired: false,
    changes: { suppliers: [], buyers: [], products: [], pricingRules: [], notes: [], drafts: [], transactions: [], payments: [] },
  };

  it('sync.pull: tham số thành query string, bỏ tham số trống', async () => {
    const { calls, fetchFn } = recorder(json(200, emptyPull));
    const client = createClient({ baseUrl: 'https://api.test', getAccessToken: () => 'tok', fetch: fetchFn });

    await client.sync.pull({ cursor: 'a+b/c', limit: 200 });
    expect(calls[0]?.url).toBe('https://api.test/v1/sync/pull?cursor=a%2Bb%2Fc&limit=200');
    expect(calls[0]?.init?.method).toBe('GET');
    expect(calls[0]?.init?.body).toBeUndefined();
  });

  it('links.accept: tham số đường dẫn điền vào :id (đã mã hoá), POST không thân', async () => {
    const summary = {
      id: '0b9e4c1a-2d3f-4a5b-9c6d-7e8f9a0b1c2d',
      side: 'linked',
      status: 'active',
      partnerKind: 'supplier',
      partner: { id: '6f1c1d2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f', name: 'Cô Mai' },
      counterpart: { id: '6f1c1d2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f', name: 'Vựa Tư Hùng', type: 'trader' },
      invitedPhone: '+84912345678',
      inviteCode: null,
      createdAt: '2026-09-28T03:00:00.000Z',
      decidedAt: '2026-09-28T03:01:00.000Z',
    };
    const { calls, fetchFn } = recorder(json(200, summary));
    const client = createClient({ baseUrl: 'https://api.test', getAccessToken: () => 'tok', fetch: fetchFn });

    await expect(client.links.accept(summary.id)).resolves.toEqual(summary);
    expect(calls[0]?.url).toBe(`https://api.test/v1/links/${summary.id}/accept`);
    expect(calls[0]?.init?.method).toBe('POST');
    expect(calls[0]?.init?.body).toBeUndefined();
  });

  it('links.claim: gửi mã như người dùng gõ — server chuẩn hoá', async () => {
    const summary = {
      id: '0b9e4c1a-2d3f-4a5b-9c6d-7e8f9a0b1c2d',
      side: 'linked',
      status: 'active',
      partnerKind: 'supplier',
      partner: { id: '6f1c1d2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f', name: 'Cô Mai' },
      counterpart: { id: '6f1c1d2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f', name: 'Vựa Tư Hùng', type: 'trader' },
      invitedPhone: null,
      inviteCode: null,
      createdAt: '2026-09-28T03:00:00.000Z',
      decidedAt: '2026-09-28T03:01:00.000Z',
    };
    const { calls, fetchFn } = recorder(json(200, summary));
    const client = createClient({ baseUrl: 'https://api.test', getAccessToken: () => 'tok', fetch: fetchFn });

    await expect(client.links.claim({ code: 'k7m2-qx9p' })).resolves.toEqual(summary);
    expect(calls[0]?.url).toBe('https://api.test/v1/links/claim');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ code: 'k7m2-qx9p' }));
  });

  it('orders.schedule: :id vào đường dẫn, version + lịch vào thân; list bỏ tham số trống', async () => {
    const order = {
      id: '0b9e4c1a-2d3f-4a5b-9c6d-7e8f9a0b1c2d',
      status: 'scheduled',
      version: 3,
      role: 'buyer',
      createdByMe: false,
      counterpart: { id: '6f1c1d2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f', name: 'Hộ cô Mai', type: 'farmer' },
      crop: 'rubber',
      productId: null,
      estQuantity: 1000,
      unit: 'kg',
      offeredPrice: 47_940,
      pickupAt: '2026-10-05T01:00:00.000Z',
      pickupAddress: null,
      branchId: null,
      partnerId: null,
      createdAt: '2026-10-03T03:00:00.000Z',
      updatedAt: '2026-10-03T03:05:00.000Z',
    };
    const { calls, fetchFn } = recorder(json(200, order));
    const client = createClient({ baseUrl: 'https://api.test', getAccessToken: () => 'tok', fetch: fetchFn });

    const input = { version: 2, pickupAt: '2026-10-05T01:00:00.000Z' };
    await expect(client.orders.schedule(order.id, input)).resolves.toEqual(order);
    expect(calls[0]?.url).toBe(`https://api.test/v1/orders/${order.id}/schedule`);
    expect(calls[0]?.init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual(input);

    const list = recorder(json(200, { orders: [order], cursor: null }));
    const listing = createClient({ baseUrl: 'https://api.test', getAccessToken: () => 'tok', fetch: list.fetchFn });
    await listing.orders.list({ role: 'buyer' });
    expect(list.calls[0]?.url).toBe('https://api.test/v1/orders?role=buyer');
  });

  it('attachments.upload: xin URL rồi PUT đúng header; 409 (đã lên từ trước) là xong; 500 thì ném', async () => {
    const id = '0b9e4c1a-2d3f-4a5b-9c6d-7e8f9a0b1c2d';
    const target = {
      attachmentId: id,
      uploadUrl: 'https://storage.test/upload/attachments/org/x?token=up',
      method: 'PUT',
      headers: { 'content-type': 'image/jpeg', 'x-upsert': 'false' },
      expiresAt: '2026-10-03T05:00:00.000Z',
    };
    const image = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });
    for (const [putStatus, ok] of [
      [200, true],
      [409, true],
      [500, false],
    ] as const) {
      const responses = [json(200, target), new Response('', { status: putStatus })];
      const calls: { url: string; init?: RequestInit }[] = [];
      const fetchFn = async (url: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        return responses.shift() ?? new Response('', { status: 599 });
      };
      const client = createClient({ baseUrl: 'https://api.test', getAccessToken: () => 'tok', fetch: fetchFn });
      const run = client.attachments.upload(id, image);
      if (ok) await expect(run).resolves.toBeUndefined();
      else await expect(run).rejects.toMatchObject({ code: 'INTERNAL', status: 500 });
      expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ attachmentId: id, contentType: 'image/jpeg', size: 3 });
      expect(calls[1]?.url).toBe(target.uploadUrl);
      expect(calls[1]?.init?.method).toBe('PUT');
      expect(calls[1]?.init?.headers).toEqual(target.headers);
    }
  });

  it('sync.pull lần đầu: không có query string', async () => {
    const { calls, fetchFn } = recorder(json(200, emptyPull));
    const client = createClient({ baseUrl: 'https://api.test', getAccessToken: () => 'tok', fetch: fetchFn });

    await client.sync.pull();
    expect(calls[0]?.url).toBe('https://api.test/v1/sync/pull');
  });
});

