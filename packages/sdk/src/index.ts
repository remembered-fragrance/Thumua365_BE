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
  type EventsTrackRequest,
  type RouteBody,
  type RouteName,
  type RouteQuery,
  type RouteQueryInput,
  type RouteResponse,
  type RouteWithBody,
  type SyncPushRequest,
} from '@mambo/contracts';

/**
 * Lỗi thật của Storage. Storage bản cũ trả HTTP 400 cho mọi lỗi và ghi mã thật trong thân
 * (`{ statusCode: "409" | "413" | "415" | "403", error, message }`) — chỉ đọc HTTP status thì ảnh trùng
 * (đã lên rồi) hay token hết hạn thành "ảnh hỏng", và app bỏ ảnh khỏi hàng đợi.
 */
const storageFailure = async (res: Response): Promise<{ readonly status: number; readonly reason: boolean }> => {
  const body = (await res.json().catch(() => null)) as { statusCode?: unknown; error?: unknown } | null;
  const inner = Number(body?.statusCode);
  return {
    status: Number.isInteger(inner) && inner >= 400 && inner < 600 ? inner : res.status,
    reason: typeof body?.error === 'string' && body.error !== '',
  };
};

/**
 * Chỉ ảnh hỏng THẬT mới là lỗi vĩnh viễn (B6): quá cỡ (413), sai loại (415), hay 400 có thân nêu lý do.
 * 401/403 (phiên, token hết hạn), 408, 429, 5xx và 400 không rõ lý do: hàng đợi ảnh giữ ảnh, thử lại sau.
 */
const storageErrorCode = ({ status, reason }: { readonly status: number; readonly reason: boolean }): ErrorCode => {
  if (status === 413) return 'PAYLOAD_TOO_LARGE';
  if (status === 415 || (status === 400 && reason)) return 'VALIDATION_FAILED';
  if (status === 401) return 'UNAUTHENTICATED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 429) return 'RATE_LIMITED';
  return 'INTERNAL';
};

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
    /** Huỷ lời gọi đang bay — `fetch` ném `AbortError` (DOMException), không bọc thành `ApiError`. */
    signal?: AbortSignal,
  ): Promise<RouteResponse<N>> => {
    const route = routes[name];
    const headers: Record<string, string> = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';

    if (route.auth !== 'public') {
      const token = await options.getAccessToken();
      if (!token) throw new ApiError('UNAUTHENTICATED', 401, 'Chưa đăng nhập');
      headers.authorization = `Bearer ${token}`;
    } else if ('optionalAuth' in route && route.optionalAuth) {
      // Route công khai nhận token NẾU có (đo lường — để gắn đúng tổ chức). Không có thì thôi.
      const token = await Promise.resolve(options.getAccessToken()).catch(() => null);
      if (token) headers.authorization = `Bearer ${token}`;
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
      ...(signal ? { signal } : {}),
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
    /** Ngay sau `supabase.auth.signUp` — bước "Bạn là ai?". Gọi lại an toàn. */
    meBootstrap: (input: RouteBody<'meBootstrap'>) => send('meBootstrap', input),
    /** Trước `signInWithPassword`. Luôn trả một email — sai thì báo MỘT câu chung. */
    resolveIdentifier: (input: RouteBody<'resolveIdentifier'>) => send('resolveIdentifier', input),
    /**
     * Quên mật khẩu (0.16.0) — không cần đăng nhập. Luôn `{ ok: true }`; thư có link
     * `/dat-lai-mat-khau?token_hash=…&type=recovery` tới email khôi phục ĐÃ XÁC NHẬN.
     * `EMAIL_UNAVAILABLE` khi máy chủ chưa gửi được thư.
     */
    requestPasswordReset: (input: RouteBody<'authPasswordReset'>) => send('authPasswordReset', input),
    /** Trang `/xac-nhan-email?token=…` — không cần đăng nhập. `email: null` = link hỏng / hết hạn. */
    confirmRecoveryEmail: (input: RouteBody<'authRecoveryEmailConfirm'>) => send('authRecoveryEmailConfirm', input),
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
    /**
     * Đo lường (BE9). Gọi từ hàng đợi `track()` của app, lô ≤ 50; token và tổ chức gửi nếu có. Sự
     * kiện sai hình dạng bị bỏ riêng (`dropped`), không làm hỏng lô — đừng gửi lại chúng.
     */
    events: {
      track: (input: EventsTrackRequest) => call('eventsTrack', input),
    },
    /** Ảnh chứng từ (BE8) — ảnh đi thẳng giữa app và Storage, API chỉ ký URL. */
    attachments: {
      uploadUrl: (input: RouteBody<'attachmentsUploadUrl'>) => send('attachmentsUploadUrl', input),
      /**
       * Xin URL rồi PUT ảnh lên. Ảnh đã lên từ lần trước (mất phản hồi) → Storage trả 409 → coi là
       * xong. Lỗi khác ném `ApiError`: `VALIDATION_FAILED` / `PAYLOAD_TOO_LARGE` là ảnh hỏng thật, còn lại
       * hàng đợi ảnh thử lại theo lịch giãn cách — xem `storageErrorCode`.
       */
      upload: async (attachmentId: string, image: Blob) => {
        const contentType = image.type as RouteBody<'attachmentsUploadUrl'>['contentType'];
        const target = await send('attachmentsUploadUrl', { attachmentId, contentType, size: image.size });
        const res = await doFetch(target.uploadUrl, { method: target.method, headers: target.headers, body: image });
        if (res.ok) return;
        const failure = await storageFailure(res);
        if (failure.status === 409) return;
        throw new ApiError(storageErrorCode(failure), failure.status, `Tải ảnh lên hỏng (HTTP ${failure.status})`);
      },
      /** URL xem ảnh, hết hạn sau `expiresAt`. Ảnh chưa lên → `NOT_FOUND`. */
      url: (id: string) => call('attachmentUrl', undefined, undefined, { id }),
    },
    /** Hồ sơ, mã giới thiệu, xoá tài khoản (BE6). */
    account: {
      profile: () => call('meProfile'),
      updateProfile: (patch: RouteBody<'meProfileUpdate'>) => send('meProfileUpdate', patch),
      /** Luôn trả `{ claimed }` — không cho biết vì sao mã không dùng được. */
      claimReferral: (input: RouteBody<'referralsClaim'>) => send('referralsClaim', input),
      /** Gửi (lại) thư xác nhận email khôi phục (0.16.0). Xem `status` để báo người dùng. */
      verifyRecoveryEmail: () => call('meRecoveryEmailVerify'),
      /**
       * Xoá THẬT. Còn người khác trong tổ chức mình là chủ → `VALIDATION_FAILED`,
       * `details.reason: 'ORG_HAS_MEMBERS'`. Xong thì xoá dấu vết trên máy và đăng xuất.
       */
      delete: () => call('meDelete'),
    },
    /** Gói và chuyển khoản (BE6) — chỉ màn của chủ (`billing:manage`). */
    billing: {
      subscription: () => call('meSubscription'),
      intents: () => call('billingIntentsList'),
      /** Chủ vựa định chuyển khoản: trả mã đối soát + nội dung chuyển khoản cho mã QR. */
      createIntent: (input: RouteBody<'billingIntentsCreate'>) => send('billingIntentsCreate', input),
    },
    /** Tổ chức đang làm việc, nhân viên và chi nhánh (BE7) — phần lớn là màn của chủ vựa / doanh nghiệp. */
    org: {
      /** Chỉ chủ đổi được tên — người khác `FORBIDDEN`. */
      update: (patch: RouteBody<'orgUpdate'>) => send('orgUpdate', patch),
      /** @deprecated 0.13.0 — luôn `FORBIDDEN`: người làm không tự rời, chỉ chủ gỡ ra (`members.remove`). */
      leave: () => call('orgLeave'),
      members: {
        list: () => call('orgMembersList'),
        /**
         * Chủ tạo tài khoản cho người cân / quản lý — người đó đăng nhập bằng số điện thoại và mật
         * khẩu này. Số đã có tài khoản ở nơi khác → `VALIDATION_FAILED`, `details.reason: 'ACCOUNT_EXISTS'`.
         */
        create: (input: RouteBody<'orgMembersCreate'>) => send('orgMembersCreate', input),
        update: (id: string, patch: RouteBody<'orgMemberUpdate'>) => call('orgMemberUpdate', patch, undefined, { id }),
        /** Mất quyền ngay. Gọi lại an toàn. */
        remove: (id: string) => call('orgMemberRemove', undefined, undefined, { id }),
      },
      branches: {
        list: () => call('orgBranchesList'),
        /** Vượt giới hạn của gói → `BRANCH_LIMIT`, `details.limit`. */
        create: (input: RouteBody<'orgBranchesCreate'>) => send('orgBranchesCreate', input),
        update: (id: string, patch: RouteBody<'orgBranchUpdate'>) => call('orgBranchUpdate', patch, undefined, { id }),
      },
    },
    /**
     * Bản đồ thu mua. Xem: mọi người đã đăng nhập. Đặt / sửa / gỡ: tổ chức đang làm việc, cần
     * `place:manage` (chủ vựa, chủ và quản lý doanh nghiệp).
     */
    places: {
      /**
       * Địa điểm trong khung nhìn — `bbox` là `minLng,minLat,maxLng,maxLat` (Leaflet
       * `getBounds().toBBoxString()`), `kinds` bỏ trống = cả hai. Kéo bản đồ liên tục thì truyền
       * `signal` để huỷ lời gọi cũ.
       */
      inView: (query: RouteQueryInput<'placesList'>, signal?: AbortSignal) =>
        call('placesList', undefined, { bbox: query.bbox, kinds: query.kinds }, undefined, signal),
      /** Một điểm đang hiện; đã gỡ → `NOT_FOUND`. */
      get: (id: string) => call('placeGet', undefined, undefined, { id }),
      /** Mọi điểm của tổ chức đang làm việc. */
      mine: () => call('orgPlacesList'),
      /** Vượt `PLACES_PER_ORG_LIMIT` → `VALIDATION_FAILED`, `details.reason: 'PLACE_LIMIT'`. */
      create: (input: RouteBody<'orgPlaceCreate'>) => send('orgPlaceCreate', input),
      update: (id: string, patch: RouteBody<'orgPlaceUpdate'>) => call('orgPlaceUpdate', patch, undefined, { id }),
      /** Gỡ khỏi bản đồ của mọi người. */
      remove: (id: string) => call('orgPlaceDelete', undefined, undefined, { id }),
    },
    /** Báo cáo tổng tính phía server (BE7). `from` gồm, `to` không gồm; tối đa 366 ngày. */
    reports: {
      summary: (params: { readonly from: string; readonly to: string; readonly branchId?: string }) =>
        call('reportsSummary', undefined, { from: params.from, to: params.to, branchId: params.branchId }),
      /** Việc của từng người (chỉ chủ — `staff:manage`): phiếu đã lập, lần trả đã ghi, lần làm gần nhất. */
      members: (params: { readonly from: string; readonly to: string }) =>
        call('reportsMembers', undefined, { from: params.from, to: params.to }),
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
