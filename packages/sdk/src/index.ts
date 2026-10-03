/**
 * Client có kiểu cho API THUMUA365 — frontend gọi API qua đây, không `fetch` tay.
 *
 * Gọi theo đúng `routes` của `@mambo/contracts`, và kiểm lại phản hồi bằng chính
 * schema đó: server trả sai hợp đồng thì lỗi nổ ngay ở đây (`CONTRACT_MISMATCH`),
 * không lặng lẽ chảy vào sổ của người dùng.
 *
 * Lỗi mạng (không có phản hồi) KHÔNG bị bọc: `fetch` ném `TypeError` như thường.
 * Hàng đợi đồng bộ coi nó như lỗi 5xx — thử lại theo lịch giãn cách.
 */

import {
  ErrorBody,
  routes,
  type ErrorCode,
  type RouteBody,
  type RouteName,
  type RouteQuery,
  type RouteResponse,
  type RouteWithBody,
  type SyncPushRequest,
} from '@mambo/contracts';

export class ApiError extends Error {
  readonly code: ErrorCode | 'CONTRACT_MISMATCH';
  readonly status: number;
  readonly requestId: string | undefined;
  readonly details: Record<string, unknown> | undefined;

  constructor(
    code: ErrorCode | 'CONTRACT_MISMATCH',
    status: number,
    message: string,
    requestId?: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.requestId = requestId;
    this.details = details;
  }
}

export interface ClientOptions {
  /** Ví dụ `https://api-staging.thumua365.vn` — không có `/` ở cuối. */
  readonly baseUrl: string;
  /** Token hiện tại của Supabase Auth; `null` khi chưa đăng nhập. */
  readonly getAccessToken: () => Promise<string | null> | string | null;
  /** Tổ chức đang thao tác — bắt buộc với endpoint `auth: 'org'`. */
  readonly getOrganizationId?: () => string | null;
  readonly fetch?: typeof fetch;
}

const readError = async (res: Response): Promise<ApiError> => {
  const body: unknown = await res.json().catch(() => null);
  const parsed = ErrorBody.safeParse(body);
  if (parsed.success) {
    const { code, message, requestId, details } = parsed.data.error;
    return new ApiError(code, res.status, message, requestId, details);
  }
  return new ApiError('INTERNAL', res.status, `HTTP ${res.status}`, res.headers.get('x-request-id') ?? undefined);
};

export const createClient = (options: ClientOptions) => {
  const doFetch = options.fetch ?? fetch;

  const call = async <N extends RouteName>(
    name: N,
    body?: unknown,
    query?: Readonly<Record<string, string | number | undefined>>,
    params?: Readonly<Record<string, string>>,
  ): Promise<RouteResponse<N>> => {
    const route = routes[name];
    const headers: Record<string, string> = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';

    if (route.auth !== 'public') {
      const token = await options.getAccessToken();
      if (!token) throw new ApiError('UNAUTHENTICATED', 401, 'Chưa đăng nhập');
      headers.authorization = `Bearer ${token}`;
    }
    const orgId = options.getOrganizationId?.();
    if (orgId) headers['x-organization-id'] = orgId;

    // Tham số `undefined` bị bỏ — không gửi `?cursor=undefined`.
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) search.set(key, String(value));
    }
    const qs = search.toString();

    // `/v1/links/:id/accept` → `/v1/links/<id>/accept`; thiếu tham số là lỗi của app, nổ ngay.
    const path = route.path.replace(/:([A-Za-z][A-Za-z0-9]*)/g, (_, key: string) => {
      const value = params?.[key];
      if (value === undefined) throw new Error(`Thiếu tham số đường dẫn ${key} cho ${route.path}`);
      return encodeURIComponent(value);
    });

    const res = await doFetch(`${options.baseUrl}${path}${qs ? `?${qs}` : ''}`, {
      method: route.method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) throw await readError(res);

    const parsed = route.response.safeParse(await res.json());
    if (!parsed.success) {
      throw new ApiError(
        'CONTRACT_MISMATCH',
        res.status,
        `Phản hồi của ${route.path} không khớp hợp đồng`,
        res.headers.get('x-request-id') ?? undefined,
      );
    }
    return parsed.data as RouteResponse<N>;
  };

  /** Route có thân request: kiểu của `body` lấy thẳng từ hợp đồng. */
  const send = <N extends RouteWithBody>(name: N, body: RouteBody<N>) => call(name, body);

  return {
    health: () => call('health'),
    me: () => call('me'),
    /** Ngay sau `supabase.auth.signUp` — bước "Bác là ai?". Gọi lại an toàn. */
    meBootstrap: (input: RouteBody<'meBootstrap'>) => send('meBootstrap', input),
    /** Trước `signInWithPassword`. Luôn trả một email — sai thì báo MỘT câu chung. */
    resolveIdentifier: (input: RouteBody<'resolveIdentifier'>) => send('resolveIdentifier', input),
    /** Đường OTP — tạm ẩn tới khi > 100 tổ chức trả phí. Cần `getOrganizationId`. */
    discoverLinks: () => call('linksDiscover'),
    /** Kết nối giữa tổ chức (BE4). Cần `getOrganizationId`. */
    links: {
      /** Cả hai phía: sổ của mình (`side: 'owner'`) và sổ bên kia nhắc tới mình (`side: 'linked'`). */
      list: () => call('linksList'),
      /**
       * Bên sổ mời một dòng danh bạ → `inviteCode` để đưa tận tay (hiện mã / QR). Gọi lại trả kết
       * nối đang có, kèm mã đang còn hạn hoặc mã mới.
       */
      invite: (input: RouteBody<'linksInvite'>) => send('linksInvite', input),
      /** Bên được mời nhập mã (gõ tay hoặc quét QR) → kết nối active ngay. `NOT_FOUND` = mã không dùng được. */
      claim: (input: RouteBody<'linksClaim'>) => send('linksClaim', input),
      /** Đường OTP (tạm ẩn): tìm các sổ có số của mình, tạo / nhận lời mời chờ đồng ý. */
      discover: () => call('linksDiscover'),
      /** Đường OTP (tạm ẩn): bên được liên kết đồng ý lời mời đã dò. `PHONE_NOT_VERIFIED` → màn OTP. */
      accept: (id: string) => call('linksAccept', undefined, undefined, { id }),
      /** Một trong hai bên huỷ — mất quyền xem ngay. */
      revoke: (id: string) => call('linksRevoke', undefined, undefined, { id }),
    },
    /** Phần sổ bên kia cho mình xem — chỉ trường in trên biên nhận (BE4). */
    linked: {
      /** Phiếu của một tổ chức đang kết nối, mới nhất trước. Gọi lại với `cursor` tới khi null. */
      receipts: (params: { readonly orgId: string; readonly cursor?: string; readonly limit?: number }) =>
        call('linkedReceipts', undefined, { orgId: params.orgId, cursor: params.cursor, limit: params.limit }),
      /** Công nợ với từng tổ chức đang kết nối. */
      balance: () => call('linkedBalance'),
    },
    /**
     * Đơn hàng & đặt lịch (BE5) — cần mạng. Mọi bước chuyển gửi kèm `version` đang thấy; bên kia
     * vừa đổi → `ApiError` `ORDER_STATE_CHANGED`: tải lại đơn (`get`) rồi làm lại.
     */
    orders: {
      /** Mới tạo trước. Gọi lại với `cursor` tới khi null. */
      list: (
        params: {
          readonly role?: RouteQuery<'ordersList'>['role'];
          readonly status?: RouteQuery<'ordersList'>['status'];
          readonly cursor?: string;
          readonly limit?: number;
        } = {},
      ) => call('ordersList', undefined, { role: params.role, status: params.status, cursor: params.cursor, limit: params.limit }),
      /** Chỉ với tổ chức đã kết nối đúng chiều — không thì `LINK_REQUIRED`. */
      create: (input: RouteBody<'ordersCreate'>) => send('ordersCreate', input),
      /** Một đơn kèm lịch sử. */
      get: (id: string) => call('orderGet', undefined, undefined, { id }),
      /** Bên nhận đơn. */
      accept: (id: string, input: RouteBody<'orderAccept'>) => call('orderAccept', input, undefined, { id }),
      /** Bên nhận đơn. */
      reject: (id: string, input: RouteBody<'orderReject'>) => call('orderReject', input, undefined, { id }),
      /** Bên mua; gọi lại khi đã hẹn để đổi lịch. */
      schedule: (id: string, input: RouteBody<'orderSchedule'>) => call('orderSchedule', input, undefined, { id }),
      /** Bên nào cũng được, khi đơn chưa hoàn thành. */
      cancel: (id: string, input: RouteBody<'orderCancel'>) => call('orderCancel', input, undefined, { id }),
    },
    /** Thông báo trong app (BE5). Hỏi khi mở app và mỗi 60 giây. */
    notifications: {
      list: (params: { readonly cursor?: string; readonly limit?: number } = {}) =>
        call('notificationsList', undefined, { cursor: params.cursor, limit: params.limit }),
      /** Bỏ trống `ids` = đánh dấu tất cả. Trả số còn chưa đọc. */
      read: (input: RouteBody<'notificationsRead'> = {}) => send('notificationsRead', input),
    },
    /** Sổ offline — chỉ vựa và doanh nghiệp. Cần `getOrganizationId` = tổ chức sở hữu sổ. */
    sync: {
      /**
       * Đẩy một lô op (theo `seq` tăng dần, tối đa `SYNC_PUSH_MAX_OPS`). Xoá khỏi hàng đợi các op
       * `applied`/`duplicate`; op `rejected` và mọi op sau nó giữ lại. Hết gói → `ApiError`
       * `PLAN_EXPIRED`: dừng lượt, giữ nguyên hàng đợi, không tính là một lần thử hỏng.
       */
      push: (input: SyncPushRequest) => call('syncPush', input),
      /** Kéo một trang. Gọi lại với `cursor` vừa nhận tới khi `hasMore` là false. */
      pull: (params: { readonly cursor?: string; readonly limit?: number } = {}) =>
        call('syncPull', undefined, { cursor: params.cursor, limit: params.limit }),
    },
  };
};

export type Client = ReturnType<typeof createClient>;
