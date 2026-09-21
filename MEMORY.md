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
| Trạng thái sản phẩm | BE0–BE2 xong, chạy trên staging (Render + Supabase) · OTP dời sang BE4 · chỉ có tài khoản thử, **chưa có dữ liệu thật** · tiếp theo: BE3 |

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

## Bốn số phải giữ trong tầm

| Chỉ số | Ngưỡng | Cuối BE0 |
|---|---|---|
| Phủ test `core` | ≥ 80% dòng | **97,7%** |
| Vi phạm ranh giới | 0 | **0** |
| File dài nhất trong `packages/*/src` | ≤ 300 dòng | 285 (`sheetImport.ts`, bê từ frontend) |
| Thời gian phản hồi p95 API | ≤ 300ms ở staging | `/v1/health` ~300ms từ máy dev (gồm mạng VN → Singapore); đo p95 thật từ BE9 |

---

## Việc còn treo vì cần thứ ngoài repo

| Việc | Cần gì | Chặn bước |
|---|---|---|
| Tên miền `api.thumua365.vn`, `api-staging.thumua365.vn` | Quyền DNS của `thumua365.vn` | Không chặn — tạm dùng `*.onrender.com` |
| ~~Docker Desktop trên máy dev~~ | ✅ đã cài 22/09/2026 (Docker 29.8, WSL2) | — |
| Nhà cung cấp SMS cho OTP | Chọn + đăng ký (Twilio/Vonage hoặc eSMS/SpeedSMS qua Send SMS Hook) | BE4 (dời từ BE2) |
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
- Xem CI: `gh run list -L 3` · PR: `gh pr checks <số>`. Không có `gh` thì
  `curl -s https://api.github.com/repos/remembered-fragrance/Thumua365_BE/actions/runs?per_page=1`.
