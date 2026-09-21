# CHANGELOG — @mambo/contracts

Mỗi thay đổi hợp đồng một dòng. Trong `/v1` chỉ được **thêm**; bỏ hoặc đổi nghĩa là
thay đổi phá vỡ — thêm trường mới, đánh dấu cái cũ `deprecated` ít nhất một bản phát hành.

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
