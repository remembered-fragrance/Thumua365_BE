# CHANGELOG — @mambo/contracts

Mỗi thay đổi hợp đồng một dòng. Trong `/v1` chỉ được **thêm**; bỏ hoặc đổi nghĩa là
thay đổi phá vỡ — thêm trường mới, đánh dấu cái cũ `deprecated` ít nhất một bản phát hành.

## 0.5.0 — chưa phát hành (BE4)

- `RouteDef.params` — tham số trên đường dẫn (`/v1/links/:id/accept`): server kiểm như thân
  request (`@ContractParams()`), SDK điền vào đường dẫn, openapi viết `{id}` + `in: path`. Kiểu
  tiện ích `RouteWithParams`, `RouteParams<N>`, hàm `pathParamNames`.
- `routes.linksList` — `GET /v1/links` → `LinksList { links: LinkSummary[] }`, cả hai phía
  (`side: owner | linked`), kèm tổ chức bên kia (`counterpart`).
- `routes.linksInvite` — `POST /v1/links/invite` (`partner:manage`), thân `LinkInviteInput
  { partnerKind, partnerId }` → `LinkSummary`. Idempotent. Dòng danh bạ không có SĐT → 422.
- `routes.linksAccept` — `POST /v1/links/:id/accept` (`linked:read`) → `LinkSummary`. Số đã xác
  thực OTP phải trùng số được mời, không thì `PHONE_NOT_VERIFIED`.
- `routes.linksRevoke` — `POST /v1/links/:id/revoke` → `LinkSummary`. Quyền theo phía.
- `routes.linkedReceipts` — `GET /v1/linked/receipts?orgId=&cursor=&limit=` (`linked:read`) →
  `LinkedReceiptsResult { receipts: LinkedReceipt[], cursor }`; chưa kết nối → `LINK_REQUIRED`.
- `routes.linkedBalance` — `GET /v1/linked/balance` (`linked:read`) → `LinkedBalance
  { items: [{ organization, theyOwe, youOwe, receiptCount, lastReceiptAt }] }`.
- Kiểu mới: `PartnerKind`, `LinkStatus`, `LinkSide`, `OrgRef`, `LinkedReceiptLine`.
- `/links/discover`: `created` giờ đếm cả lời mời của vựa vừa được nhận về. Hình dạng không đổi.
- `@mambo/sdk`: `links.list/discover/invite/accept/revoke`, `linked.receipts/balance`.

## 0.4.0 — 28/09/2026 (BE3)

- `routes.syncPush` — `POST /v1/sync/push` (`book:sync`), thân `SyncPushRequest`
  `{ deviceId, ops: SyncOp[] }` (1–`SYNC_PUSH_MAX_OPS` = 200 op, `seq` tăng dần, `opId` không
  trùng), trả `SyncPushResult` `{ results: [{ opId, status, error?, warning? }] }`. `status`:
  `applied | duplicate | rejected`; dừng ở op `rejected` đầu tiên — op sau không có trong
  `results`. `warning`: `RECORD_DELETED | ORDER_NOT_OPEN` (op đã nhận, không phải lỗi). Lỗi riêng
  `PLAN_EXPIRED` (402) cho cả lượt. Cổng chỉ kiểm vỏ (`SyncPushInput`); `data` kiểm theo từng op.
- `routes.syncPull` — `GET /v1/sync/pull?cursor=&limit=` (`book:sync`, `limit` 1–1000, mặc định
  500), trả `SyncPullResult` `{ cursor, hasMore, resetRequired, changes }`. `changes` có 8 danh
  sách `*Record`, gồm cả bản ghi đã xoá mềm.
- Hình dạng từng bản ghi (`sync-records.ts`): `PartyInsert/Patch/Record` (người bán, người mua),
  `Product*`, `PricingRule*`, `Note*`, `Draft*`, `Transaction*` (dòng phải đóng băng —
  `FrozenTransactionLine`), `PaymentInsert/Record` (không có patch). Khách lẻ =
  `counterpartyId: null`. Kiểu được kiểm lúc biên dịch là trùng `@mambo/core/types`.
- `SyncOp` (hình dạng đầy đủ), `SyncOpEnvelope`, `SYNC_ENTITIES` (cũng là thứ tự kéo về — lần
  trả tiền cuối), `SYNC_OP_DATA`, `SYNC_CHANGE_KEY`, `parseSyncOp` (kiểm một op — app dùng được
  trước khi đưa vào hàng đợi).
- `SYNC_PERMISSION` + `syncOpPermission(op)`: quyền của từng op ngoài `book:sync`. Tạo người
  bán/người mua/mặt hàng mới và sửa CHỈ giá gần nhất của mặt hàng cần `receipt:create` (người
  cân làm được); xoá phiếu `receipt:delete`; huỷ lần trả `payment:void`.
- `RouteDef` thêm `query?` (tham số query string, kiểm như thân request) và `docBody?` (thân như
  tài liệu mô tả khi `body` cố ý lỏng hơn). Kiểu tiện ích `RouteWithQuery`, `RouteQuery<N>`.
  `openapi.json`: tham số `in: query`.
- `@mambo/sdk`: `sync.push(input)`, `sync.pull({ cursor?, limit? })`; `call` dựng query string.
- `/v1/me/bootstrap`: vựa và doanh nghiệp mới có sẵn 4 mặt hàng mặc định (id UUID do server
  sinh). Hình dạng không đổi.

## 0.3.0 — 22/09/2026 (BE2)

- `routes.meBootstrap` — `POST /v1/me/bootstrap`, thân `MeBootstrapInput`
  (`orgType`, `orgName`, `name`, `phone?`, `username?`), trả `Me`. Idempotent.
- `routes.resolveIdentifier` — `POST /v1/auth/resolve-identifier` (công khai, 10 lần/phút/IP),
  thân `ResolveIdentifierInput`, trả `ResolveIdentifierResult` `{ email }`. **Luôn** trả một
  email, kể cả khi không có tài khoản — app luôn báo một câu chung khi đăng nhập hỏng.
- `routes.linksDiscover` — `POST /v1/links/discover` (`linked:read`), trả `LinksDiscoverResult`
  `{ created, pending }`; lỗi riêng `PHONE_NOT_VERIFIED`.
- `RouteDef` thêm `body?`, `rateLimitPerMinute?`, `errors?` (chỉ thêm, không đổi trường cũ).
  Kiểu tiện ích `RouteWithBody`, `RouteBody<N>`.
- `openapi.json`: `requestBody`, `x-error-codes`, `x-rate-limit-per-minute`; route có thân
  hoặc cần tổ chức khai báo 422.
- `/v1/me`: `memberships` và `pendingLinks` giờ là dữ liệu thật (trước đây luôn `[]` / `0`).
  Hình dạng không đổi.
- `@mambo/sdk`: `meBootstrap(input)`, `resolveIdentifier(input)`, `discoverLinks()`; `call` gửi
  thân JSON.

## 0.2.0 — 21/09/2026 (BE1)

- `ErrorCode` thêm `NOT_FOUND` (404) và `PAYLOAD_TOO_LARGE` (413) — cho đường dẫn lạ và thân
  request quá 1MB. Chỉ thêm, không đổi mã cũ.
- `routes`: danh bạ endpoint — `health` (công khai), `me` (cần đăng nhập). Controller, SDK
  và `openapi.json` cùng đọc từ đây.
- `Health`, `AppEnv`.
- `Me`, `MeUser`, `MeMembership`, `PlanSummary`, `Feature`, `SubscriptionStatus`,
  `PlanTier` — khớp KH backend §3.2. `SubscriptionStatus`/`PlanTier` được kiểm lúc biên dịch
  là trùng với `@mambo/core/subscription`.
- `openapi.json` (OpenAPI 3.1) đi kèm gói; sinh bằng `npm run openapi`.
- Gói mới **`@mambo/sdk`** 0.2.0: `createClient({ baseUrl, getAccessToken, getOrganizationId })`
  → `health()`, `me()`; lỗi là `ApiError` với `code` của hợp đồng; phản hồi sai hợp đồng →
  `CONTRACT_MISMATCH`.
- Import tương đối trong mọi gói có đuôi `.js`, để `.d.ts` dùng được cả với
  `moduleResolution: nodenext` (NestJS) lẫn `bundler` (Vite).

## 0.1.0 — 21/09/2026

- `ErrorCode` (12 mã), `ERROR_STATUS`, `ErrorBody`, `isRetryable` — KH backend §3.1.
- `OrgType` (`farmer | trader | enterprise`), `MemberRole` (`owner | manager | staff`),
  `hasBook` — KH backend §1.2.
- `Permission` (15 quyền), `PERMISSIONS_BY`, `permissionsOf`, `can` — ma trận KH backend §1.6.
