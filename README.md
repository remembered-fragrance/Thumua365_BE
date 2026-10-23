# Thumua365_BE

Backend của **Mambo365 / THUMUA365**: nền tảng ba vai trò (nông dân · thương lái / vựa /
đại lý · doanh nghiệp) trên một chuỗi nông sản.

| Đọc gì | Khi nào |
|---|---|
| [`docs/THONG_TIN_DU_AN.md`](docs/THONG_TIN_DU_AN.md) | **Đầu tiên.** Sản phẩm, ba vai trò, kiến trúc, quyết định đã chốt |
| [`docs/BE-backend-nestjs.md`](docs/BE-backend-nestjs.md) | Kế hoạch backend BE0 → BE10, hợp đồng API, đồng bộ offline |
| [`docs/so-do-kien-truc-v2.html`](docs/so-do-kien-truc-v2.html) | Sơ đồ kiến trúc v2 (mở bằng trình duyệt) |
| [`docs/FRONTEND.md`](docs/FRONTEND.md) | **Người làm frontend đọc file này.** Cài gì, gọi gì, luật nào, từng bước BE frontend làm gì |
| [`MEMORY.md`](MEMORY.md) | Nhật ký: đã làm gì, quyết gì, vì sao, còn treo gì — đọc trước khi bắt đầu bước mới |
| [`packages/contracts/CHANGELOG.md`](packages/contracts/CHANGELOG.md) | Hợp đồng đổi gì ở từng phiên bản, deploy API hay app trước |
| [`ops/PRODUCTION.md`](ops/PRODUCTION.md) · [`ops/README.md`](ops/README.md) | Bảng kiểm vận hành (đã xong / còn thiếu), backup, giám sát |
| [`docs/DE_XUAT_C2_C3.md`](docs/DE_XUAT_C2_C3.md) | Hai đề xuất chờ chủ dự án duyệt (giới hạn chi nhánh, đăng nhập qua API) |

Frontend ở repo riêng: `mambo365_deploymentphase`. Hướng dẫn khớp với backend:
[`docs/FRONTEND.md`](docs/FRONTEND.md).

## Chạy

Cần Node ≥ 22.

```bash
npm install
npm run verify
```

Postgres ở máy (Docker Desktop — cùng bản Supabase: Postgres 17 + PostGIS, cổng 54329):

```bash
npm run db:reset      # xoá sạch, dựng lại, chạy mọi migration
npm run test:db       # test tích hợp: RLS, quyền, API trên database thật
```

Chạy API trên máy (trỏ vào Supabase staging):

```bash
cp apps/api/.env.example apps/api/.env
npm run dev
```

Điền `apps/api/.env` theo chú thích trong file (publishable key, secret key, `DIRECT_URL`;
`DATABASE_URL` do `npm run db:role-password -w @mambo/api` ghi). API ở
`http://localhost:3000/v1/health`.

| Lệnh | Làm gì |
|---|---|
| `npm run verify` | Đủ bước CI `verify`: lint → `security:check` → build gói → typecheck → boundaries → test → build API |
| `npm run lint` | oxlint — cấm `any`, `console.log`, `!`… |
| `npm run security:check` | Rà lộ khoá trong file git đang theo dõi: `.env`, khoá secret Supabase, JWT `service_role`, khoá AWS / R2, khoá riêng, chuỗi kết nối Postgres có mật khẩu thật. Chỉ in tệp:dòng |
| `npm run build:packages` | Build `core` → `contracts` → `sdk` (API và typecheck cần bước này trước) |
| `npm run typecheck` | `strict` + `noUncheckedIndexedAccess` cho mọi gói |
| `npm run boundaries` | `core` không import gì ngoài chính nó; gói dùng chung không kéo code API |
| `npm run test` | Test mọi gói; `core` phải phủ ≥ 80% dòng; `openapi.json` phải khớp hợp đồng |
| `npm run db:up` / `db:reset` | Postgres ở máy bằng `docker-compose.yml` (reset = xoá sạch + chạy migration) |
| `npm run db:down -w @mambo/api` · `db:migrate:local -w @mambo/api` | Tắt Postgres ở máy · chạy migration mới mà không xoá dữ liệu |
| `npm run db:role-password -w @mambo/api -- --role <role>` | Đặt mật khẩu ngẫu nhiên cho `api_service` / `api_privileged` / `backup_reader` và ghi chuỗi kết nối vào `apps/api/.env` |
| `npm run test:db` | Test tích hợp trên Postgres thật — RLS, quyền của `api_service`, API chạy trên DB. **Xoá sạch** dữ liệu DB máy dev (`truncateAll`) |
| `npm run openapi` | Sinh lại `packages/contracts/openapi.json` sau khi đổi `routes` |
| `npm run mock` | Server giả từ `openapi.json` (Prism) cho frontend làm trước khi API xong |
| `npm run dev` | API chạy lại khi sửa code |
| `npm run smoke:me` | Kiểm `/v1/me` trên staging bằng một tài khoản thật — bạn tự gõ email/mật khẩu, không in ra đâu cả |
| `npm run smoke:links` | Nghiệm thu BE4 trên staging bằng hai tài khoản thật (vựa + nông dân): ghi phiếu nợ → mời lấy mã → nông dân nhập mã → đúng phiếu, đúng nợ → mã dùng một lần → huỷ là mất quyền. Bạn tự gõ tài khoản; cần `build:packages` trước |
| `npm run smoke:orders` | Nghiệm thu BE5 (luồng R2): nông dân tạo đơn → vựa nhận, hẹn lịch → phiếu theo đơn → đơn tự `fulfilled`. Cũng dùng hai tài khoản thật bạn tự gõ |
| `npm run login-test` | Trang thử ở http://localhost:5174 — đủ luồng tài khoản trên staging: đăng ký, "Bạn là ai?", đăng nhập một ô, nhập mã kết nối (OTP tạm ẩn), qua `@mambo/sdk` (cần `build:packages` trước). `/sync.html?may=A` và `?may=B`: thử đồng bộ sổ hai máy, mời kết nối lấy mã |

## Cấu trúc

```
apps/
└── api/         NestJS 11 — guard JWT/tổ chức/quyền, định dạng lỗi, Dockerfile
    ├── prisma/  schema.prisma + migrations (Prisma Migrate là nơi duy nhất sửa schema)
    ├── src/db/  cửa duy nhất vào Postgres: mỗi request một transaction có ngữ cảnh RLS
    ├── src/sync/ đồng bộ sổ offline: /sync/push (mỗi op một transaction), /sync/pull (cursor)
    └── src/…    me, auth, links, orders, notifications, org, reports, billing, account, admin,
                 attachments, storage, events, analytics, metrics, mail, places, audit, health
packages/
├── core/        nghiệp vụ tính tiền thuần — 0 import ra ngoài; chạy ở trình duyệt và Node
├── contracts/   hợp đồng API bằng zod: mã lỗi, vai trò, ma trận quyền, danh bạ routes, openapi.json
└── sdk/         client có kiểu cho frontend, gọi theo đúng routes của contracts
docs/            kế hoạch, thông tin dự án, sơ đồ, hướng dẫn frontend, đề xuất chờ duyệt
ops/             vận hành: bảng kiểm lên production, backup / phục hồi, dashboard Grafana
scripts/         smoke test trên staging, rà lộ khoá
tools/login-test/ trang thử luồng tài khoản + đồng bộ hai máy
docker-compose.yml  Postgres cho máy dev và CI
render.yaml      cấu hình Render (staging — hiện cũng là API mà app web thật đang gọi)
```

## Database

- **Role:** migration chạy bằng `postgres` (`DIRECT_URL`); API chạy bằng `api_service`
  (`DATABASE_URL`) — role này **không** bypass RLS, không có quyền `DELETE`, và chỉ sửa được
  cột `deleted_at` của `payments`. `api_privileged` (`PRIVILEGED_DATABASE_URL`) chỉ dùng cho
  webhook ngân hàng, quản trị, xoá tài khoản (BE6); `backup_reader` chỉ đọc, cho `pg_dump`
  (BE10, `ops/backup/`).
- **Mọi truy vấn** đi qua `Database.scoped({ userId, orgId }, tx => …)`: một transaction,
  `app.user_id`/`app.org_id` đặt bằng `set_config(…, true)`. Quên lọc `orgId` vẫn chỉ thấy
  dữ liệu của tổ chức đó.
- **Đổi schema:** sửa `schema.prisma` → sinh SQL bằng `prisma migrate diff` → thêm phần viết
  tay (CHECK, RLS, quyền, trigger) vào cùng file migration → `npm run db:reset && npm run
  test:db`. CI đỏ nếu `schema.prisma` và migration lệch nhau.
- **Bảng mới** phải có trong cùng migration: `enable row level security`, policy, và `grant`
  cho `api_service` — mặc định không ai đọc được.
- **Khoá ngoại giữa hai bảng của cùng tổ chức là khoá GHÉP** `(x_id, organization_id)`: khoá
  ngoại được Postgres kiểm không qua RLS, khoá một cột để tổ chức này trỏ vào bản ghi của tổ
  chức khác.
- Bản ghi sổ đã xoá mềm **không khôi phục được** (trigger `keep_soft_deleted`, BE3).

## Thêm một endpoint

1. Thêm một dòng vào `routes` trong `packages/contracts/src/routes.ts` (+ schema thân request
   `body`, tham số `query`, tham số đường dẫn `params` — `:id` trong `path` — nếu có, + schema
   phản hồi). Tất cả được kiểm tự động trước khi vào handler; handler đọc bản đã kiểm bằng
   `@Body()`, `@ContractQuery()`, `@ContractParams()`.
2. `npm run openapi` → commit `openapi.json` cùng PR.
3. Controller: `@Endpoint(routes.tenMoi)` — không tự gõ đường dẫn.
4. SDK: thêm một hàm gọi `call('tenMoi')`.
5. Ghi một dòng vào `packages/contracts/CHANGELOG.md`.
6. Frontend phải làm gì mới → sửa [`docs/FRONTEND.md`](docs/FRONTEND.md) trong cùng PR.

## Frontend dùng các gói này thế nào

Bản đầy đủ (luồng tài khoản, lỗi, đồng bộ, lộ trình từng bước): [`docs/FRONTEND.md`](docs/FRONTEND.md).

Mỗi tag `v*` tạo một GitHub Release kèm file `.tgz` của từng gói. Repo frontend cài theo URL,
khoá đúng phiên bản:

```json
{
  "dependencies": {
    "@mambo/core": "https://github.com/remembered-fragrance/Thumua365_BE/releases/download/v0.20.1/mambo-core-0.20.1.tgz",
    "@mambo/contracts": "https://github.com/remembered-fragrance/Thumua365_BE/releases/download/v0.20.1/mambo-contracts-0.20.1.tgz",
    "@mambo/sdk": "https://github.com/remembered-fragrance/Thumua365_BE/releases/download/v0.20.1/mambo-sdk-0.20.1.tgz",
    "zod": "^4.1.0"
  }
}
```

`core` xuất **từng file** là một đường dẫn, nên chuyển từ bản cũ chỉ là đổi tiền tố:
`@/core/calc` → `@mambo/core/calc`.

Gọi API qua SDK, không `fetch` tay:

```ts
import { ApiError, createClient } from '@mambo/sdk';

const api = createClient({
  baseUrl: import.meta.env.VITE_API_URL,
  getAccessToken: async () => (await supabase.auth.getSession()).data.session?.access_token ?? null,
  getOrganizationId: () => currentOrgId,
});

try {
  const me = await api.me();
} catch (err) {
  if (err instanceof ApiError && err.code === 'PLAN_EXPIRED') { /* … */ }
}
```

**Sửa `core` chỉ ở repo này.** Frontend cần đổi hàm tính tiền thì mở PR vào đây — một hàm
tính tiền phải cho ra đúng một con số ở cả trình duyệt lẫn server.

## Phát hành phiên bản mới

1. Nâng `version` của **mọi** gói (`packages/*`, `apps/api`, gốc) lên cùng một số.
2. Ghi thay đổi vào `packages/contracts/CHANGELOG.md`.
3. `git tag vX.Y.Z && git push origin vX.Y.Z` — workflow `release.yml` kiểm, build, đóng
   gói và tạo release. Tag không khớp version thì workflow dừng.

## Luật

- `packages/core`: không import thư viện ngoài, không Node built-in, không gói khác.
  dependency-cruiser chặn trong CI.
- `packages/contracts`: chỉ `zod` và `@mambo/core`. Trong `/v1` chỉ được **thêm**; mọi thay
  đổi một dòng trong CHANGELOG. PR vào `core` và `contracts` cần cả backend lẫn frontend duyệt.
- Commit theo bước: `BE0: …`, `BE1: …` (BE0 → BE10); sau đó tiêu đề nói việc, ví dụ `Đợt 2: …`,
  `MEMORY: …`. Không merge khi CI đỏ. Migration lên staging **trước** khi merge code cần nó.
