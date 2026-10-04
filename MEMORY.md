# MEMORY — nhật ký thi công backend THUMUA365

Sổ ghi **đã làm gì, quyết gì, vì sao**. Đọc file này trước khi bắt đầu một bước mới hoặc
khi quay lại dự án sau một thời gian nghỉ.

- Kế hoạch (sẽ làm gì) → [`docs/BE-backend-nestjs.md`](docs/BE-backend-nestjs.md)
- Tổng quan, quyết định đã chốt → [`docs/THONG_TIN_DU_AN.md`](docs/THONG_TIN_DU_AN.md)
- Nhật ký (đã làm gì) → **file này**

Ghi thêm một mục mỗi khi xong một bước. Không xoá mục cũ. Nhật ký giai đoạn A→G (bản
frontend cũ) nằm ở `MEMORY.md` của repo frontend.

---

## Bối cảnh

| | |
|---|---|
| Repo | `C:\Users\nino\Desktop\Thumua365_BE` — [github](https://github.com/remembered-fragrance/Thumua365_BE), nhánh `master` |
| Repo frontend | `C:\Users\nino\Desktop\mambo365deployment` — `mambo365_deploymentphase`, nhánh `master` |
| Người làm | Tài (backend, ghép cặp với AI) · một thành viên khác làm frontend |
| Trạng thái sản phẩm | BE0–BE4 xong (`v0.5.0`), chạy trên staging (Render + Supabase) — kết nối bằng **mã kết nối**, OTP tạm ẩn (01/10) · **BE5, BE7, BE6, BE8 đang làm** (gom từ nhánh `be/nestjs-be10`, chưa lên staging) · chỉ có tài khoản thử, **chưa có dữ liệu thật** · **backend làm trước, frontend làm sau** (28/09) |

---

## 21/09/2026 — Chuyển hướng sang kiến trúc ba vai trò + NestJS

**Kết quả:** kiến trúc v2 đã chốt, kế hoạch BE0 → BE10.

### Làm gì

- Đối chiếu sơ đồ kiến trúc mới của nhóm với repo frontend. Kết luận: giữ được ~75–80% code
  frontend; `core/` giữ 100%; `features/` và `components/` không gọi Supabase trực tiếp
  nên chỉ `src/data/` phải đổi.
- Vẽ lại sơ đồ thành **kiến trúc v2** ([`docs/so-do-kien-truc-v2.html`](docs/so-do-kien-truc-v2.html)),
  sửa ba chỗ sơ đồ gốc lệch thực tế: database nằm **ngoài** NestJS (là Postgres của
  Supabase); app gọi **thẳng** Supabase Auth và Storage; đồng bộ sổ đi **qua** NestJS.
- Viết kế hoạch backend, rồi sửa hai lần: lần 1 thêm ba vai trò, lần 2 đối chiếu lại với
  kiến trúc đã chốt.

### Quyết định đã chốt

| # | Quyết định | Vì sao |
|---|---|---|
| 1 | Hai trục: `organizations.type` (`farmer\|trader\|enterprise`) và `memberships.role` (`owner\|manager\|staff`). Mọi chủ thể là một tổ chức | Gộp vào một cột `role` thì doanh nghiệp không có nhân viên, vựa không thuê người cân được |
| 2 | Nông dân miễn phí · vựa 149.000đ/tháng · DN theo số chi nhánh. Đơn và kết nối miễn phí cho mọi bên | Nông dân kết nối càng nhiều, vựa càng khó bỏ app |
| 3 | Đồng bộ sổ **qua NestJS**: `/sync/push` + `/sync/pull`, cursor do server cấp | Chỉ server kiểm được quyền từng thao tác và chuyển đơn sang hoàn thành trong cùng transaction |
| 4 | **OTP SMS + bấm đồng ý** trước khi kết nối nông dân ↔ vựa | Không có OTP, ai cũng đăng ký bằng số người khác để xem công nợ của họ |
| 5 | **Bỏ lệnh rút tiền** | Giữ tiền hộ rồi chi ra là trung gian thanh toán, cần giấy phép NHNN |
| 6 | **zod** thay class-validator | Một schema dùng chung cho backend và frontend |
| 7 | RLS theo phiên (`app.org_id`), role `api_service` **không** bypass RLS | Bắt đúng lỗi "repository quên lọc `orgId`"; RLS kiểu cũ theo `auth.uid()` không dùng được với Prisma |
| 8 | Bỏ cờ `VITE_SYNC_BACKEND` | Đường "đồng bộ thẳng Supabase" chưa từng chạy ở production — không có gì để lùi về |
| 9 | Winston · event bus nội bộ · audit log · backup hai lớp · Realtime để giai đoạn 2 | Theo sơ đồ, thu nhỏ cho quy mô pilot |

### Lỗi thật tìm ra khi đọc code frontend (sẽ sửa ở BE3)

1. **Huỷ một lần trả ở máy A không bao giờ tới máy B.** Bảng `payments` không có
   `updated_at`, `pullChanges.ts` kéo payments theo `created_at` — xoá mềm không đổi
   `created_at` nên không bao giờ được kéo lại.
2. **Mốc đồng bộ lấy giờ máy khách** (`startedAt` trong `sync.ts`) — máy lệch giờ là bỏ sót
   thay đổi. Sửa bằng cursor do server cấp, chồng lấn 5 giây.
3. **Payment mồ côi khi phân trang**: `mergeTransactions` bỏ qua payment chưa có phiếu cha
   (`if (!tx) continue`), cursor đã trôi qua ⇒ mất khoản trả. Sửa bằng luật "payment trong
   trang thì phiếu cha có ở trang này hoặc trang trước".

---

## BE0 — Dựng repo backend · `532710e` · tag `v0.1.0` · 21/09/2026

**Kết quả:** repo backend chạy CI xanh; frontend cài được `@mambo/core`, `@mambo/contracts`
từ GitHub Release.

### Làm gì

- npm workspaces: `packages/core`, `packages/contracts`.
- `packages/core`: chép **nguyên** `src/core/` + `tests/core/` từ repo frontend; chỉ đổi
  import của test `@/core/x` → `../src/x`. Không sửa một dòng logic.
- Build: **tsup** cho JS (ESM + CJS), **tsc** cho `.d.ts`. Mỗi file `src/*.ts` là một điểm
  vào → frontend đổi `@/core/calc` thành `@mambo/core/calc`, không phải sửa gì khác.
- `packages/contracts` 0.1.0: `ErrorCode` (12 mã) + `ERROR_STATUS` + `ErrorBody` +
  `isRetryable`; `OrgType`, `MemberRole`, `hasBook`; `Permission` (15 quyền),
  `PERMISSIONS_BY`, `can`.
- `.dependency-cruiser.cjs`: `core` không import gì ngoài chính nó; `contracts` chỉ `zod`
  và `core`; cấm vòng.
- CI (`ci.yml`) trên `master`; `release.yml` khi gắn tag `v*`: verify → kiểm tag khớp
  version → `npm pack` → `gh release create` kèm `.tgz`.
- `docs/`: chép `THONG_TIN_DU_AN.md`, kế hoạch backend, sơ đồ v2; liên kết tới tài liệu cũ
  trỏ về repo frontend trên GitHub.

### Quyết định

1. **Hai repo, không monorepo.** Repo BE chỉ chứa backend + gói dùng chung; frontend ở repo
   riêng. Người dùng chọn khi bắt đầu BE0.
2. **Frontend lấy gói qua URL `.tgz` của GitHub Release**, khoá theo tag. Không dùng npm git
   dependency (npm không cài được một thư mục con của monorepo từ git). Không dùng GitHub
   Packages (bắt buộc token kể cả khi đọc gói công khai).
3. **`core` chỉ được sửa ở repo BE.** Frontend muốn đổi hàm tính tiền thì mở PR vào đây.
4. **Ô ma trận chưa định nghĩa để rỗng** (vựa `manager`, nông dân `manager`/`staff`) — không
   tự đặt ra quyền mà kế hoạch chưa chốt. Bản nháp đầu có tự suy quyền cho vựa `manager`,
   đã gỡ trước khi commit.
5. **Test ma trận viết lại bảng ở dạng khác** (mảng boolean theo cột, chép từ KH §1.6) chứ
   không đọc lại `PERMISSIONS_BY` — sửa nhầm một ô ở một bên là test đỏ.
6. `contracts` để `zod` là **peerDependency**: frontend và API dùng chung một bản zod, không
   có hai bản trong bundle.

### Chạy thật đã kiểm

| Việc | Kết quả |
|---|---|
| `npm run verify` tại chỗ | Xanh: lint · typecheck · boundaries · test · build |
| Test `core` | **315/315**, phủ 97,7% dòng · 96,6% statements · 83,7% nhánh |
| Test `contracts` | 22/22 |
| Ranh giới | 0 vi phạm (74 module, 145 phụ thuộc) |
| Gói build ra, gọi từ ESM và CJS | `roundToThousand(1438200)` = 1.438.000 ở cả hai |
| [CI trên GitHub](https://github.com/remembered-fragrance/Thumua365_BE/actions/runs/35564456728) | ✅ |
| [Release `v0.1.0`](https://github.com/remembered-fragrance/Thumua365_BE/releases/tag/v0.1.0) | ✅ `mambo-core-0.1.0.tgz` (129KB) · `mambo-contracts-0.1.0.tgz` (5,6KB) |
| Cài hai gói từ URL release vào project nháp, TS `moduleResolution: bundler` | Kiểm kiểu và chạy đều được |

**Vì sao 315 chứ không phải 358:** 358 là tổng test của repo frontend; 43 test còn lại thuộc
`tests/data/` và `tests/features/`, ở lại repo frontend.

### 🔴 Chưa xong của BE0 — việc bên frontend

- [ ] Chốt quy ước §3 (camelCase, tiền số nguyên, header `X-Organization-Id`).
- [ ] Cài `@mambo/core`, `@mambo/contracts` từ release `v0.1.0`; thay `@/core/` →
      `@mambo/core/`; xoá `src/core/`, `tests/core/`; 43 test còn lại phải xanh.
- [ ] Sửa `ci.yml` của repo frontend sang nhánh `master` (đang ghi `main`).
- [ ] Commit các file tài liệu mới trong repo frontend (`THONG_TIN_DU_AN.md`,
      `deploy_plan/BE-backend-nestjs.md`, `I-huong-moi.md`, `so-do-kien-truc-v2.html`,
      `README.md`) — đang nằm chưa commit.

---

## Hạ tầng Supabase · 21/09/2026

**Kết quả:** hai project Supabase chạy ở Singapore, cả hai ký JWT bằng khoá bất đối xứng.

| | Staging | Production |
|---|---|---|
| Project | `thumua365-staging` | `thumua365-prod` |
| URL | `https://bldlrkmszjmhifubxjvl.supabase.co` | `https://grrzveprprjukvosdtra.supabase.co` |
| Ref | `bldlrkmszjmhifubxjvl` | `grrzveprprjukvosdtra` |
| Vùng | Southeast Asia (Singapore) | Southeast Asia (Singapore) |
| Gói | Free | **Free (tạm)** — xem quyết định 3 |

Cấu hình khi tạo (giống nhau ở hai project, mật khẩu database khác nhau):

- **Không** nối GitHub — Prisma Migrate là nơi duy nhất sửa schema.
- **Tắt Data API** (PostgREST) và "tự mở bảng mới" — app không đọc DB trực tiếp (KH §5).
  Auth và Storage của `supabase-js` vẫn chạy. Hệ quả: app frontend hiện tại **không** đăng
  ký được với hai project này cho tới BE2 (`/me/bootstrap`, `/auth/resolve-identifier`).
- **Bật RLS tự động** cho mọi bảng mới trong `public`.

### Kiểm tra thật

| Việc | Kết quả |
|---|---|
| `GET /auth/v1/.well-known/jwks.json` | Cả hai: một khoá **ES256 (EC)** ⇒ NestJS kiểm JWT bằng JWKS công khai như KH §3, không cần JWT secret |
| `/rest/v1/` | 401 — Data API đã tắt / cần khoá |
| Production ngay sau khi tạo | 521 khoảng 1–2 phút trong lúc khởi tạo, rồi chạy |

### Quyết định

1. **Kiểm JWT bằng JWKS (ES256)**, không dùng JWT secret dùng chung. Bí mật không phải nằm
   trong API; đổi khoá ở Supabase thì API tự lấy khoá mới.
2. **Mật khẩu database và khoá không bao giờ đi qua chat hay commit.** Chỉ nằm trong `.env`
   máy dev (đã `.gitignore`) và biến môi trường của nơi chạy container.
3. **Production tạm ở gói Free.** Hệ quả và cách chặn:
   - Không có backup tự động ⇒ job `pg_dump` hằng ngày ra kho riêng là **lớp backup duy
     nhất**, chuyển từ "BE10" thành **điều kiện bắt buộc trước khi có người dùng thật**,
     kèm một lần thử phục hồi.
   - Tạm dừng sau ~1 tuần không truy cập — chấp nhận trước pilot; không dựng cron gọi vào
     để lách.
   - **Nâng lên Pro (org riêng, để staging vẫn free) khi gặp mốc đầu tiên:** có khách trả
     tiền đầu tiên · database > ~400MB · Storage > ~800MB · production bị tạm dừng lúc đang
     có người dùng.
   - PITR để sau khi có doanh thu; hai lớp backup của pilot = backup hằng ngày của Pro +
     `pg_dump` riêng.

---

## BE1 — Khung NestJS, bảo mật nền · `00ce552` · tag `v0.2.0` · 21/09/2026

**Kết quả:** API chạy được, kiểm JWT thật của Supabase staging qua JWKS; frontend có
`@mambo/sdk` để gọi. Chưa deploy — chờ tài khoản Render.

### Làm gì

- `apps/api`: NestJS 11 + Express 5, CommonJS. Hai endpoint: `GET /v1/health` (công khai),
  `GET /v1/me` (cần đăng nhập).
- Chuỗi xử lý mỗi request: middleware (`requestId` + log truy cập) → helmet → CORS → đọc
  JSON (≤1MB) → ThrottlerGuard → JwtAuthGuard → OrgContextGuard → PermissionGuard → handler
  → ContractInterceptor → ExceptionFilter.
- `packages/contracts` 0.2.0: `routes` (danh bạ endpoint), `Me`, `Health`, thêm
  `NOT_FOUND`/`PAYLOAD_TOO_LARGE`; `openapi.json` sinh tự động, có test bắt khớp.
- `packages/sdk` 0.2.0 (mới): `createClient` → `health()`, `me()`; `ApiError` mang `code`.
- `apps/api/Dockerfile`, `.dockerignore`, `render.yaml` (staging), CI thêm job `docker`
  build image + chạy container + gọi `/v1/health` và `/v1/me`.

### Quyết định

1. **NestJS 11, không phải 12.** v12 ra 27/08/2026, **chỉ ESM**. v11.2.x ổn định, CJS, mọi
   gói phụ (throttler, nest-winston) tương thích. Lên 12 là một việc riêng, sau khi hệ sinh
   thái theo kịp.
2. **jose v5, không phải v6.** v6 chỉ ESM; API chạy CJS.
3. **Import tương đối trong mọi gói có đuôi `.js`** (kể cả 37 file của `core` — chỉ đổi
   đường import, không đổi logic). Không có đuôi thì `.d.ts` sinh ra vô dụng với
   `moduleResolution: nodenext` của API: TS báo `@mambo/contracts` "không có export nào".
   Vite và `bundler` vẫn hiểu đuôi `.js`.
4. **Log truy cập ở middleware, không ở interceptor** (khác chữ trên sơ đồ): interceptor chạy
   sau guard nên request bị 401/403/429 sẽ không có log — đúng loại cần xem nhất.
5. **"Transform" = kiểm phản hồi bằng schema hợp đồng** (`ContractInterceptor`): lọc trường
   thừa, sai hình dạng thì 500. Đổi tên cột DB thuộc lớp dữ liệu (BE2).
6. **Mặc định đóng:** handler thiếu `@Endpoint` vẫn bị bắt đăng nhập.
7. **`/v1/me` hỏi Supabase Auth thật** (`/auth/v1/user` bằng token của chính người dùng +
   publishable key) — JWT không có `phone_confirmed_at`; kèm lợi ích phát hiện phiên đã bị
   thu hồi. Không dùng `service_role` ở BE1.
8. **Giấu email nội bộ** `…@id.thumua365.vn` (khoá đăng nhập cho người chỉ có SĐT) khỏi `/me`.
9. **Lỗi 500 không lộ chi tiết** ra ngoài — chi tiết vào log và Sentry. Có test.
10. `docker-compose` cho Postgres **dời sang BE2** (BE1 chưa có database; máy dev chưa có Docker).
11. `render.yaml` **chỉ có staging** — production thêm ở BE10, không trả tiền cho thứ chưa dùng.
12. Bộ đọc JSON tự dựng (`bodyParser: false` + `express.json`) để lỗi 413/cú pháp sai ra đúng
    định dạng — lỗi của nó xảy ra trước Nest nên exception filter không bắt được.

### Lỗi bắt được trong lúc làm

- **Vòng phụ thuộc** `auth-user.ts` ↔ `request-context.ts` (chỉ qua `import type`, nhưng vẫn
  là vòng) — dependency-cruiser bắt; tách decorator `CurrentUser` ra `current-user.ts`.
- Bản đầu `ContractInterceptor` ném lỗi kèm danh sách trường sai **ra ngoài** trong `details`
  của lỗi 500 — sửa để lỗi `INTERNAL` không bao giờ mang `message`/`details` gốc.
- `z.uuid()` của zod v4 kiểm chặt RFC (version 1–8, variant 8–b) — id của Supabase và
  `crypto.randomUUID()` đều đạt; uuid tự gõ tay trong test phải đúng dạng này.

### Chạy thật đã kiểm

| Việc | Kết quả |
|---|---|
| `npm run verify` | Xanh — 315 (core) + 25 (contracts) + 6 (sdk) + 33 (api) test; 0 vi phạm ranh giới |
| API build rồi chạy `node dist/main.js` trỏ Supabase staging | Lên trong ~30ms, log JSON mỗi request một dòng |
| `GET /v1/health` | `{"status":"ok","version":"0.2.0","commit":"…","env":"staging"}` |
| `GET /v1/me` không token | 401 `UNAUTHENTICATED`, `requestId` khớp header |
| Token giả mang `kid` lạ | API đi lấy **JWKS thật** của staging → 401 |
| Đường dẫn lạ | 404 `NOT_FOUND` |
| [CI](https://github.com/remembered-fragrance/Thumua365_BE/actions/runs/35568565561) job `verify` | ✅ |
| CI job `docker` — lần đầu Dockerfile được build ở bất cứ đâu | ✅ build image · container lên · `/v1/health` 200 · `/v1/me` 401 đúng định dạng |
| [Release `v0.2.0`](https://github.com/remembered-fragrance/Thumua365_BE/releases/tag/v0.2.0) | ✅ core (133KB) · contracts (12KB) · sdk (4KB) |
| Cài ba gói từ URL release vào project nháp, dùng `createClient` + `ApiError` | Kiểm kiểu và chạy đều được |
| Test e2e (supertest, đúng `configureApp` của production) | Token rác / sai issuer / hết hạn / khoá lạ / khoá anon → 401 · phiên bị thu hồi → 401 · Supabase lỗi → 500 không lộ chi tiết · JSON hỏng → 422 · body 1,1MB → 413 · CORS domain lạ không có header · quá hạn mức → 429 có `Retry-After`, `/v1/health` không bị tính · staff vựa xoá phiếu → 403 · chủ vựa → 200 · nông dân owner → 403 · trường thừa bị lọc · sai hợp đồng → 500 |

### 🔴 Chưa kiểm được

- **Token thật của một người dùng thật** chưa đi qua `/v1/me` — cần publishable key của
  staging và một tài khoản thử. Tất cả nhánh đã có test với token ES256 tự ký.
- ~~Deploy staging~~ — xong, xem mục "Staging lên Render".

---

## Staging lên Render · `e1c589d` · 21/09/2026

**Kết quả:** API staging chạy ở `https://thumua365-api-staging.onrender.com`, deploy tự động
sau khi CI xanh.

| | |
|---|---|
| Service | `thumua365-api-staging` · Docker · vùng Singapore · gói free (ngủ sau ~15 phút) |
| Tạo bằng | Blueprint `thumua365` từ `render.yaml`, nhánh `master` |
| Biến điền tay | `SUPABASE_PUBLISHABLE_KEY` (staging) · `CORS_ORIGINS=http://localhost:5173,http://localhost:5174` · `SENTRY_DSN` trống |
| Đường đi | người dùng → **Cloudflare** → proxy Render → container |

### 🔴 Lỗi thật chỉ lộ ra trên staging — hạn mức theo IP không có tác dụng

Test tại chỗ xanh, nhưng trên staging **125 request trong ~40 giây không request nào bị
429**. Render đứng sau Cloudflare (`Server: cloudflare`, `CF-RAY`), nên với `trust proxy 1`
thì `req.ip` là IP **máy Cloudflare** — mỗi request một máy khác, không ai chạm hạn mức.

Sửa: `ClientIpThrottlerGuard` đếm theo IP trong header khai báo ở `CLIENT_IP_HEADER`
(`cf-connecting-ip` — Cloudflare ghi đè giá trị này). Không khai báo biến thì header bị bỏ
qua, để không ai giả header mà lách được. Có test cho cả hai phía.

**Bài học:** mọi thứ phụ thuộc vào IP người gọi phải thử trên đúng hạ tầng thật —
test tại chỗ không có proxy nên không bao giờ bắt được loại lỗi này.

### Chạy thật đã kiểm trên staging

| Việc | Kết quả |
|---|---|
| `GET /v1/health` (lúc đang ngủ / đã thức) | 200 · 0,6s / 0,3s · `commit` đúng bản vừa deploy |
| `GET /v1/me` không token | 401 `UNAUTHENTICATED`; có `strict-transport-security`, `x-content-type-options` |
| Token giả mang `kid` lạ | 401 — API lấy JWKS thật của Supabase staging |
| Đường dẫn lạ | 404 `NOT_FOUND` |
| CORS `http://localhost:5174` / domain lạ | Có header / không có header |
| Preflight với `authorization,x-organization-id` | 204, cho phép cả hai header |
| 125 request `/v1/me` sau khi sửa | 120 × 401 rồi **đúng request 121 → 429**, `Retry-After: 58`; `/v1/health` vẫn 200 |
| Client tự gửi `cf-connecting-ip` | Cloudflare chặn (403) — không giả được |
| Deploy tự động | Push → CI xanh → Render deploy trong vài phút; đổi `render.yaml` được Blueprint tự áp |

### `/v1/me` với tài khoản thật — lần chạy đầu (`npm run smoke:me`)

Bước 1, 2, 4 đạt: đăng nhập thật, `/v1/me` 200 đúng hợp đồng `Me`, `user.id` khớp; đăng
xuất rồi dùng lại token cũ còn hạn → **401** (API phát hiện phiên bị thu hồi).

Bước 3 "token bị sửa một ký tự → 401" **trượt — lỗi của script, không phải của API.**
Script đổi ký tự CUỐI của chữ ký. Chữ ký ES256 64 byte = 86 ký tự base64url = 516 bit, nên
4 bit cuối là bit đệm; khi ký tự gốc nằm trong `A`–`P`, đổi sang `A`/`B` chỉ đổi bit đệm và
giải mã ra **đúng chữ ký cũ**. Đã kiểm: lật bit đệm → 20/20 lần bytes chữ ký giống hệt.
Không phải lỗ hổng — muốn có biến thể thì phải đang cầm token hợp lệ, và biến thể mang
đúng nội dung của nó. Sửa script: sửa ký tự **giữa** chữ ký và **giữa** payload; thêm hai ca
đó vào test API (37 test).

Kèm theo: script in **nguyên thân phản hồi** khi báo lỗi — lộ email của tài khoản thử ra
màn hình. Sửa: chỉ in mã HTTP và mã lỗi; thông tin người dùng chỉ in "có/null".

### ✅ BE1 đóng — `npm run smoke:me` lần hai: cả 4 bước đạt

Đăng nhập thật → `/v1/me` 200 đúng hợp đồng → token sửa giữa chữ ký / giữa payload → 401
→ đăng xuất rồi dùng token cũ còn hạn → 401.

### Trang thử đăng nhập — `npm run login-test`

`tools/login-test/` (http://localhost:5174 — cổng nằm trong `CORS_ORIGINS` của staging).
Đăng nhập bằng `supabase-js` (CDN, bản ghim 2.116.0) rồi gọi API bằng **chính `@mambo/sdk`
đã build trong repo** qua import map — nên nó vừa là công cụ thử, vừa là ví dụ chạy được
cho frontend. Không phải frontend sản phẩm.

- Máy chủ tĩnh tự viết, **chỉ** phục vụ `tools/login-test`, `packages/{sdk,contracts}/dist`,
  `node_modules/zod`, và chỉ file `.html/.js/.css/.map`. Đã thử `../`, `%2F`… để đọc
  `apps/api/.env` → đều 404.
- Đã chạy trong trình duyệt: gọi `/v1/health` staging qua CORS thành công; khoá giả →
  báo "Publishable key sai…"; mật khẩu bị xoá khỏi ô sau mỗi lần bấm.

---

## Đồng bộ tài liệu với code sau BE1 · 21/09/2026

Soát lại `docs/` và sơ đồ v2 so với code đã chạy; sửa chỗ lệch để BE2 không làm theo chữ cũ.

| Chỗ lệch | Sửa thành |
|---|---|
| Sơ đồ v2: "Prisma bỏ qua RLS, nên lớp chính phải là Guard" — ngược quyết định #7 | `api_service` **không** `BYPASSRLS`; RLS theo phiên `app.org_id` bắt lỗi quên lọc `orgId` |
| Đổi camelCase ↔ snake_case "ở interceptor" (THONG_TIN §3.2, KH §3) | Thuộc lớp dữ liệu (BE2); `ContractInterceptor` chỉ kiểm/lọc phản hồi — đúng quyết định BE1 #5 |
| "Logging interceptor" | Log truy cập ở middleware (quyết định BE1 #4) |
| Bảng mã lỗi KH §3.1 thiếu `NOT_FOUND`, `PAYLOAD_TOO_LARGE` | Thêm, kèm việc frontend phải làm |
| Tên `SupabaseJwtGuard` | `JwtAuthGuard`; thứ tự guard ghi đủ, có `ClientIpThrottlerGuard` |
| Backup "PITR của Supabase" trên sơ đồ | Prod ở gói Free ⇒ `pg_dump` là lớp bắt buộc; Pro khi nâng gói; PITR sau doanh thu |
| Tình trạng "backend chưa bắt đầu", cột ✅/❌ của BE1, nơi chạy container "chọn ở BE1" | Cập nhật theo thực tế: Render Singapore, staging chạy, BE0–BE1 ✅ |

Không đổi code, không đổi quyết định nào — chỉ cho tài liệu nói đúng điều đã chốt và đã làm.

## BE2 — Database, ba vai trò · `d605626` · tag `v0.3.0` · 22/09/2026 · ✅ đóng (OTP dời sang BE4)

**Kết quả:** schema đủ bốn nhóm bảng của kiến trúc v2, RLS theo phiên chứng minh bằng test
trên Postgres thật, `/me/bootstrap`, `/auth/resolve-identifier`, `/links/discover`. Chưa
chạy migration lên staging.

### Làm gì

- Máy dev: cài WSL2 + Docker Desktop. `docker-compose.yml`: Postgres **17** + PostGIS (cùng
  bản Supabase — đã kiểm staging chạy 17.6; kế hoạch cũ ghi 16).
- `apps/api/prisma/`: Prisma **7.10** (bản ổn định; tag `latest` trên npm đang là 8.0-rc,
  không dùng). Một migration `20260922000000_ba_vai_tro`: phần A viết tay (extension,
  role, hàm) → phần B Prisma sinh (24 bảng) → phần C viết tay (CHECK, index một phần,
  trigger, quyền, RLS, hai hàm security definer).
- `src/db/database.ts`: `Database.scoped({ userId, orgId }, tx => …)` — cửa duy nhất vào
  Postgres. `PrismaMemberships` thay `NoMembershipsYet`: `/v1/me` và `OrgContextGuard` đọc
  membership thật.
- `ContractInterceptor` kiểm cả thân request (`route.body`), `@Endpoint` áp hạn mức riêng
  (`rateLimitPerMinute`). `recordAudit(tx, …)`, `DomainEvents` (có kiểu).
- Contracts 0.3.0 (chưa phát hành): ba route mới, `RouteDef.body/errors/rateLimitPerMinute`.
  SDK: `meBootstrap`, `resolveIdentifier`, `discoverLinks`.
- CI: job `db` (docker compose → `test:db` → kiểm `schema.prisma` khớp migration).
- `npm run db:role-password`: đặt mật khẩu `api_service`, ghi `DATABASE_URL` vào `.env`.

### Quyết định

1. **Không khoá ngoại sang `auth.users`.** Postgres ở máy/CI không có schema `auth`; nối vào
   thì migration chỉ chạy được trên Supabase. Việc cần Auth đi qua Auth API. Hệ quả: xoá
   user trên dashboard Supabase không kéo theo dữ liệu — xoá tài khoản làm qua `DELETE
   /v1/me` (BE6) theo thứ tự đã chốt.
2. **API kết nối thẳng bằng role `api_service`**, không phải `postgres` + `SET ROLE`: quên
   đặt role thì vẫn không bypass được RLS.
3. **Chưa có ngữ cảnh = không thấy gì.** `app_org_id()` NULL ⇒ mọi policy ra NULL.
4. **Việc xuyên tổ chức là hàm security definer hẹp**, chỉ `api_service` gọi được:
   `find_login_user` trả đúng một id; `discover_links` đòi `app.org_id` và số dạng `+84…`,
   không tạo lại liên kết mà chủ sổ đã huỷ.
5. **Tiền là `BigInt`**, khối lượng/%/đơn giá là `Float`.
6. **`/me/bootstrap` lấy số điện thoại từ email đăng nhập nội bộ** (`84…@id.thumua365.vn`,
   Supabase đã đảm bảo duy nhất), bỏ qua số client khai — không thì ai cũng khai được số
   người khác rồi chiếm việc đăng nhập bằng số đó.
7. **`/auth/resolve-identifier` luôn trả một email cùng hình dạng**: SĐT không có → email
   nội bộ của chính số đó; tên tài khoản không có → `849…` rút từ HMAC(khoá secret).
8. **Mật khẩu role gửi dạng băm SCRAM-SHA-256** — log DDL của Supabase (nếu bật) không thấy
   mật khẩu.
9. Image Docker: tầng `deps` cài mới `--omit=dev --omit=optional` thay `npm prune` — prune
   giữ Prisma CLI/TypeScript/Studio (peer tuỳ chọn của `@prisma/client`). 828MB → **469MB**.

### Lỗi bắt được trong lúc làm

- **Hàm trigger security definer mở cho PUBLIC** (`set_referral_code`) — test "anon không
  gọi được hàm security definer" bắt; thu hồi.
- **`pg_advisory_xact_lock` trả `void`**, `$queryRaw` của Prisma không đọc được → 500 ở
  bootstrap; đổi sang `$executeRaw`.
- **`citext = text` so như `text`** (phân biệt hoa thường) trong `find_login_user` — ép
  `::citext`, thêm test hồ sơ lưu chữ hoa.
- Healthcheck Docker bằng socket báo "sẵn sàng" giữa lúc chạy script khởi tạo → đổi sang TCP.

### Chạy thật đã kiểm

| Việc | Kết quả |
|---|---|
| `npm run verify` | Xanh — contracts 31 · core 315 · sdk 7 · api 40; ranh giới 0 vi phạm (98 module) |
| `npm run test:db` (Postgres 17 thật) | **47/47**: 29 RLS/quyền/hàm SQL + 18 API trên DB |
| RLS | Quên lọc `orgId` → chỉ thấy tổ chức mình · không ngữ cảnh → 0 hàng · ghi/chuyển sang tổ chức khác → bị chặn · `DELETE` → permission denied · sửa số tiền lần trả → bị chặn, huỷ được và `updated_at` đổi |
| Supabase mặc định | anon/authenticated: 0 quyền trên bảng, không gọi được hàm security definer; mọi bảng bật RLS |
| `schema.prisma` ↔ migration | `prisma migrate diff` rỗng |
| Image Docker chạy trên máy nối Postgres ở máy | `/v1/health` 200 · `resolve-identifier` qua Prisma 200 · log không lỗi |

### Lên staging · PR #2 `711ca04` · 22/09/2026

| Việc | Kết quả |
|---|---|
| CI trên PR | Lần đầu job `db` đỏ: **container Postgres tự tắt** — `10_postgis.sh` không có quyền thực thi trên Linux nên entrypoint `source` nó, và `exit 0` thoát luôn entrypoint. Windows mount file có quyền thực thi nên không lộ ra. Bỏ `exit`, đặt `100755` trong git. Lần hai: 3 job xanh, 47/47 test DB, `No difference detected` |
| `prisma migrate deploy` lên staging | ✅ Trước khi chạy đã kiểm: đúng project `bldlrkmszjmhifubxjvl`, database trống |
| Staging sau migration | 24 bảng, mọi bảng bật RLS, anon/authenticated 0 quyền, PostGIS + citext trong `extensions`, schema khớp. Hàm `rls_auto_enable` là của Supabase (tính năng tự bật RLS), không phải của ta |
| `npm run db:role-password` | ✅ **Transaction pooler nhận user tuỳ chỉnh `api_service.<ref>`** — điểm chưa chắc nhất của thiết kế |
| Prisma + RLS qua cổng 6543 | Ngữ cảnh đúng người trong transaction · không rò sang transaction sau · 20 transaction song song không lẫn ngữ cảnh |
| Render | Thêm `SUPABASE_SECRET_KEY`, `DATABASE_URL` trước khi merge; deploy `711ca04` sau ~3 phút |
| Thử trên staging | `/v1/me`, `/me/bootstrap`, `/links/discover` không token → 401 · `resolve-identifier` chạm DB, trả email cùng hình dạng · thân sai → 422 · preflight POST → 204 · hạn mức riêng 10/phút → 429 đúng lúc |

### ⚠️ Phát hiện: staging đang bật "Confirm email"

`/auth/v1/settings` trả `mailer_autoconfirm: false`. Người đăng ký chỉ bằng số điện thoại dùng
email nội bộ `84…@id.thumua365.vn` — không nhận được thư ⇒ **không bao giờ xác nhận được,
không đăng nhập được**. Phải tắt: Authentication → Sign In / Providers → Email → *Confirm
email*. Danh tính thật xác minh bằng OTP số điện thoại, không bằng email. Production phải
tắt giống vậy (ghi vào bảng kiểm BE10).

### Công cụ nghiệm thu — `npm run login-test`

Trang thử nâng thành đủ luồng tài khoản của frontend: đăng ký (email nội bộ từ số, như
`data/auth.ts`) → "Bác là ai?" (`sdk.meBootstrap`) → chọn tổ chức (header
`X-Organization-Id`) → OTP (`updateUser({ phone })` → `verifyOtp({ type: 'phone_change' })`)
→ "Dò kết nối" (`sdk.discoverLinks`); đăng nhập một ô qua `sdk.resolveIdentifier`. Dùng
`@mambo/core/identifier` qua import map. Máy chủ tĩnh vẫn chặn `../` tới `apps/api/.env`.

### ✅ Nghiệm thu trên staging — 22/09/2026

Tắt "Confirm email" trên staging. Đăng ký thật bằng `npm run login-test` rồi đối chiếu
database (chỉ đọc):

| Loại | Kết quả |
|---|---|
| Nông dân | `owner`, **không có gói**, có SĐT + mã giới thiệu, `audit_log` `organization.bootstrapped` |
| Vựa | `owner`, gói `trialing` đúng **30 ngày**, audit |
| Doanh nghiệp (×2) | `owner`, gói `trialing` 30 ngày, `branch_limit` trống, audit |

Mỗi tài khoản đúng một tổ chức; mọi dòng audit khớp người tạo và có `request_id`.

**Lỗi bắt được khi nghiệm thu — ở trang thử, không ở API:** lần đầu ra hai doanh nghiệp,
không có vựa. Audit ghi `"type": "enterprise"` ⇒ API lưu đúng cái được gửi. Nguyên nhân: form
"Bác là ai?" giữ lựa chọn cũ sau khi đăng xuất — tài khoản sau "thừa hưởng" loại tổ chức của
người trước. Sửa: xoá form khi đăng xuất và sau khi tạo xong; thông báo ghi rõ loại vừa tạo.
**Frontend thật cần làm y như vậy.**

### Quyết định khi đóng BE2

**OTP (xác thực số điện thoại) dời sang BE4.** BE4 là bước đầu tiên thật sự cần số đã xác
thực (nông dân xem phiếu, công nợ trong sổ vựa). Code phía API đã sẵn và có test:
`/links/discover` trả `PHONE_NOT_VERIFIED` khi số chưa xác thực. Dời không hở gì — trước BE4
không có đường nào đọc chéo dữ liệu. Đăng nhập vẫn bằng mật khẩu.

### Còn treo, chuyển tiếp

- **BE4:** bật Phone provider trên Supabase, chọn nhà cung cấp SMS, OTP tới máy thật.
- **BE10:** production cũng phải tắt "Confirm email" — thêm vào bảng kiểm.
- **Cần nhóm quyết:** `resolve-identifier` trả email đăng nhập thật khi gõ đúng tên tài khoản
  — tên công khai ⇒ lộ email/SĐT đăng nhập. Hướng sửa: API đăng nhập hộ
  (`POST /v1/auth/login`), đổi hợp đồng. Bản cũ (RPC) cũng như vậy.
- Hai doanh nghiệp thử (`adfadas`, `shibaaa`) giữ lại — dùng cho BE7.

---

## Hướng dẫn frontend — `docs/FRONTEND.md` · 28/09/2026

**Kết quả:** một file duy nhất cho người làm frontend: cài gì, gọi gì, luật nào, và từng bước
BE0 → BE10 frontend phải làm gì. README và `THONG_TIN_DU_AN.md` trỏ tới file này.

### Vì sao

- Frontend muốn **dựng lại app từ đầu**. Trước đó, thông tin cho frontend nằm rải ở README,
  KH §3/§4.3/§7/§10, CHANGELOG, trang thử — không có cổng vào.
- Soát repo frontend (chỉ đọc): `master` (`999a029`, 13/09) chưa cài `@mambo/*`, còn 72 file
  import `@/core/`; nhánh `docs/huong-moi-ba-vai-tro` chưa merge, bản sao KH backend trong đó là
  bản 21/09 (lệch ~1.300 dòng). Nhánh `feat/nestjs-p0` (22/09, chưa merge) dựng **một NestJS
  riêng trong repo frontend** + migration Supabase `0011`–`0018`, hợp đồng khác hẳn: `/api/v1`,
  header `X-Workspace-Id` và `Idempotency-Key` (CORS của API không cho hai header này), lỗi dạng
  phẳng `{ code, message }`, đồng bộ qua `/legacy/*`, `fetch` tay thay `@mambo/sdk`. Mục "Không
  làm" của `FRONTEND.md` liệt kê đúng những chỗ này kèm giá trị đúng.

### Quyết định

1. **`docs/FRONTEND.md` sửa cùng PR với mọi thay đổi hợp đồng** — thêm bước 6 vào "Thêm một
   endpoint" trong README. Lệch với code thì code đúng.
2. Phần chưa có hợp đồng (BE3–BE10) ghi là **dự kiến**, lấy từ KH §4, §6; tên chính xác chốt
   trong `packages/contracts` khi tới bước đó.
3. Khuyên frontend **mang sang** phần hàng đợi/`mergeChanges`/`deviceAccount` của repo cũ thay
   vì viết lại — đã có test và giữ năm quy tắc chống mất tiền.

### 🔴 Cần nói với người làm frontend

- Nhánh `feat/nestjs-p0` không khớp hợp đồng — không merge; dùng repo BE + `@mambo/sdk`.
- Bản sao tài liệu backend trong repo frontend đã cũ — đọc bản ở repo BE.

---

## BE3 — Đồng bộ sổ qua API · `9185038` · tag `v0.4.0` · 28/09/2026 · ✅ đóng

**Kết quả:** hợp đồng `sync` trong contracts, `SyncModule` (push + pull), migration BE3 chạy trên
staging, 78 test trên Postgres thật xanh, nghiệm thu hai máy trên staging đạt — khớp từng đồng
và khớp database. **Đạt R1.**

### Soát trước khi làm

- Repo BE khớp `origin`; `npm run verify` xanh; `test:db` 47/47; staging `/v1/health` 200 đúng
  commit `91e1345`. Repo frontend không có gì mới từ 22/09.
- **Hướng mới (người dùng chốt 28/09):** frontend dựng lại app từ đầu ⇒ **backend đi trước**,
  frontend dựng theo hợp đồng + mock. Nghiệm thu BE3 không chờ app thật.

### Làm gì

- Contracts: `RouteDef.query` (+ interceptor kiểm query, `@ContractQuery()`, SDK dựng query
  string, openapi `in: query`) và `RouteDef.docBody`. `sync-records.ts` (Insert/Patch/Record
  cho 8 thực thể, kiểu được kiểm lúc biên dịch là trùng `@mambo/core/types` — đã thử làm lệch
  để chắc phép kiểm có tác dụng), `sync.ts` (`SyncOp`, push/pull, `SYNC_PERMISSION`),
  `sync-parse.ts` (`parseSyncOp`). SDK: `sync.push`, `sync.pull`.
- API `src/sync/`: push — kiểm gói → mỗi op một transaction (khoá advisory theo tổ chức, chống
  trùng bằng `sync_ops`, quyền từng op, chi nhánh, tính lại tổng dòng bằng `freezeLineTotals`,
  audit xoá phiếu / huỷ lần trả) → dừng ở op bị từ chối đầu tiên. Pull — cursor base64url, mốc
  `until` theo đồng hồ DB, 8 bảng theo thứ tự cố định, phân trang `(updated_at, id)`, chồng lấn
  15 giây, kèm phiếu cha đổi sau `until`, `resetRequired` khi đổi chi nhánh.
- Migration `20260928000000_be3_dong_bo`: khoá ngoại ghép, `updated_at` `timestamptz(3)` cho 8
  bảng sổ, trigger `keep_soft_deleted`, 4 mặt hàng mặc định cho tổ chức đã có.
  `/me/bootstrap` tạo 4 mặt hàng đó cho vựa/DN mới.

### Quyết định

1. **Cổng chỉ kiểm vỏ op, `data` kiểm theo từng op** — một op sai thành `rejected` kèm đúng
   trường, không làm 422 cả lô (cả lô 422 thì app không biết op nào hỏng, hàng đợi kẹt).
2. **Quyền của op ≠ quyền của màn.** Lập phiếu kéo theo tạo người bán, mặt hàng mới, sửa giá
   gần nhất; người cân không có `partner:manage`/`pricing:manage` ⇒ những việc phụ đó cần
   `receipt:create`. Sửa mặt hàng mà CHỈ đổi `lastPricePerUnit` cũng vậy.
3. **Mặt hàng mặc định do server tạo** (id UUID), app gộp theo tên như `normalize()` vẫn làm.
   Id `prod-…` của core bị từ chối có giải thích. Không sửa core.
4. **Id thuộc tổ chức khác = `rejected`, không phải `duplicate`** — `duplicate` làm máy xoá op
   ⇒ mất phiếu âm thầm.
5. `update` bản ghi đã xoá = nhận op + `warning: RECORD_DELETED`. Lần trả cho phiếu đã xoá vẫn
   lưu (tiền đã trả ngoài đời) + cảnh báo. Hết gói = `402` cả request.
6. Phiếu đã chốt chỉ sửa được `attachmentIds`, `note`. `orderId` để BE5 (chỉ thêm).
7. Cursor không ký: sửa cursor chỉ đọc lại dữ liệu của chính tổ chức (RLS); phạm vi chi nhánh
   lấy từ membership.
8. Khoá chi nhánh cũ `ON DELETE SET NULL` → khoá ghép `RESTRICT` (SET NULL sẽ đặt null cả
   `organization_id`); chi nhánh chỉ xoá mềm nên không đổi hành vi.

### Lỗi thật tìm ra (đã sửa, có test)

- 🔴 **Tổ chức A gắn được lần trả vào phiếu của tổ chức B**: khoá ngoại một cột được Postgres
  kiểm **không qua RLS**. Thử được trên Postgres ở máy (transaction, rollback). Sửa: khoá ngoại
  ghép `(transaction_id, organization_id)`; chi nhánh cũng vậy.
- 🔴 **`api_service` khôi phục được bản ghi đã xoá** (`deleted_at = null`) — quy tắc "xoá thắng"
  chỉ nằm ở code. Sửa: trigger `keep_soft_deleted` (chặn cả role `postgres`).
- 🔴 **Mặt hàng mặc định `prod-rubber` không phải UUID**: phiếu đầu tiên sinh op sửa giá mặt hàng
  đó → bị từ chối → theo luật "gặp rejected là dừng", **cả hàng đợi kẹt**.
- **Phân trang theo `updated_at` micro-giây với JS Date mili-giây**: nhiều bản ghi cùng mili-giây
  (một transaction ghi hàng loạt có cùng `now()`) làm trang sau lặp mãi. Sửa: cột
  `timestamptz(3)`.
- Chồng lấn 5 giây của kế hoạch **bằng đúng** thời gian sống tối đa của transaction Prisma
  (5 giây) — sát mép. Nâng lên 15 giây.
- Test mặt hàng mặc định đỏ vì `order by name` với chữ có dấu tuỳ collation — sắp theo `crop`.

### Chạy thật đã kiểm

| Việc | Kết quả |
|---|---|
| `npm run verify` | Xanh — contracts 73 · core 315 · sdk 9 · api 42; ranh giới 0 vi phạm (111 module) |
| `npm run test:db` | **78/78**: RLS 31 (thêm khoá ngoại chéo tổ chức, khôi phục bản ghi xoá) · push 17 · pull 11 · API 19 |
| Năm quy tắc | #1 hai máy trả song song 3tr + 5tr = 8tr · #2 gửi lại lô → duplicate, bấm hai lần → một phiếu · #3 xoá rồi sửa → vẫn xoá · #4 phiếu + lần trả cùng lô → cả hai; lần trả trước phiếu → `PARENT_MISSING`, dừng lô · #5 limit 1/2/3 → không lần trả nào mồ côi, không mất, không trùng |
| Test có bắt lỗi thật không | Tắt phần "kèm phiếu cha đến muộn" → test tương ứng đỏ; bật lại → xanh |
| `schema.prisma` ↔ migration | `No difference detected` |

### Lên staging · PR #5 `10da5ea`, PR #6 `9185038` · 28/09/2026

| Việc | Kết quả |
|---|---|
| `prisma migrate deploy` lên staging | ✅ Trước khi chạy: `.env` đúng project `bldlrkmszjmhifubxjvl` (in user/host, không in mật khẩu), chỉ còn đúng migration BE3, staging có 1 vựa + 2 DN + 1 nông dân, sổ trống. Chạy migration TRƯỚC khi merge — migration chỉ thêm, image cũ chạy được |
| Staging sau migration | `No difference detected` · 12 mặt hàng mặc định (vựa 4, hai DN 8, nông dân 0) · 8 trigger `keep_soft_deleted` · khoá ngoại ghép · `updated_at` `timestamptz(3)` |
| Merge | #5 rồi #6. **PR xếp chồng phải đổi base sang `master` trước khi merge** — không thì #6 vào nhánh của #5, không vào `master` |
| Render | Deploy `9185038` sau CI; `/v1/sync/pull`, `/v1/sync/push` không token → 401 đúng định dạng; preflight CORS từ `localhost:5174` → 204 |

### ✅ Nghiệm thu hai máy — `tools/login-test/sync.html` · 28/09/2026

Trang thử mới: `?may=A` / `?may=B` là hai "máy" trên một trình duyệt (sổ, hàng đợi, `deviceId`,
cursor riêng), ô "mất mạng", lập phiếu (dòng đóng băng bằng core), trả tiền, huỷ lần trả, xoá
phiếu, "dấu sổ" để so hai máy. Người dùng đăng nhập tài khoản vựa thử và chạy kịch bản; máy B
mất mạng khi trả tiền.

| | Máy A | Máy B | Database staging |
|---|---|---|---|
| Phiếu còn | 1 · 1.438.000đ | 1 · 1.438.000đ | 1.438.000 (tổng `roundedTotal` các dòng) |
| Lần trả | 500.000 đã huỷ · 300.000 còn | như máy A | như hai máy |
| Còn nợ | 1.138.000đ | 1.138.000đ | 1.438.000 − 300.000 |
| Dấu sổ | `7d37fb25` | `7d37fb25` | — |

Kèm theo, thấy được trên dữ liệu thật: hai máy cùng xoá một phiếu → 3 op xoá nhưng `audit_log`
chỉ 2 dòng `receipt.deleted` (op thứ hai là `duplicate`); lần trả của phiếu đã xoá vẫn lưu.

**Lỗi bắt được khi nghiệm thu — ở trang thử:** ô mặt hàng trống vì trang chỉ kéo về khi bấm
"Đồng bộ". Sửa: mở sổ (có mạng) là đồng bộ ngay; chưa có mặt hàng thì nói rõ và khoá nút lưu.
**Frontend thật cần làm y như vậy** (ghi vào FRONTEND.md §7). Nhãn "đã huỷ" đếm cả lần trả của
phiếu đã xoá — sửa để chỉ đếm phiếu còn.

### Phát hành `v0.4.0`

Nâng mọi gói lên 0.4.0, CHANGELOG ngày 28/09, `openapi.json` sinh lại; URL cài gói trong README
và FRONTEND.md trỏ `v0.4.0`.

### Còn treo, chuyển tiếp

- **Hợp đồng `sync` chưa có người làm frontend duyệt** — luật "PR vào contracts cần cả hai
  người". Merge theo yêu cầu của Tài để đi tiếp; báo frontend đọc FRONTEND.md §7 và góp ý bằng PR.
- Để sau (không chặn pilot): hạn mức 120 request/phút tính theo IP — mạng di động dùng chung IP
  (CGNAT); cân nhắc tính theo người dùng cho route sync.
- Nghiệm thu trên hai thiết bị thật (điện thoại) cần thêm origin LAN vào `CORS_ORIGINS` của
  staging — làm khi frontend mới có bản chạy.

---

## BE4 — Kết nối + nông dân · `a4e5edd` · tag `v0.5.0` · 28/09 → 03/10/2026 · ✅ đóng

**Quyết định của Tài (28/09): frontend làm SAU backend.** Backend làm lần lượt các bước; mỗi bước
nghiệm thu bằng trang thử `tools/login-test`, không chờ app. Hợp đồng `sync` (BE3) và `links` (BE4)
chưa có người làm frontend duyệt — duyệt khi tới lượt frontend.

**Kết quả đến giờ:** hợp đồng + API + migration + test xong; chưa lên staging. Staging chưa bật
Phone provider (`/auth/v1/settings`: `external.phone = false`) ⇒ OTP chưa chạy trên staging.

### Làm gì

- Contracts: `RouteDef.params` (tham số đường dẫn — interceptor, `@ContractParams()`, SDK điền
  `:id`, openapi `{id}` + `in: path`, test bắt `:ten` khớp schema). Sáu route: `linksList`,
  `linksInvite`, `linksAccept`, `linksRevoke`, `linkedReceipts`, `linkedBalance`. `LinkedReceipt`
  chỉ trường in trên biên nhận (đọc từ `receiptText.ts` của core + KH "cân, giá, tổng, các lần
  trả, còn nợ"). SDK: `links.*`, `linked.*`.
- Migration `20260928120000_be4_ket_noi` (không đổi bảng): trigger `partner_links_guard`,
  `discover_links` nhận lời mời của vựa, `my_links()`, `linked_receipts()`.
- API `LinksService`: đồng ý kiểm lại số đã xác thực TRÙNG `invited_phone` ngay lúc bấm; huỷ theo
  phía; tổng/còn nợ tính bằng `@mambo/core`; audit `link.invited/accepted/revoked`; sự kiện
  `link.accepted/revoked`.
- Trang thử: trang đồng bộ lập phiếu cho người bán có SĐT + "Mời kết nối"; trang tài khoản có mục
  "Kết nối" (đồng ý, huỷ, xem phiếu, công nợ).

### Chạy thật đã kiểm (máy dev)

| Việc | Kết quả |
|---|---|
| `npm run verify` | Xanh — contracts 75 · core 315 · sdk 10 · api 42 |
| `npm run test:db` | **91/91** — thêm 10 test kết nối + 3 test luật ở database |
| Luồng nghiệm thu (test) | Vựa ghi phiếu nợ 938.000 → cô Mai xác thực, dò, đồng ý → đúng 1 phiếu (không phiếu đã xoá, không phiếu người khác, không khách lẻ), `total 1.438.000 · paid 500.000 · debt 938.000`; không lọt ghi chú nội bộ / người lập / id mặt hàng → vựa huỷ → `LINK_REQUIRED` ngay, công nợ rỗng |
| Chống giả số | Số đã xác thực khác số được mời → `PHONE_NOT_VERIFIED`. Thử bỏ kiểm tra này → test đỏ |
| Luật ở database | Bên sổ tự bật `active` → bị chặn; tạo thẳng `active`, đổi bên được liên kết, mở lại `revoked` → bị chặn |
| `schema.prisma` ↔ migration | `No difference detected` |

### Mã kết nối thay OTP · 01/10/2026

**Quyết định của Tài:** bỏ OTP SMS khỏi luồng kết nối; dùng **mã kết nối** vựa trao tận tay (sau
này QR chứa đúng mã). OTP **giữ trong code, ẩn đi** — mở lại khi **> 100 tổ chức trả phí**. Cần báo
cả nhóm: đây là sửa quyết định #4 của 21/09 (THONG_TIN §9 #3, thêm #13).

Vì sao không chỉ tắt kiểm OTP: số lúc đăng ký do người dùng tự gõ, không ai xác minh ⇒ ai đăng ký
trước bằng số cô Mai sẽ nhận lời mời và xem công nợ của cô. Mã do chính vựa — người biết mặt cô
Mai — trao tận tay nên chứng minh đúng điều cần; không tốn SMS, không cần brandname.

#### Làm gì

- Contracts: `LinkCode` (chuẩn hoá `k7m2-qx9p` → `K7M2QX9P`), `LINK_CODE_ALPHABET` (31 ký tự, bỏ
  0/O/1/I/L), `LINK_CODE_LENGTH` 8, `LINK_CODE_TTL_DAYS` 7; `LinkSummary.inviteCode`; route
  `linksClaim` (`POST /v1/links/claim`, `linked:read`, 10/phút/IP). SDK `links.claim`.
- Migration `20261001000000_be4_ma_ket_noi` (chỉ thêm): cột `invite_code` (duy nhất) +
  `invite_code_expires_at`; CHECK hình dạng + đi cặp; trigger — chỉ bên sổ cấp mã, mã bị xoá khi
  rời `pending`; `my_links()` trả mã chỉ cho bên sổ (drop + tạo lại vì đổi kiểu trả về);
  `claim_link(code)` security definer.
- API: `invite` cấp mã (mã còn hạn → trả lại đúng mã; hết / sắp hết < 1 giờ → mã mới; trùng mã →
  làm lại cả transaction, tối đa 3 lần), dòng danh bạ không cần SĐT; `claim` (mã của mình → 422;
  sai / đã dùng / hết hạn → cùng một câu 404; audit `link.accepted` kèm `via: 'code'`, mã không vào
  audit). `discover`/`accept` giữ nguyên, ghi chú "tạm ẩn".
- Trang thử: `sync.html` — "Mời kết nối" hiện mã + hạn, "Lấy mã mới" khi hết hạn, người bán không
  cần SĐT; `index.html` — ô "Nhập mã kết nối", OTP gập vào mục "tạm ẩn".
- Tài liệu: KH §1.4 viết lại (hai đường), §6, BE4, §9 thêm "Mở lại OTP" kèm điều kiện, §11, §12 ·
  THONG_TIN §1, §3, §6, §8, §9 (#3 sửa, #13 mới), §10 · FRONTEND §5.5 (không làm màn OTP), §5.6 (mã,
  QR), bảng BE4 · CHANGELOG 0.5.0 · README.

#### Quyết định

1. **Mã lưu nguyên văn, không băm** — bên sổ mở lại là thấy đúng mã / QR cũ. Ai đọc được bảng thì
   đã đọc được chính phần sổ mà mã mở ra; băm không che thêm gì.
2. **8 ký tự** (≈ 8,5 × 10¹¹ mã) chứ không 6: 6 ký tự với vài nghìn mã đang sống và nhiều IP thì
   xác suất đoán trúng trong một tuần không còn nhỏ. QR sau này gánh việc gõ.
3. **Nhập mã = đồng ý**, một bước — không có màn "xem trước rồi đồng ý".
4. Lời mời đã có bên được liên kết (dò bằng OTP) thì chỉ chính bên đó nhập mã được.
5. Mở lại OTP **không cần sửa backend**: bật Phone provider + nhà cung cấp SMS + màn OTP + sửa
   trang Quyền riêng tư.

#### Chạy thật đã kiểm (máy dev)

| Việc | Kết quả |
|---|---|
| `npm run verify` | Xanh — contracts 78 · core 315 · sdk 11 · api 42; ranh giới 0 vi phạm (113 module) |
| `npm run test:db` | **103/103** — links 19 (luồng mã, dùng một lần, hai người nhập cùng lúc → đúng một, hết hạn, mời lại, không SĐT, mã của mình, 429 ở lần 11, vai trò, đường OTP, hai đường gặp nhau) · RLS +3 (trigger mã, `claim_link`) |
| Test có bắt lỗi thật không | Cho `my_links()` trả mã cả hai phía → 1 test đỏ; bỏ đoạn trigger xoá mã → 4 test đỏ; dựng lại DB → xanh |
| `schema.prisma` ↔ migration | `No difference detected` |
| Trang thử (preview) | Hai trang tải không lỗi console; có ô nhập mã, OTP nằm trong mục gập |

### Còn lại của BE4

- [x] ~~Bật Phone provider + chọn nhà cung cấp SMS~~ → không cần: OTP tạm ẩn (01/10).
- [x] Merge, `prisma migrate deploy` lên staging, nghiệm thu, phát hành `0.5.0` — xem bên dưới (03/10).

### Lên staging · PR #8 `a4e5edd` · 03/10/2026

| Việc | Kết quả |
|---|---|
| `prisma migrate deploy` lên staging | ✅ Trước khi chạy: `.env` đúng project `bldlrkmszjmhifubxjvl` (in user/host, không in mật khẩu); `20260928120000_be4_ket_noi` đã có trên staging từ 28/09, chỉ còn `20261001000000_be4_ma_ket_noi`; staging 2 vựa · 2 DN · 1 nông dân, chưa có kết nối nào. Chạy TRƯỚC khi merge — chỉ thêm, image BE3 không đụng tới |
| Staging sau migration | `No difference detected` · cột `invite_code` + hạn · `claim_link()` có; `anon`/`authenticated` không gọi được `claim_link`, `my_links` |
| CI PR #8 | `verify`, `db`, `docker` xanh trên `ed28f41`; merge (Tài bấm — PR có `packages/contracts`) |
| Render | Deploy `a4e5edd` sau CI `master`; `/v1/links/claim`, `/v1/links/invite`, `/v1/links`, `/v1/linked/balance` không token → 401 đúng định dạng; preflight CORS từ `localhost:5174` cho qua |

### ✅ Nghiệm thu — `npm run smoke:links` · 03/10/2026

Script mới (như `smoke:me`): Tài tự chạy, tự gõ hai tài khoản thử (vựa + nông dân) — mật khẩu không
hiện, không in. Chạy đủ "Xong khi" của BE4 trên staging: **22/22 mục đạt**.

| Bước | Kết quả |
|---|---|
| Vựa ghi phiếu mua cho người bán **không SĐT** qua `/sync/push` | 3 op `applied` · Cao su 120 kg · tổng 1.726.000 · trả 575.000 · còn nợ 1.151.000 |
| Mời → mã; mời lại | Mã 8 ký tự, hạn 7 ngày; mời lại → đúng kết nối, đúng mã cũ |
| Vựa nhập mã của mình | 422 `VALIDATION_FAILED` |
| Nông dân gõ mã chữ thường có gạch | `active`, đúng sổ vựa; bên được mời không thấy mã |
| Nông dân xem | Đúng 1 phiếu, tổng / đã trả / còn nợ khớp từng đồng, dòng hàng khớp, không lộ trường nội bộ; công nợ có vựa đó (1.151.000) |
| Mã đã dùng · mã bịa | Cùng 404 `NOT_FOUND`, cùng một câu |
| Vựa huỷ | `revoked` → nông dân `LINK_REQUIRED` ngay; công nợ không còn vựa đó |
| Database staging (chỉ đọc) | Kết nối `pending → active → revoked`, `invite_code` đã xoá, `invited_phone` null; `audit_log` đủ `link.invited` · `link.accepted` (`via: code`, không có mã trong audit) · `link.revoked` (`side: owner`), đều có `requestId`; phiếu 1.726.000 − 575.000 = 1.151.000 |

Dữ liệu thử để lại trong sổ vựa: người bán "Nghiệm thu BE4 22:27:57 3/10/2026", một phiếu, một lần trả,
một kết nối đã huỷ.

**Kèm theo:** PowerShell trên máy dev chặn `npm.ps1` (execution policy) — chạy bằng
`node scripts/smoke-links.mjs` hoặc `npm.cmd run smoke:links`; không đổi chính sách của máy.

### Phát hành `v0.5.0`

Nâng mọi gói lên 0.5.0, CHANGELOG ngày 03/10, `openapi.json` sinh lại; URL cài gói trong README và
FRONTEND.md trỏ `v0.5.0`; FRONTEND §5.6, bảng bước, THONG_TIN cập nhật BE4 ✅.

### Còn treo, chuyển tiếp

- Hợp đồng `links` (cùng `sync` của BE3) chưa có người làm frontend duyệt — duyệt khi tới lượt frontend.
- **BE5 → BE10:** có bản làm sẵn trên nhánh `be/nestjs-be10` của repo frontend (03/10). Tài chốt:
  **`Thumua365_BE` là repo chính, chỉ chứa backend** — gom phần backend về đây, soát và sửa trước, mỗi
  bước một PR, nghiệm thu staging từng bước như BE3, BE4.

---

## BE5 — Đơn, đặt lịch, thông báo · 🟡 đang làm · nhánh `be5/don-hang` · 03/10/2026

**Kết quả:** hợp đồng + migration + API + test xong trên Postgres thật (`test:db` **108/108**), đúng
luồng nghiệm thu R2. Chưa lên staging (cần BE4 lên trước — cùng chuỗi migration). Làm trên nhánh tách
từ `master` của monorepo (đã gồm BE4 chưa merge).

### Làm gì

- Contracts: `orders.ts` (`OrderCreateInput`, `OrderSummary`, `OrderDetail`, chuyển trạng thái),
  `notifications.ts`, 9 route trong `routes-orders.ts`; `orderId` cho phiếu/nháp trong sync. Tách
  `route-def.ts` và `sync-records-core.ts` để mọi file `packages/*/src` ≤ 300 dòng (`routes.ts` sẽ còn
  lớn thêm ở BE6–BE9).
- Migration `20261003000000_be5_don_hang`: `order_events.actor_org_id`; `orders.created_at`,
  `notifications.created_at` → `timestamptz(3)`; trigger `orders_guard`, `book_order_guard`; hàm
  `order_counterparts()`, `notify_order()`, `notify_link()`; CHECK `notifications.kind`.
- API: `OrdersService` (+ `order-records.ts` dùng chung với sync), `NotificationsService`,
  `NotificationsListener` (sau commit, lỗi không làm hỏng việc chính), sync push: phiếu theo đơn →
  `fulfilled` cùng transaction, phát `order.fulfilled` sau commit. `common/page-cursor.ts`.
- SDK: `orders.*`, `notifications.*`.

### Quyết định

1. **Ai làm bước nào** — kế hoạch chưa nói: accept/reject = bên NHẬN đơn; schedule = bên MUA (người
   đến cân); cancel = bên nào cũng được. Giữ ở cả API lẫn trigger.
2. **`fulfilled` từ mọi trạng thái còn mở** (kể cả `submitted`): phiếu là việc đã cân thật, đơn phải
   phản ánh thực tế. Đơn đã `fulfilled` nhận thêm phiếu (giao nhiều lần) — chỉ gắn, không đổi gì.
3. **Đơn không có / sai bên → `rejected` `VALIDATION_FAILED`**, không âm thầm gỡ `orderId`: đó là lỗi
   của app (đơn không bao giờ bị xoá, hai bên không đổi) — giống id `prod-…` ở BE3.
4. **Thông báo là của tổ chức** (`user_id` null), một trạng thái đã đọc cho mọi thành viên — đủ cho
   pilot. `NotificationKind` liệt kê sẵn loại của BE6/BE7: thêm giá trị vào enum trong phản hồi sẽ làm
   SDK cũ (kiểm phản hồi bằng zod) vỡ.
5. **Ghi thông báo cho bên kia bằng hàm security definer** chứ không đổi `app.org_id` sang tổ chức
   nhận — hàm chỉ ghi được cho đúng bên kia của một đơn/kết nối mà mình là một bên.
6. **Email chưa làm**: cần chọn nhà cung cấp gửi thư (Resend/SES/SMTP) và thêm pg-boss. Chỗ gắn đã có
   trong `NotificationsListener`.
7. Đơn **không** bật theo `features` — giống kết nối (BE4). Bật theo tổ chức quyết ở BE10.
8. Đơn tạo bởi bên kia cho DN có `branch_id` null ⇒ người gắn chi nhánh không thấy; gán chi nhánh cho
   đơn để BE7.

### Lỗi bắt được trong lúc làm

- 🔴 **Phân trang đơn/thông báo sẽ bỏ sót bản ghi**: `created_at` micro-giây, cursor JS Date mili-giây —
  đúng lỗi BE3 đã gặp với `updated_at`. Đổi hai cột sang `timestamptz(3)` trước khi có dữ liệu.
- 409 của bên bấm chậm trả `status/version` **cũ** (đọc trước khi bên kia commit) → đọc lại sau khi
  `updateMany` không khớp hàng nào. Test hai người bấm cùng lúc bắt được.
- Thử gỡ luật "đơn đã huỷ → gỡ `orderId`" → phiếu bị `rejected` (trigger chặn cancelled → fulfilled),
  hàng đợi kẹt — test đỏ; bật lại → xanh.

### Chạy thật đã kiểm

| Việc | Kết quả |
|---|---|
| `npm run verify` | Xanh — contracts 75 · core 315 · sdk 11 · api 42 · web 370; ranh giới 0 vi phạm |
| `npm run test:db` | **108/108** — thêm 17 test đơn/thông báo/luật database |
| Luồng R2 (test) | Cô Mai gửi đơn → vựa nhận, hẹn lịch → cô Mai thấy lịch (đơn + thông báo) → vựa đẩy phiếu theo đơn + trả 500.000 → đơn `fulfilled` v4, lịch sử 4 mốc đúng bên → cô Mai thấy phiếu `1.438.000 · đã trả 500.000 · còn nợ 938.000` |
| `schema.prisma` ↔ migration | `No difference detected` |

### Còn lại của BE5

- [ ] Kênh email (nhà cung cấp + pg-boss).
- [ ] Lên staging sau BE4; nghiệm thu bằng trang thử; một test Playwright chạy luồng R2 trong CI (cần
      app web đã có màn đơn).
- [ ] Phát hành `0.6.0`.

### Gom về repo BE · nhánh `be5/don-hang` · 03/10/2026

Mục BE5 phía trên là nhật ký của `k20elite` trên nhánh `be/nestjs-be10` (repo frontend), chép theo
commit — số test "web 370", tên nhánh và chữ "monorepo" là của nhánh đó. Quyết định của Tài:
`Thumua365_BE` là repo chính, chỉ chứa backend; lấy phần backend về đây từng bước, soát và sửa trước.

- Cherry-pick giữ tác giả `c0d9174`, `5d8a5bb`, `b1b766a` lên `master` (`v0.5.0`); gỡ xung đột với
  mã kết nối (test SDK giữ cả `links.claim` lẫn `orders.schedule`; CHANGELOG 0.6.0 nối sau 0.5.0).
- Sửa khi gom: đường `/links/claim` gửi `actorUserId` trong `link.accepted` (BE5 bắt buộc trường này
  để listener thông báo chạy trong ngữ cảnh người gây ra việc).
- **Đảo quyết định BE5 #3:** đơn không có / sai bên không còn `rejected` — phiếu, nháp vẫn ghi, gỡ
  `orderId`, `ORDER_NOT_OPEN`. Lý do: xoá tài khoản (BE6) xoá luôn đơn của bên kia; vựa đang cân
  offline đẩy phiếu theo đơn đó lên sẽ bị từ chối ⇒ cả hàng đợi dừng — đúng loại lỗi `prod-rubber` BE3.
- Hoàn thành đơn xét trạng thái **sau khi khoá hàng của đơn** (`select … for update`): vựa và DN cùng có
  sổ, khoá advisory theo tổ chức không chặn nhau ⇒ trước đây bên đẩy sau vướng `orders_guard` thành
  `INTERNAL`; bản sửa đầu (`updateMany … where status`) hết lỗi đó nhưng lịch sử đơn ghi bước trước là
  trạng thái đọc lúc đầu ("submitted → fulfilled" khi đơn vừa được nhận ở máy khác). Hai test giữ khoá
  hàng của đơn bằng một transaction mở để tái hiện chắc chắn — đỏ trước khi sửa.
- **`truncateAll` của test DB đợi listener lắng, thử lại khi deadlock** — bản sửa có ở BE9, chuyển xuống
  đây vì listener thông báo có từ BE5. Soát lại cả chuỗi (03/10, tối): `test:db` của be5 122/123, be6
  154/155 — đều deadlock ở `truncateAll`; CI của PR BE5–BE8 sẽ đỏ ngẫu nhiên nếu không sửa.

| Việc | Kết quả |
|---|---|
| `npm run verify` | Xanh — contracts 78 · core 315 · sdk 12 · api 42; ranh giới 0 vi phạm |
| `npm run test:db` (database dựng lại từ đầu) | **124/124**, hai lần liền — thêm 5 test cho ba chỗ sửa (đỏ trước khi sửa) |
| `schema.prisma` ↔ migration | `No difference detected` |

---

## BE7 — Doanh nghiệp: nhân viên, chi nhánh, báo cáo · 🟡 · nhánh `be7/doanh-nghiep` · 03/10/2026

**Kết quả:** hợp đồng + migration + API + test xong (`test:db` **119/119**), đúng "Xong khi": DN hai
chi nhánh, mỗi nơi một người cân do chủ tạo — mỗi người chỉ kéo về phiếu chi nhánh mình; báo cáo của
chủ: tổng = hai chi nhánh cộng lại; chi nhánh thứ 3 với gói 2 → `BRANCH_LIMIT`.

### Làm gì

- Contracts `org.ts` + `routes-org.ts`: 8 route (members ×4, branches ×3, reports). SDK `org.*`, `reports.*`.
- Migration `20261003010000_be7_doanh_nghiep` (không đổi bảng): trigger `memberships_guard`, hàm
  `org_members()`, `create_member_profile()`.
- API: `MembersService` (tạo tài khoản qua Auth Admin API → membership + hồ sơ cùng transaction; hỏng
  thì xoá tài khoản vừa tạo), `BranchesService` (khoá advisory, lưu trữ), `ReportsService`.
  `SupabaseAdmin` thêm `createUser`, `deleteUser`. Audit: `member.added/removed/role_changed`,
  `branch.created/updated`.

### Quyết định

1. **Chủ tạo tài khoản cho nhân viên, không mời.** Bảng có sẵn trạng thái `invited` nhưng mời cần
   người kia tự đăng ký — mà "Bác là ai?" luôn tạo một tổ chức mới — và cần OTP (chưa có). Cách tạo
   tài khoản giống phần mềm bán hàng phổ biến; người cân chỉ cần SĐT + mật khẩu.
2. **Số đã có tài khoản nơi khác → `ACCOUNT_EXISTS`.** Một người làm cho hai nơi: để sau (luồng mời).
   Người từng bị gỡ khỏi chính tổ chức → bật lại, **không** đổi mật khẩu của họ.
3. **`owner` chỉ có từ bootstrap** — trigger chặn nâng / tước / gỡ / thêm chủ thứ hai bằng
   `api_service`. API cũng chặn sửa chủ và tự sửa chính mình.
4. Thành viên DN gắn chi nhánh thấy báo cáo chi nhánh mình; vựa owner có `branch:manage` theo ma
   trận nên vựa cũng tạo được chi nhánh (giới hạn theo `branch_limit` của gói — vựa đang null).
   **Cần nhóm quyết:** vựa có được nhiều chi nhánh với giá 149.000đ không.
5. Không phát sự kiện / thông báo `member.*` — chưa có ai nhận (người được thêm thấy ngay trong
   `/me`). Audit đủ cho truy vết.

### Lỗi bắt được trong lúc làm

- Hai người tạo chi nhánh cùng lúc vượt giới hạn gói — thử bỏ khoá advisory: test đỏ 3/3 lần.
- Lint chặn `_count._all` (no-underscore-dangle) của `groupBy` — đếm bằng JS.

### Còn lại của BE7

- [ ] Lên staging (sau BE4, BE5); `SUPABASE_SECRET_KEY` của Render đã có (BE2) — tạo tài khoản thật.
- [ ] Vỏ Doanh nghiệp ở frontend.

**Gom về repo BE** (nhánh `be7/doanh-nghiep`, 03/10): cherry-pick `e6f746a` giữ tác giả, không sửa code. `verify`
xanh; `test:db` **134/134** trên database dựng lại từ đầu; schema khớp migration.

---

## BE6 — Tài khoản, gói, thanh toán · 🟡 · nhánh `be6/goi-thanh-toan` · 03/10/2026

**Kết quả:** hợp đồng + migration + API + test xong (`test:db` **137/137**). VAN_HANH §7.3 (bản cũ,
`apps/web/supabase/VAN_HANH.md`) chạy trên API: #1 tự mua → tiền vào → gói mở → đẩy sổ được; #2 ba
lần (cả song song) cùng mã → một lần; #3 sai bí mật → 401; #4 thiếu tiền → không mở; #5 quản trị viên
mở tay, chạy lại → "đã xử lý"; #7 hết gói → 402; #8 api_service không tự mở gói (database chặn).

### Làm gì

- Contracts `account.ts` + `routes-account.ts` (10 route); `RouteAuth` thêm `admin`. SDK
  `account.*`, `billing.*` (không đưa admin / webhook vào SDK của app).
- Hạ tầng: `PrivilegedDatabase` (role `api_privileged`, `PRIVILEGED_DATABASE_URL` — tuỳ chọn, thiếu
  thì ba việc đặc quyền báo lỗi), `BANK_WEBHOOK_SECRET`, `ADMIN_USER_IDS`; `PermissionGuard` kiểm quản
  trị viên; `StorageAdmin` (xoá thư mục ảnh của tổ chức); `SupabaseAdmin.setPassword`.
- Migration `20261003020000_be6_goi_thanh_toan`: `claim_referral()` (bản cũ, `app_user_id()`),
  trigger `billing_guard` trên `subscriptions` + `payment_intents`, `find_login_user` cho api_privileged.
- API: `BankWebhookService` (thay Edge Function `payment-webhook`), `plan-activation.ts` (dùng chung với
  quản trị), `BillingService`, `ProfileService`, `AccountDeletionService`, `AdminService`.

### Quyết định

1. **Một transaction cho cả ghi sổ đối soát và gia hạn.** Bản cũ (REST, không có transaction) cố ý ghi
   sổ trước để hỏng giữa chừng thì "tiền đã ghi, gói chưa mở". Có transaction thì hoặc cả hai hoặc không
   — Casso / SePay gửi lại là xong. Vẫn giữ thứ tự ghi sổ trước.
2. **Quản trị viên xác thực bằng chính tài khoản** (JWT + `ADMIN_USER_IDS`) thay vì một khoá dùng
   chung: nhật ký ghi được ai bấm, ngoài người duyệt gõ tay.
3. **`billing_guard` ở database** — endpoint thường lỗi code cũng không thành đường tự gia hạn miễn
   phí. Bootstrap chỉ tạo được gói `trialing` không có kỳ trả tiền.
4. **Xoá tài khoản xoá hẳn tổ chức chủ duy nhất, kể cả đơn và kết nối với bên kia** (phiếu của bên kia
   còn, `order_id` về null). Giữ `bank_transactions` (không thì xoá tài khoản thành cách dùng lại một
   mã giao dịch), `audit_log`, `admin_access_log`. Tổ chức còn người làm → phải gỡ họ trước.
5. Mua trong lúc dùng thử: kỳ tính từ hôm nay (`extendPeriod` của core, như bản cũ) — ngày dùng thử còn
   lại không cộng dồn. **Cần nhóm quyết** có cộng dồn không.
6. Doanh nghiệp không tự mua: `selfServe: false`, quản trị viên kích hoạt kèm `branchLimit`.

### Lỗi bắt được trong lúc làm

- Test chọn số `0999…` và mã giao dịch 2 ký tự — 422 vì lý do khác lý do định kiểm. Sửa để mỗi ca
  422 đúng là vì luật đang kiểm.
- Thử bỏ chốt "mã giao dịch đã có → dừng": ba lời gọi song song gia hạn hai lần — test đỏ.

### Còn lại của BE6

- [ ] **Số tài khoản nhận tiền, người chịu trách nhiệm pháp lý** (Nguyên, Linh) → điền config của app.
- [ ] Đặt mật khẩu `api_privileged` trên Supabase (như `db:role-password`), điền
      `PRIVILEGED_DATABASE_URL`, `BANK_WEBHOOK_SECRET`, `ADMIN_USER_IDS` trên Render; khai URL webhook ở
      Casso / SePay.
- [ ] Một lần chuyển khoản thật; một lần hoàn tiền thật (#6). Sau đó gỡ Edge Function `payment-webhook`.


### Gom về repo BE · nhánh `be6/goi-thanh-toan` · 03/10/2026

Cherry-pick `82ef0bf` giữ tác giả. **Sửa khi gom — mỗi định danh đăng nhập trỏ đúng một người:** `find_login_user`
tra "tên OR SĐT OR email … LIMIT 1", mà tên đăng nhập được phép giống SĐT và email khôi phục không duy nhất ⇒ một
định danh có thể khớp hai hồ sơ; BE6 cho sửa hai trường đó bất cứ lúc nào và quản trị viên tra tài khoản theo SĐT
bằng chính hàm này. Sửa: schema `Username` (contracts) không cho giống SĐT, CHECK cùng luật ở database, email khôi
phục duy nhất trong hồ sơ còn dùng, `find_login_user` tra đúng một loại định danh theo cách gõ (migration
`20261003030000_be6_dinh_danh_dang_nhap`, chỉ thêm — staging kiểm trước: 0 hồ sơ vi phạm). Phần đăng ký (BE2)
cũng được chặn theo, vì dùng chung `Username`.

| Việc | Kết quả |
|---|---|
| `npm run verify` | Xanh — contracts 80 · core 315 · sdk 12 · api 42 |
| `npm run test:db` (database dựng lại từ đầu, 8 migration) | **155/155** — thêm 3 test cho chỗ sửa (đỏ trước khi sửa) + 1 test chốt tên toàn chữ số |
| `schema.prisma` ↔ migration | `No difference detected` |

---

## BE8 — Ảnh chứng từ · 🟡 · nhánh `be8/anh-chung-tu` · 03/10/2026

**Kết quả:** hợp đồng + API + test xong (`test:db` thêm 5). Đúng "Xong khi" ở mức API: người cân chụp
lúc mất mạng → có mạng xin URL, tải lên, đẩy phiếu → máy của chủ xin được URL xem (10 phút).

### Làm gì

- Contracts `attachments.ts`, 2 route trong `routes.ts`. SDK `attachments.upload(id, blob)` gói cả
  xin URL + PUT + coi 409 là xong; `attachments.url(id)`.
- `StorageAdmin.signUpload`, `signDownload` (Supabase Storage REST bằng khoá secret). Không cần migration.
- `AttachmentsService`: đường dẫn luôn trong thư mục tổ chức đang làm việc; xem cần phiếu / nháp nhắc tới
  id, cùng lọc chi nhánh như sổ.

### Quyết định

1. **Không ghi đè** (`x-upsert: false`): ảnh chứng từ không bị thay sau khi đã lên; hàng đợi gửi lại
   gặp 409 thì coi là xong — đúng nghĩa idempotent.
2. **Tải lên không cần phiếu có trước** — ảnh chụp lúc mất mạng có thể lên trước op của phiếu. Xem thì
   cần (đó là chỗ kiểm phạm vi).
3. Không có bảng `attachments`: id nằm trong `attachment_ids` của phiếu / nháp là đủ để kiểm quyền; ảnh
   mồ côi (chụp rồi bỏ phiếu) nằm lại trong thư mục tổ chức tới khi xoá tài khoản — chấp nhận ở pilot.

### Còn lại của BE8

- [ ] Supabase (staging, prod): bucket `attachments` **riêng tư**, giới hạn 3MB, chỉ
      `image/jpeg,image/png,image/webp`; **không** policy nào cho `authenticated` / `anon`.
- [ ] Thử thật: URL hết hạn thì không mở được; PUT lại ảnh đã có → 409.
- [ ] Frontend: hàng đợi ảnh trong `attachments.ts`.


**Gom về repo BE** (nhánh `be8/anh-chung-tu`, 03/10): cherry-pick `1c19ff4` giữ tác giả, không sửa code. `verify`
xanh; `test:db` **160/160**. Còn để ý: hợp đồng sync cho tối đa 10 ảnh mỗi phiếu / nháp, app cũ giới hạn 5
(`MAX_ATTACHMENTS`) — chốt một số khi frontend làm màn ảnh.

---

## Bốn số phải giữ trong tầm

| Chỉ số | Ngưỡng | Cuối BE0 |
|---|---|---|
| Phủ test `core` | ≥ 80% dòng | **97,7%** |
| Vi phạm ranh giới | 0 | **0** |
| File dài nhất trong `packages/*/src` | ≤ 300 dòng | 285 (`sheetImport.ts`, bê từ frontend) · BE3: 300 (`contracts/src/sync-records.ts`) |
| Thời gian phản hồi p95 API | ≤ 300ms ở staging | `/v1/health` ~300ms từ máy dev (gồm mạng VN → Singapore); đo p95 thật từ BE9 |

---

## Việc còn treo vì cần thứ ngoài repo

| Việc | Cần gì | Chặn bước |
|---|---|---|
| Tên miền `api.thumua365.vn`, `api-staging.thumua365.vn` | Quyền DNS của `thumua365.vn` | Không chặn — tạm dùng `*.onrender.com` |
| ~~Docker Desktop trên máy dev~~ | ✅ đã cài 22/09/2026 (Docker 29.8, WSL2) | — |
| Nhà cung cấp SMS cho OTP | Chọn + đăng ký (Twilio/Vonage hoặc eSMS/SpeedSMS qua Send SMS Hook) | Không chặn — OTP tạm ẩn tới khi > 100 tổ chức trả phí |
| Số tài khoản nhận tiền, người chịu trách nhiệm pháp lý | Nguyên, Linh | BE6 |

---

## Ghi chú vận hành

- Máy làm việc: **Windows 11, Node 24, npm 11, `gh` 2.101 (đăng nhập `remembered-fragrance`),
  Docker Desktop 29.8 trên WSL2.** CI chạy Node 22 (`engines: >=22`). Trong Git Bash cần
  thêm `/c/Program Files/Docker/Docker/resources/bin` vào PATH mới gọi được `docker`.
- Git đang bật `core.autocrlf=true` ⇒ cảnh báo "LF will be replaced by CRLF" khi commit là
  bình thường; trong repo vẫn lưu LF.
- Phát hành phiên bản mới: nâng `version` của **mọi** gói cùng lúc → ghi
  `packages/contracts/CHANGELOG.md` → `git tag vX.Y.Z && git push origin vX.Y.Z`. Tag lệch
  version thì `release.yml` dừng.
- **Docker trên Windows không mở được cổng 54329** khi Windows giữ dải cổng động chứa nó
  (`netsh interface ipv4 show excludedportrange protocol=tcp`, gặp 28/09: dải 54255–54354). Chạy
  tạm ở cổng khác bằng file ghi đè `ports: !override` + `TEST_DATABASE_ADMIN_URL` /
  `TEST_DATABASE_SERVICE_URL`; sửa hẳn cần admin (khởi động lại dịch vụ `winnat`) hoặc đổi cổng.
- Xem CI: `gh run list -L 3` · PR: `gh pr checks <số>`. Không có `gh` thì
  `curl -s https://api.github.com/repos/remembered-fragrance/Thumua365_BE/actions/runs?per_page=1`.
