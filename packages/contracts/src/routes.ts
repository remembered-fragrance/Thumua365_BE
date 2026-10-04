/**
 * Danh bạ endpoint — nguồn duy nhất cho ba nơi:
 *   - NestJS: controller lấy `path` từ đây; interceptor kiểm phản hồi bằng `response`
 *   - SDK: `@mambo/sdk` gọi theo đúng `method` + `path` và kiểm lại phản hồi
 *   - OpenAPI: `openapi.json` sinh từ đây (`npm run openapi`)
 *
 * Thêm endpoint = thêm một dòng ở đây trước, rồi mới viết controller. Nhóm lớn tách ra file
 * `routes-<miền>.ts` rồi trải vào đây (`...orderRoutes`) — tên route vẫn là một không gian chung.
 */

import type { z } from 'zod';
import { AttachmentDownloadUrl, AttachmentIdParams, AttachmentUploadInput, AttachmentUploadUrl } from './attachments.js';
import { ResolveIdentifierInput, ResolveIdentifierResult } from './auth.js';
import { Health } from './health.js';
import {
  LinkedBalance,
  LinkedReceiptsQuery,
  LinkedReceiptsResult,
  LinkClaimInput,
  LinkIdParams,
  LinkInviteInput,
  LinksDiscoverResult,
  LinksList,
  LinkSummary,
} from './links.js';
import { Me, MeBootstrapInput } from './me.js';
import type { RouteDef } from './route-def.js';
import { accountRoutes } from './routes-account.js';
import { orderRoutes } from './routes-orders.js';
import { orgRoutes } from './routes-org.js';
import { SyncPullQuery, SyncPullResult, SyncPushInput, SyncPushRequest, SyncPushResult } from './sync.js';

export type { RouteAuth, RouteDef } from './route-def.js';

export const routes = {
  health: {
    method: 'GET',
    path: '/v1/health',
    summary: 'Trạng thái API',
    auth: 'public',
    response: Health,
  },
  me: {
    method: 'GET',
    path: '/v1/me',
    summary: 'Người đang đăng nhập, các tổ chức và quyền trong từng tổ chức',
    auth: 'user',
    response: Me,
  },
  meBootstrap: {
    method: 'POST',
    path: '/v1/me/bootstrap',
    summary: 'Sau khi đăng ký: tạo hồ sơ, tổ chức, vai trò chủ và gói dùng thử. Gọi lại không tạo thêm',
    auth: 'user',
    body: MeBootstrapInput,
    response: Me,
  },
  resolveIdentifier: {
    method: 'POST',
    path: '/v1/auth/resolve-identifier',
    summary: 'Tên tài khoản / SĐT / email → email để đăng nhập. Luôn trả một email',
    auth: 'public',
    body: ResolveIdentifierInput,
    response: ResolveIdentifierResult,
    rateLimitPerMinute: 10,
  },
  linksDiscover: {
    method: 'POST',
    path: '/v1/links/discover',
    summary:
      'Dò các sổ có đối tác mang số điện thoại đã xác thực OTP của người gọi, tạo lời mời chờ đồng ý. Tạm ẩn — OTP mở lại khi > 100 tổ chức trả phí',
    auth: 'org',
    permission: 'linked:read',
    response: LinksDiscoverResult,
    errors: ['PHONE_NOT_VERIFIED'],
  },
  linksList: {
    method: 'GET',
    path: '/v1/links',
    summary: 'Các kết nối của tổ chức đang làm việc, cả hai phía (sổ của mình / sổ bên kia). Cần linked:read hoặc partner:manage',
    auth: 'org',
    response: LinksList,
  },
  linksInvite: {
    method: 'POST',
    path: '/v1/links/invite',
    summary:
      'Mời một dòng danh bạ kết nối — kèm mã kết nối (inviteCode) để đưa tận tay. Gọi lại trả kết nối đang có; mã hết hạn thì cấp mã mới',
    auth: 'org',
    permission: 'partner:manage',
    body: LinkInviteInput,
    response: LinkSummary,
    errors: ['NOT_FOUND'],
  },
  linksClaim: {
    method: 'POST',
    path: '/v1/links/claim',
    summary:
      'Bên được mời nhập mã kết nối (gõ tay hoặc quét QR) → kết nối active ngay. Mã sai, đã dùng hay hết hạn đều trả cùng một lỗi',
    auth: 'org',
    permission: 'linked:read',
    body: LinkClaimInput,
    response: LinkSummary,
    rateLimitPerMinute: 10,
    errors: ['NOT_FOUND'],
  },
  linksAccept: {
    method: 'POST',
    path: '/v1/links/:id/accept',
    summary:
      'Bên được liên kết đồng ý lời mời đã dò được — cần số điện thoại đã xác thực OTP trùng số được mời. Gọi lại an toàn. Tạm ẩn cùng OTP',
    auth: 'org',
    permission: 'linked:read',
    params: LinkIdParams,
    response: LinkSummary,
    errors: ['PHONE_NOT_VERIFIED', 'NOT_FOUND'],
  },
  linksRevoke: {
    method: 'POST',
    path: '/v1/links/:id/revoke',
    summary: 'Một trong hai bên huỷ kết nối — mất quyền xem ngay. Phía sổ cần partner:manage, phía được xem cần linked:read',
    auth: 'org',
    params: LinkIdParams,
    response: LinkSummary,
    errors: ['NOT_FOUND'],
  },
  linkedReceipts: {
    method: 'GET',
    path: '/v1/linked/receipts',
    summary: 'Phiếu trong sổ của một tổ chức đang kết nối có nhắc tới mình — chỉ trường in trên biên nhận. Mới nhất trước',
    auth: 'org',
    permission: 'linked:read',
    query: LinkedReceiptsQuery,
    response: LinkedReceiptsResult,
    errors: ['LINK_REQUIRED'],
  },
  linkedBalance: {
    method: 'GET',
    path: '/v1/linked/balance',
    summary: 'Công nợ với từng tổ chức đang kết nối: họ còn nợ mình / mình còn nợ họ',
    auth: 'org',
    permission: 'linked:read',
    response: LinkedBalance,
  },
  ...orderRoutes,
  ...orgRoutes,
  ...accountRoutes,
  attachmentsUploadUrl: {
    method: 'POST',
    path: '/v1/attachments/upload-url',
    summary: 'URL có chữ ký để PUT một ảnh chứng từ thẳng lên Storage. Không ghi đè: PUT lại ảnh đã lên → 409, coi là xong',
    auth: 'org',
    permission: 'receipt:create',
    body: AttachmentUploadInput,
    response: AttachmentUploadUrl,
  },
  attachmentUrl: {
    method: 'GET',
    path: '/v1/attachments/:id/url',
    summary: 'URL có hạn để xem một ảnh mà phiếu / nháp mình được thấy đang nhắc tới. Chưa lên Storage → 404',
    auth: 'org',
    permission: 'book:sync',
    params: AttachmentIdParams,
    response: AttachmentDownloadUrl,
    errors: ['NOT_FOUND'],
  },
  syncPush: {
    method: 'POST',
    path: '/v1/sync/push',
    summary:
      'Đẩy các thao tác ghi sổ trong hàng đợi của máy lên, tuần tự theo seq, mỗi op một transaction. Dừng ở op bị từ chối đầu tiên',
    auth: 'org',
    permission: 'book:sync',
    body: SyncPushInput,
    docBody: SyncPushRequest,
    response: SyncPushResult,
    errors: ['PLAN_EXPIRED'],
  },
  syncPull: {
    method: 'GET',
    path: '/v1/sync/pull',
    summary: 'Kéo thay đổi của sổ về theo cursor do server cấp, gồm cả bản ghi đã xoá mềm. Gọi tới khi hasMore = false',
    auth: 'org',
    permission: 'book:sync',
    query: SyncPullQuery,
    response: SyncPullResult,
  },
} as const satisfies Record<string, RouteDef>;

export type RouteName = keyof typeof routes;
export type RouteResponse<N extends RouteName> = z.infer<(typeof routes)[N]['response']>;

/** Tên các route có thân request. */
export type RouteWithBody = {
  [N in RouteName]: (typeof routes)[N] extends { body: z.ZodType } ? N : never;
}[RouteName];

/** Thân request mà client gửi (trước khi server chuẩn hoá: trim, chữ thường…). */
export type RouteBody<N extends RouteWithBody> = (typeof routes)[N] extends { body: infer B extends z.ZodType }
  ? z.input<B>
  : never;

/** Tên các route có tham số query. */
export type RouteWithQuery = {
  [N in RouteName]: (typeof routes)[N] extends { query: z.ZodType } ? N : never;
}[RouteName];

/** Tham số query sau khi server đã kiểm và ép kiểu. */
export type RouteQuery<N extends RouteWithQuery> = (typeof routes)[N] extends { query: infer Q extends z.ZodType }
  ? z.output<Q>
  : never;

/** Tên các route có tham số đường dẫn. */
export type RouteWithParams = {
  [N in RouteName]: (typeof routes)[N] extends { params: z.ZodType } ? N : never;
}[RouteName];

/** Tham số đường dẫn (`:id`…) mà client điền. */
export type RouteParams<N extends RouteWithParams> = (typeof routes)[N] extends { params: infer P extends z.ZodType }
  ? z.input<P>
  : never;

/** `/v1/links/:id/accept` → `['id']`. */
export const pathParamNames = (path: string): string[] => [...path.matchAll(/:([A-Za-z][A-Za-z0-9]*)/g)].map((m) => m[1] ?? '');
