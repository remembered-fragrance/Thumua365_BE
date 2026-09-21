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

| Lệnh | Làm gì |
|---|---|
| `npm run lint` | oxlint — cấm `any`, `console.log`, `!`… |
| `npm run typecheck` | `strict` + `noUncheckedIndexedAccess` cho mọi gói |
| `npm run boundaries` | `@mambo/core` không import gì ngoài chính nó |
| `npm run test` | Test mọi gói; `core` phải phủ ≥ 80% dòng |
| `npm run build` | ESM + CJS + `.d.ts` vào `dist/` của từng gói |

## Cấu trúc

```
packages/
├── core/        nghiệp vụ tính tiền thuần — 0 import ra ngoài; chạy ở trình duyệt và Node
└── contracts/   hợp đồng API bằng zod: mã lỗi, vai trò, ma trận quyền (sẽ thêm request/response)
docs/            kế hoạch, thông tin dự án, sơ đồ
```

Sắp có: `apps/api/` (NestJS, BE1), `packages/sdk/` (BE1), `prisma/` (BE2).

## Frontend dùng các gói này thế nào

Mỗi tag `v*` tạo một GitHub Release kèm file `.tgz` của từng gói. Repo frontend cài theo URL,
khoá đúng phiên bản:

```json
{
  "dependencies": {
    "@mambo/core": "https://github.com/remembered-fragrance/Thumua365_BE/releases/download/v0.1.0/mambo-core-0.1.0.tgz",
    "@mambo/contracts": "https://github.com/remembered-fragrance/Thumua365_BE/releases/download/v0.1.0/mambo-contracts-0.1.0.tgz",
    "zod": "^4.1.0"
  }
}
```

`core` xuất **từng file** là một đường dẫn, nên chuyển từ bản cũ chỉ là đổi tiền tố:
`@/core/calc` → `@mambo/core/calc`.

**Sửa `core` chỉ ở repo này.** Frontend cần đổi hàm tính tiền thì mở PR vào đây — một hàm
tính tiền phải cho ra đúng một con số ở cả trình duyệt lẫn server.

## Phát hành phiên bản mới

1. Nâng `version` của **mọi** gói trong `packages/*/package.json` lên cùng một số.
2. Ghi thay đổi vào `packages/contracts/CHANGELOG.md`.
3. `git tag v0.2.0 && git push origin v0.2.0` — workflow `release.yml` kiểm, build, đóng
   gói và tạo release. Tag không khớp version thì workflow dừng.

## Luật

- `packages/core`: không import thư viện ngoài, không Node built-in, không gói khác.
  dependency-cruiser chặn trong CI.
- `packages/contracts`: chỉ `zod` và `@mambo/core`. Trong `/v1` chỉ được **thêm**; mọi thay
  đổi một dòng trong CHANGELOG. PR vào `core` và `contracts` cần cả backend lẫn frontend duyệt.
- Commit theo bước: `BE0: …`, `BE1: …`. Không merge khi CI đỏ.
