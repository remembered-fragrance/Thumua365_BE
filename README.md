# Thumua365_BE

Backend của **Mambo365 / THUMUA365**: nền tảng ba vai trò (nông dân · thương lái / vựa /
đại lý · doanh nghiệp) trên một chuỗi nông sản.

| Đọc gì | Khi nào |
|---|---|
| [`docs/THONG_TIN_DU_AN.md`](docs/THONG_TIN_DU_AN.md) | **Đầu tiên.** Sản phẩm, ba vai trò, kiến trúc, quyết định đã chốt |
| [`docs/BE-backend-nestjs.md`](docs/BE-backend-nestjs.md) | Kế hoạch backend BE0 → BE10, hợp đồng API, đồng bộ offline |
| [`docs/so-do-kien-truc-v2.html`](docs/so-do-kien-truc-v2.html) | Sơ đồ kiến trúc v2 (mở bằng trình duyệt) |
| [`MEMORY.md`](MEMORY.md) | Nhật ký: đã làm gì, quyết gì, vì sao, còn treo gì — đọc trước khi bắt đầu bước mới |

Frontend ở repo riêng: `mambo365_deploymentphase`.

## Chạy

Cần Node ≥ 22.

```bash
npm install
npm run verify
```

Chạy API trên máy (trỏ vào Supabase staging):

```bash
cp apps/api/.env.example apps/api/.env
npm run dev
```

Điền `SUPABASE_PUBLISHABLE_KEY` trong `apps/api/.env` (Supabase → Project Settings → API Keys;
khoá *publishable* là công khai). API ở `http://localhost:3000/v1/health`.

| Lệnh | Làm gì |
|---|---|
| `npm run lint` | oxlint — cấm `any`, `console.log`, `!`… |
| `npm run build:packages` | Build `core` → `contracts` → `sdk` (API và typecheck cần bước này trước) |
| `npm run typecheck` | `strict` + `noUncheckedIndexedAccess` cho mọi gói |
| `npm run boundaries` | `core` không import gì ngoài chính nó; gói dùng chung không kéo code API |
| `npm run test` | Test mọi gói; `core` phải phủ ≥ 80% dòng; `openapi.json` phải khớp hợp đồng |
| `npm run openapi` | Sinh lại `packages/contracts/openapi.json` sau khi đổi `routes` |
| `npm run mock` | Server giả từ `openapi.json` (Prism) cho frontend làm trước khi API xong |
| `npm run dev` | API chạy lại khi sửa code |

## Cấu trúc

```
apps/
└── api/         NestJS 11 — guard JWT/tổ chức/quyền, định dạng lỗi, /v1/health, /v1/me, Dockerfile
packages/
├── core/        nghiệp vụ tính tiền thuần — 0 import ra ngoài; chạy ở trình duyệt và Node
├── contracts/   hợp đồng API bằng zod: mã lỗi, vai trò, ma trận quyền, danh bạ routes, openapi.json
└── sdk/         client có kiểu cho frontend, gọi theo đúng routes của contracts
docs/            kế hoạch, thông tin dự án, sơ đồ
render.yaml      cấu hình Render (staging)
```

Sắp có: `prisma/` (BE2).

## Thêm một endpoint

1. Thêm một dòng vào `routes` trong `packages/contracts/src/routes.ts` (+ schema phản hồi).
2. `npm run openapi` → commit `openapi.json` cùng PR.
3. Controller: `@Endpoint(routes.tenMoi)` — không tự gõ đường dẫn.
4. SDK: thêm một hàm gọi `call('tenMoi')`.
5. Ghi một dòng vào `packages/contracts/CHANGELOG.md`.

## Frontend dùng các gói này thế nào

Mỗi tag `v*` tạo một GitHub Release kèm file `.tgz` của từng gói. Repo frontend cài theo URL,
khoá đúng phiên bản:

```json
{
  "dependencies": {
    "@mambo/core": "https://github.com/remembered-fragrance/Thumua365_BE/releases/download/v0.2.0/mambo-core-0.2.0.tgz",
    "@mambo/contracts": "https://github.com/remembered-fragrance/Thumua365_BE/releases/download/v0.2.0/mambo-contracts-0.2.0.tgz",
    "@mambo/sdk": "https://github.com/remembered-fragrance/Thumua365_BE/releases/download/v0.2.0/mambo-sdk-0.2.0.tgz",
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
3. `git tag v0.2.0 && git push origin v0.2.0` — workflow `release.yml` kiểm, build, đóng
   gói và tạo release. Tag không khớp version thì workflow dừng.

## Luật

- `packages/core`: không import thư viện ngoài, không Node built-in, không gói khác.
  dependency-cruiser chặn trong CI.
- `packages/contracts`: chỉ `zod` và `@mambo/core`. Trong `/v1` chỉ được **thêm**; mọi thay
  đổi một dòng trong CHANGELOG. PR vào `core` và `contracts` cần cả backend lẫn frontend duyệt.
- Commit theo bước: `BE0: …`, `BE1: …`. Không merge khi CI đỏ.
