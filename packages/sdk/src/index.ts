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

import { ErrorBody, routes, type ErrorCode, type RouteName, type RouteResponse } from '@mambo/contracts';

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

  const call = async <N extends RouteName>(name: N): Promise<RouteResponse<N>> => {
    const route = routes[name];
    const headers: Record<string, string> = { accept: 'application/json' };

    if (route.auth !== 'public') {
      const token = await options.getAccessToken();
      if (!token) throw new ApiError('UNAUTHENTICATED', 401, 'Chưa đăng nhập');
      headers.authorization = `Bearer ${token}`;
    }
    const orgId = options.getOrganizationId?.();
    if (orgId) headers['x-organization-id'] = orgId;

    const res = await doFetch(`${options.baseUrl}${route.path}`, { method: route.method, headers });
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

  return {
    health: () => call('health'),
    me: () => call('me'),
  };
};

export type Client = ReturnType<typeof createClient>;
