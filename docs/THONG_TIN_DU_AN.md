# THÔNG TIN DỰ ÁN — Mambo365 / THUMUA365

> **Đọc file này đầu tiên.** Nó tổng hợp mọi thứ đã chốt và chưa chốt tính đến
> **21/09/2026** (cập nhật sau BE1): sản phẩm là gì, ai dùng, kiến trúc đích, repo đang có gì, làm theo thứ
> tự nào, và nhóm còn phải quyết gì. Chi tiết kỹ thuật nằm ở các file được dẫn tới.

---

## 1. Tổng quan

| | |
|---|---|
| Tên | **Mambo365 / THUMUA365** |
| Sứ mệnh (theo sơ đồ) | *Kết nối nông dân – thương lái – doanh nghiệp vì một chuỗi nông sản minh bạch và hiệu quả* |
| Hướng cũ (A→G, 08/2026) | Sổ thu mua cho **một** vai trò — chủ vựa / thương lái. Chạy offline, React + Supabase trực tiếp |
| Hướng mới (09/2026) | **Nền tảng ba vai trò** trên một chuỗi, backend **NestJS** theo sơ đồ kiến trúc |
| Nông sản trọng tâm | Cao su · điều · cà phê · tiêu |
| Nền tảng | Web (React + TS, PWA offline) · Android (lên CH Play) |
| Tình trạng một câu | Frontend + nghiệp vụ tính tiền **đã có và có test**. Backend xong **BE0–BE1**: API staging chạy trên Render (`/v1/health`, `/v1/me` kiểm JWT thật), hai project Supabase (staging, prod) đã tạo. **Chưa có database nghiệp vụ, chưa có dữ liệu thật** — bước tiếp là BE2. Nhật ký: [MEMORY.md](../MEMORY.md) |

### Phân công

| Người | Việc |
|---|---|
| **Tài** | Backend (NestJS, database, hạ tầng, hợp đồng API) — repo [Thumua365_BE](https://github.com/remembered-fragrance/Thumua365_BE) |
| *(thành viên frontend)* | Frontend (ba "vỏ" giao diện, lớp `src/data/` nối API) |
| **Nguyên** | Kinh doanh, người chịu trách nhiệm trên trang pháp lý, phỏng vấn người dùng |
| **Linh** | Tài chính — mọi thay đổi giá phải qua |
| **Tuyến** | Thiết kế — bộ ký hiệu nông sản |

---

## 2. Ba vai trò và chuỗi giá trị

```
 Nông dân ──(đơn bán, hẹn lịch)──▶ Thương lái / Vựa / Đại lý ──(đơn bán, giao hàng)──▶ Doanh nghiệp
     ▲                                  │ phiếu cân, trả tiền, ghi nợ                    │ nhân viên,
     └──── xem phiếu + công nợ ◀────────┘                                                │ chi nhánh
```

| Vai trò | Làm gì (theo sơ đồ) | Trạng thái |
|---|---|---|
| **Nông dân** | Đăng ký/đăng nhập · bán nông sản · theo dõi đơn hàng, công nợ | ❌ Mới — hiện chỉ là dòng danh bạ trong sổ của vựa |
| **Thương lái / Chủ vựa / Đại lý** | Mua & bán · quản lý kho, công nợ · đặt lịch, giao dịch | ✅ Là toàn bộ app hiện tại (trừ đặt lịch) |
| **Doanh nghiệp** | Mua & bán · quản lý nhân viên, chi nhánh · báo cáo, phân tích | 🟡 Mua/bán, báo cáo có; nhân viên, chi nhánh chưa |

**Mô hình dữ liệu:** hai trục riêng, không gộp —
`organizations.type` = `farmer | trader | enterprise` (bên này là ai trong chuỗi) và
`memberships.role` = `owner | manager | staff` (người này được làm gì trong bên đó).
Mọi chủ thể là một **tổ chức**, kể cả hộ nông dân một người.

**Minh bạch — cách hiện thực:** nông dân kết nối với vựa (bấm đồng ý, số điện thoại đã xác
thực OTP) thì thấy đúng những gì in trên biên nhận của mình trong sổ vựa: cân, giá, tổng,
các lần trả, còn nợ. Không thấy ghi chú nội bộ hay lợi nhuận của vựa.

**Luồng giá trị chính (dùng để nghiệm thu):** nông dân tạo đơn bán → vựa nhận, hẹn lịch →
vựa cân, lập phiếu theo đơn, trả một phần (có thể đang mất mạng) → đồng bộ → đơn tự hoàn
thành → nông dân thấy phiếu và số còn nợ.

Chi tiết: [BE-backend-nestjs.md §1](BE-backend-nestjs.md).

---

## 3. Kiến trúc đích — từng ô của sơ đồ thành quyết định cụ thể

✅ đã có · 🟡 có một phần · ❌ chưa có · **Bước** = bước triển khai ở §6

### 3.1 Client

| Ô sơ đồ | Quyết định | Hiện trạng | Bước |
|---|---|---|---|
| React + TypeScript (Web) | Giữ app hiện tại. **Một app, ba vỏ** chọn theo `organization.type` | ✅ vỏ Thương lái | FE song song |
| PWA (offline, cache) | Giữ nguyên | ✅ | — |
| Android (Capacitor — deferred) | Bản đầu lên CH Play bằng **TWA** (bọc PWA); Capacitor khi cần API native | ❌ | sau BE9 |
| Giao diện responsive | Giữ; 375px / 320px không cuộn ngang | ✅ | — |
| HTTPS / REST API (JWT) | `https://api.<domain>/v1`, `Bearer` = token Supabase. Tạm: `thumua365-api-staging.onrender.com` | ✅ staging | BE1 |

### 3.2 NestJS Backend — API Layer

| Ô sơ đồ | Quyết định | Bước |
|---|---|---|
| REST Controllers | Theo module, tiền tố `/v1`; đường dẫn lấy từ `routes` của contracts qua `@Endpoint` | ✅ BE1 |
| DTO Validation (class-validator) | ⚠️ **Dùng zod** thay class-validator — để một schema dùng chung cho web và API (`packages/contracts`). Vai trò giữ nguyên | ✅ BE1 |
| Guards & Auth (JWT, Roles) | `ClientIpThrottlerGuard` → `JwtAuthGuard` (JWKS ES256) → `OrgContextGuard` (header `X-Organization-Id`) → `PermissionGuard` (ma trận quyền là dữ liệu trong contracts). Mặc định đóng: thiếu `@Endpoint` = cần đăng nhập | ✅ BE1 |
| Interceptors (Logging, Transform) | Logging ở **middleware** (không phải interceptor) để ghi cả request bị 401/403/429: `requestId`, thời gian, `userId`, `orgId`. Transform = `ContractInterceptor`: kiểm phản hồi bằng schema hợp đồng, lọc trường thừa, sai hình dạng → 500. Đổi camelCase ↔ snake_case thuộc lớp dữ liệu (BE2) | ✅ BE1 |
| Exception Filters | Một định dạng lỗi `{ error: { code, message, details, requestId } }`, `code` là enum trong contracts; lỗi 500 không lộ chi tiết | ✅ BE1 |

### 3.3 Business Services (Modules)

| Module | Nội dung | Hiện trạng | Bước |
|---|---|---|---|
| Auth & User | Đăng ký/đăng nhập (Supabase Auth), phiên + refresh token (supabase-js tự làm), hồ sơ, vai trò, tổ chức, **xác thực SĐT bằng OTP** | 🟡 | BE2 |
| Organization | Tổ chức, chi nhánh, nhân viên, membership, phân quyền | ❌ | BE2 (schema) · BE7 (màn) |
| Transaction | Phiếu mua/bán, phiếu cân ✅ · **đơn mua/đơn bán, đặt lịch, trạng thái** ❌ · giao hàng ❌ | 🟡 | BE3 · BE5 · sau BE10 |
| Inventory | Tồn kho (suy từ phiếu) ✅ · nhập/xuất kho tường minh, lô hàng ❌ | 🟡 | sau BE10 |
| Debt & Finance | Công nợ phải thu/phải trả, thanh toán, báo cáo công nợ | ✅ | BE3 |
| Partner | Nhà cung cấp / người mua, danh bạ không đăng nhập, **liên kết với tài khoản thật** | 🟡 | BE4 |
| Report | Báo cáo tổng hợp, Excel/PDF ✅ · tổng hợp nhiều chi nhánh phía server ❌ | 🟡 | BE7 |
| Notification | Thông báo trong app → email → SMS/Zalo; **sự kiện hệ thống** qua event bus nội bộ | ❌ | BE5 |

### 3.4 Dữ liệu

| Ô sơ đồ | Quyết định | Hiện trạng | Bước |
|---|---|---|---|
| Data Access: Repository, Prisma/TypeORM, Query Builder, Transaction Mgmt | **Prisma**; repository bắt buộc tham số `orgId` theo kiểu; mỗi thao tác sync một transaction DB | ❌ | BE2 |
| PostgreSQL | Supabase Postgres; Prisma Migrate sở hữu schema (baseline từ 10 migration cũ) | 🟡 chưa chạy | BE2 |
| PostGIS (Geospatial) | Bật extension từ đầu; dùng khi làm tìm vựa gần / vùng trồng (`$queryRaw`) | ❌ | sau BE10 |
| Supabase Auth | Giữ — NestJS chỉ kiểm JWT bằng JWKS (ES256), không dùng JWT secret | ✅ kiểm JWT · OTP ❌ | BE1 · BE2 (OTP) |
| Supabase Storage | Ảnh chứng từ qua signed URL, file không chảy qua NestJS | 🟡 | BE8 |
| Supabase Realtime | Đẩy **trạng thái đơn và thông báo** tới máy (thay cho hỏi lại 60 giây/lần). Sổ offline vẫn kéo theo cursor | ❌ | BE5 (hỏi định kỳ) → nâng lên Realtime sau |
| RLS | Lớp bảo vệ **thứ hai** theo `organization_id`; lớp chính là Guard | ✅ theo `user_id` | BE2 |

### 3.5 Client Data & Offline

| Ô sơ đồ | Quyết định | Hiện trạng |
|---|---|---|
| IndexedDB (offline cache) | Giữ; khoá cache theo `organizationId` | ✅ |
| Queue (sync) | Giữ nguyên hàng đợi (seq, thử lại giãn cách, gộp lần sửa) | ✅ |
| Đồng bộ | `POST /v1/sync/push` + `GET /v1/sync/pull` qua NestJS (đã chốt, §8 mục 2) | 🟡 đang đồng bộ thẳng Supabase |
| Hỗ trợ PWA và Mobile | Cùng một code chạy trong PWA và TWA | ✅ |

### 3.6 Dịch vụ bên ngoài

| Ô sơ đồ | Quyết định | Bước |
|---|---|---|
| Supabase (API/SDK, Webhook) | Auth, Storage, DB. Webhook từ Supabase (ví dụ Auth hook khi có người đăng ký) chỉ dùng nếu cần. Data API (PostgREST) **tắt** | ✅ BE1 (Auth) |
| Ngân hàng — webhook thanh toán | Casso / SePay → `POST /v1/webhooks/bank` (chống trùng, khớp số tiền, bí mật so sánh không đo thời gian) | BE6 |
| Map / Location | Tìm kiếm địa lý, toạ độ vùng trồng — cùng lúc với PostGIS | sau BE10 |
| Email / SMS | **OTP xác thực SĐT** (bắt buộc trước khi liên kết) · thông báo hệ thống | BE2 · BE5 |
| Export Excel/PDF | Giữ, chạy trên máy người dùng | ✅ |

### 3.7 Hạ tầng & vận hành

| Ô sơ đồ | Quyết định | Bước |
|---|---|---|
| Docker | Dockerfile nhiều tầng cho API ✅; `docker-compose` cho dev (Postgres 16 + PostGIS) — cần Docker Desktop trên máy dev | BE1 · BE2 |
| CI/CD (GitHub Actions) | Lint · typecheck · test · build image + chạy thử container; Render deploy staging khi CI trên `master` xanh; prod bấm tay | ✅ BE0–BE1 |
| Monitoring (Prometheus + Grafana) | `/metrics`; một dashboard 4 biểu đồ | BE9 |
| Log (Winston / ELK) | **Winston**, log JSON có `requestId`, `orgId`. ELK chưa cần; log đọc ở Render | ✅ BE1 |
| Backup (PostgreSQL + Supabase) | Prod đang ở gói **Free** (không có backup tự động) ⇒ `pg_dump` hằng ngày ra kho riêng là lớp **bắt buộc** trước người dùng thật; thêm backup của Supabase Pro khi nâng gói, PITR sau khi có doanh thu. **Thử phục hồi một lần** trước khi mở | BE10 |
| Security: HTTPS/SSL, RLS, Audit log | HTTPS, CORS chỉ domain app, rate limit theo IP thật (`cf-connecting-ip` sau Cloudflare), `helmet` ✅. Audit log mở rộng từ `admin_access_log` sang mọi thao tác nhạy cảm: xoá phiếu, huỷ lần trả, đổi quyền, kết nối/huỷ kết nối | BE2 · BE10 |
| Sentry | Theo dõi lỗi runtime (không có trên sơ đồ, đã có trong kế hoạch H) | BE9 |

---

## 4. Repo hiện tại — giữ lại được gì

| Phần | Kết luận |
|---|---|
| `src/core/` — nghiệp vụ tính tiền (3.365 dòng, 27 file test, phủ 98%) | ✅ **Giữ 100%** → `@mambo/core` ở repo BE, frontend cài từ GitHub Release, dùng chung web + API. Server tính lại tổng tiền bằng đúng hàm này |
| `src/components/`, `src/i18n/`, `src/export/`, `site/` | ✅ Giữ |
| `src/features/` — 18 màn hình | ✅ Giữ ~85–90% làm **vỏ Thương lái**; thêm vỏ Nông dân, vỏ Doanh nghiệp |
| `src/data/` — hàng đợi, IndexedDB, cache | ✅ Giữ |
| `src/data/` — `sync`, `pullChanges`, `mappers`, `billing`, `account`, `auth` | 🔄 Đổi sang gọi API |
| `supabase/migrations/` (10 file) | 🔄 Làm baseline cho Prisma, cộng thêm schema ba vai trò |
| `supabase/functions/payment-webhook` | 🔄 Chuyển vào NestJS, giữ nguyên ba chốt |
| `scripts/admin-*.ts` | 🔄 Thành `AdminModule` (bắt buộc người duyệt + nhật ký) |
| CI | 🔄 Sửa trigger `main` → `master`, thêm job API |

Điểm quan trọng: `features/` và `components/` **không gọi Supabase trực tiếp**, chỉ qua
`useStore()`. Vì vậy đổi backend chỉ đụng `src/data/`.

---

## 5. Năm yêu cầu phát hành

| # | Yêu cầu | Đạt ở bước | Bằng chứng nghiệm thu |
|---|---|---|---|
| R1 | Đăng ký / đăng nhập bằng tài khoản thật | BE2 | Đăng ký thật trên staging bằng cả ba loại tài khoản, đăng nhập lại trên máy khác |
| R2 | Luồng tạo giá trị chính đầu–cuối | BE5 | Luồng §2 chạy trên máy thật + một test Playwright trong CI |
| R3 | Thanh toán / ghi nhận giao dịch, ≥10 người trả phí | BE6 + pilot | Một lần chuyển khoản thật đi hết luồng; câu truy vấn đếm tổ chức trả phí ≥ 10 |
| R4 | Màn liên hệ + chính sách quyền riêng tư (CH Play) | FE song song BE1 | `/lien-he` mở được khi chưa đăng nhập; URL chính sách công khai; trang xoá tài khoản trên web; không còn chữ `ĐIỀN:` |
| R5 | Đo lường, tên sự kiện rõ ràng | BE9 | Sự kiện first-party, danh mục có kiểu trong contracts, tách phễu theo `orgType` |

**Quy ước tên sự kiện:** `đối_tượng_hành_động`, tiếng Anh, `snake_case`, thể đã xong.
Không gửi tên, SĐT, email, số tiền cụ thể. Danh mục: `app_opened` · `sign_up_completed` ·
`login_succeeded` · `login_failed` · `link_accepted` · `order_created` · `order_accepted` ·
`order_scheduled` · `order_fulfilled` · `receipt_created` · `receipt_shared` ·
`debt_payment_recorded` · `import_completed` · `quota_wall_shown` · `plans_viewed` ·
`checkout_started` · `plan_activated` · `member_invited` · `contact_clicked` ·
`account_deleted`. `plan_activated` và `order_fulfilled` do **server** bắn.

**CH Play:** tài khoản nhà phát triển cá nhân mới phải thử nghiệm kín ≥12 người trong 14
ngày trước khi phát hành chính thức (kiểm lại điều khoản lúc đăng ký) ⇒ nộp bản thử nghiệm
kín sớm, dùng nhóm pilot làm người thử. Cần: URL chính sách, URL xoá tài khoản, khai Data
safety khớp với R5, `assetlinks.json` cho TWA.

---

## 6. Lộ trình

| Bước | Backend | Frontend song song | Buổi |
|---|---|---|---|
| BE0 ✅ | Repo [Thumua365_BE](https://github.com/remembered-fragrance/Thumua365_BE): `packages/core`, `packages/contracts`, CI, release `.tgz` | Chốt quy ước; `@/core/` → `@mambo/core/` từ release | 1–2 |
| BE1 ✅ | Khung NestJS, Guard, định dạng lỗi, `/v1/me`, Docker, staging Render | `/lien-he`, link pháp lý (R4); khung chọn vỏ | 2 |
| BE2 | Prisma + schema ba vai trò, tổ chức, chi nhánh, OTP, `/me/bootstrap` | Bước "Bác là ai?" khi đăng ký | 3 |
| BE3 | Đồng bộ sổ qua API, giới hạn theo chi nhánh | `sync.ts`, `pullChanges.ts`, `cache.ts` | 3–4 |
| BE4 | Kết nối tổ chức + phần xem của nông dân | Vỏ Nông dân (phần xem), nút "Mời kết nối" | 2–3 |
| BE5 | Đơn hàng, đặt lịch, thông báo trong app | Đơn bán, danh sách đơn, hẹn lịch, ô "Theo đơn" | 3 |
| BE6 | Tài khoản, gói, webhook ngân hàng, quản trị | `billing.ts`, `account.ts` | 2–3 |
| BE7 | Nhân viên, chi nhánh, báo cáo tổng | Vỏ Doanh nghiệp | 2–3 |
| BE8 | Ảnh chứng từ (signed URL) | `attachments.ts` | 1 |
| BE9 | Đo lường, Prometheus, Sentry | Gắn `track()`, sửa trang Quyền riêng tư; TWA + CH Play thử nghiệm kín | 2 |
| BE10 | Production, backup hai lớp đã thử phục hồi | Bật `features` cho nhóm pilot | 1–2 |

**Tổng: khoảng 23–30 buổi**, cộng 2–4 tuần pilot để đạt 10 tổ chức trả phí.

Mỗi bước deploy được và lùi được — bằng image API cũ, migration kiểu *expand → contract*,
và `features` bật theo tổ chức. Bảo vệ dữ liệu hai lớp: Guard của NestJS + RLS theo phiên
(`app.org_id`), chi tiết ở [BE-backend-nestjs.md §5](BE-backend-nestjs.md). Mỗi module mới theo khuôn: **contract → mock → frontend
làm song song → e2e → cờ tính năng → staging → pilot → production.**

**Sau BE10** (mỗi mục có điều kiện bật, không làm trước): thông báo đẩy/SMS/Zalo ·
giao hàng nhiều chặng · nhập/xuất kho tường minh và lô hàng · Map/PostGIS và chợ mở ·
Realtime · báo cáo nặng phía server · Capacitor.

---

## 7. Những điều không được đổi

### 7.1 Năm quy tắc chống mất tiền (mỗi cái có test)

1. `payments` là **bảng riêng, chỉ ghi thêm**; không có cột `amount_paid`, luôn `sum(payments)`.
2. **Id do máy khách sinh**; gửi trùng = `duplicate`, không thành hai phiếu.
3. **Xoá mềm** (`deleted_at`) ở mọi bảng; xoá thắng cập nhật đến sau.
4. Hàng đợi xử lý theo **`seq`**, không theo thời gian.
5. Kéo về **hợp nhất payments theo id**; không có payment mồ côi khi phân trang.

### 7.2 Hợp đồng tích hợp

- `packages/contracts` (zod) là nguồn sự thật duy nhất; `openapi.json` commit vào git;
  `npm run mock` cho frontend. Đổi contract = PR có **cả hai người** duyệt.
- camelCase qua mạng · tiền là số nguyên đồng · thời gian ISO 8601 · header
  `X-Organization-Id` bắt buộc · lỗi theo `code`, không theo `message`.
- Chỉ **thêm** trong `/v1`.

### 7.3 Quyết định cũ vẫn đúng (chi tiết ở [MEMORY.md](https://github.com/remembered-fragrance/mambo365_deploymentphase/blob/master/MEMORY.md))

- Hạn mức gói chặn ở máy chủ cho thứ chạm máy chủ; hết gói **không** giữ dữ liệu làm con
  tin — vẫn đọc và xuất file được.
- Không có trạng thái `expired` lưu trong DB — suy ra từ ngày tháng.
- Xoá tài khoản: ảnh Storage xoá **trước**, rồi mới xoá người dùng.
- Trang pháp lý chỉ được hứa những gì hệ thống làm thật; thêm bất kỳ dịch vụ bên ngoài
  nào phải sửa trang Quyền riêng tư cùng PR.

---

## 8. Điểm mới khi soi lại sơ đồ — và chỗ lệch có chủ ý

| # | Trên sơ đồ | Xử lý |
|---|---|---|
| 1 | Email/SMS — **"Xác thực tài khoản"** | Đưa vào BE2: **OTP SMS bắt buộc trước khi liên kết** nông dân ↔ vựa theo số điện thoại. Không có nó, ai cũng đăng ký bằng số người khác để xem công nợ của họ |
| 2 | Client Data — **"Đồng bộ với Supabase"**, trong khi mũi tên Sync đi từ khối NestJS | ✅ Đã chốt **đồng bộ qua NestJS**: để kiểm quyền từng thao tác (nhân viên không xoá phiếu, chỉ ghi chi nhánh mình) và để chuyển đơn sang hoàn thành trong cùng transaction |
| 3 | Supabase **Realtime** | Bản đầu hỏi thông báo mỗi 60 giây; Realtime cho trạng thái đơn và thông báo vào giai đoạn 2 |
| 4 | Notification — **"Sự kiện hệ thống"** | Event bus nội bộ (`@nestjs/event-emitter`): `order.fulfilled` → thông báo + đo lường + audit, module không gọi chéo nhau |
| 5 | Interceptors — **"Transform"** | Đổi tên trường ở rìa API, lọc trường nội bộ |
| 6 | Log **Winston / ELK** | ✅ Winston, log JSON có `requestId`; ELK chưa cần ở quy mô pilot |
| 7 | Backup **PostgreSQL + Supabase** (hai ô) | Hai lớp: Supabase + `pg_dump` riêng |
| 8 | Security — **Audit log** | Mở rộng ra mọi thao tác nhạy cảm, không chỉ truy cập của quản trị viên |
| 9 | Inventory — **"Nhập/xuất kho", "Theo dõi lô hàng"** | Tồn kho hiện suy từ phiếu; phiếu kho tường minh và lô để sau BE10 |
| 10 | DTO Validation — **class-validator** | ✅ Đã chốt **zod** thay class-validator, để dùng chung schema với frontend |

---

## 9. Quyết định đã chốt (21/09/2026)

Chốt theo hướng đề xuất. Sơ đồ và bảng lý do: [so-do-kien-truc-v2.html](so-do-kien-truc-v2.html).

| # | Câu hỏi | Đã chốt | Ảnh hưởng |
|---|---|---|---|
| 1 | Ai trả tiền? | Nông dân **miễn phí** · vựa 149.000đ/tháng (1.490.000đ/năm) · doanh nghiệp theo số chi nhánh, bán trực tiếp. "10 người trả phí" đếm theo **tổ chức** vựa/DN | R3, `subscriptions.organization_id` |
| 2 | Đồng bộ qua NestJS hay thẳng Supabase? | **Qua NestJS** — `/sync/push`, `/sync/pull`, cursor do server cấp | BE3 |
| 3 | Kết nối nông dân ↔ vựa | **OTP SMS + bấm đồng ý**; chỉ thấy trường in trên biên nhận; huỷ có hiệu lực ngay | BE2, BE4 |
| 4 | Nông dân gửi đơn cho ai | Bản đầu chỉ vựa **đã kết nối**; chợ mở cùng Map/PostGIS ở giai đoạn 2 | BE5 |
| 5 | Nơi chạy container API | **Render**, vùng Singapore (staging gói free; production thêm ở BE10) | BE1 ✅ |
| 6 | Tên miền API, tên gói npm | `api.thumua365.vn` (chờ quyền DNS; tạm `*.onrender.com`) · `@mambo/*` | BE0, BE1 |
| 7 | Đo lường | **First-party** trong Postgres | BE9, trang pháp lý |
| 8 | Android | **TWA** lên CH Play trước; Capacitor khi cần API native | sau BE9 |
| 9 | Validation | **zod** trong `packages/contracts` | BE1 |
| 10 | Duyệt PR `packages/core`, `packages/contracts` | Bắt buộc **cả backend lẫn frontend** | Khớp hai phía |
| 11 | Realtime | Bản đầu hỏi mỗi 60 giây; Realtime giai đoạn 2 | BE5 |

**Còn mở** (cần người, không phải cần code): số tài khoản nhận tiền và người chịu trách
nhiệm pháp lý trên trang chính sách — Nguyên, Linh. Ảnh hưởng R3, R4. Nhà cung cấp SMS
cho OTP — chọn ở BE2. Quyền DNS `thumua365.vn`.

⚠️ **Cổng chặn 2 vẫn chưa vượt:** chưa có bằng chứng ≥3/10 chủ vựa nói "sẽ trả". Với ba vai
trò, nên hỏi thêm: nông dân có muốn xem công nợ trên app không, doanh nghiệp trả bao nhiêu.

---

## 10. Rủi ro chính

| Rủi ro | Chặn bằng |
|---|---|
| Hai phía hiểu khác một trường | Một schema zod cho cả hai, `openapi.json` trong git |
| Mất khoản trả khi đồng bộ | Năm quy tắc §7.1 có test + bảy kịch bản chạy trên máy thật trước khi mở pilot |
| Lộ sổ của vựa cho vựa khác / nông dân lạ | Repository bắt buộc `orgId`, RLS lớp hai, OTP + bấm đồng ý, chỉ chiếu trường biên nhận |
| Phạm vi phình ra vì ba vai trò | Không làm mục "sau BE10" trước khi BE10 xong |
| Chưa chạy thật lần nào | ✅ Staging chạy từ BE1 — và đã bắt được lỗi chỉ lộ trên hạ tầng thật (hạn mức theo IP sau Cloudflare). Mỗi bước nghiệm thu trên staging, không trên máy dev |
| Đồng hồ 14 ngày của CH Play | Nộp bản thử nghiệm kín ngay khi BE5 xong |
| Một người làm backend | Mỗi bước nhỏ, deploy được, lùi được; không Kubernetes, không Redis, không ELK |

---

## 11. Tài liệu

| File | Nội dung |
|---|---|
| **THONG_TIN_DU_AN.md** (file này) | Tổng hợp — đọc đầu tiên |
| [so-do-kien-truc-v2.html](so-do-kien-truc-v2.html) | **Sơ đồ kiến trúc v2** vẽ lại + luồng giá trị chính + hướng giải quyết từng điểm mở ([bản online](https://claude.ai/artifact/AWAQJgU1uptoWBe7vZy6AH)) |
| [BE-backend-nestjs.md](BE-backend-nestjs.md) | Kế hoạch backend chi tiết: schema, ma trận quyền, hợp đồng sync, từng bước |
| [MEMORY.md](../MEMORY.md) của repo này | Nhật ký backend BE0 →: đã làm gì, quyết gì, vì sao, còn treo gì |
| [deploy_plan/I-huong-moi.md](https://github.com/remembered-fragrance/mambo365_deploymentphase/blob/master/deploy_plan/I-huong-moi.md) | Đối chiếu sơ đồ với repo, năm yêu cầu phát hành, CH Play |
| [MEMORY.md của repo frontend](https://github.com/remembered-fragrance/mambo365_deploymentphase/blob/master/MEMORY.md) | Nhật ký giai đoạn A→G: đã làm gì, vì sao, lỗi thật đã bắt |
| [deploy_plan/README.md](https://github.com/remembered-fragrance/mambo365_deploymentphase/blob/master/deploy_plan/README.md) | Luật chung của repo (ranh giới tầng, kích thước file, luật cấm) |
| [deploy_plan/NOTES.md](https://github.com/remembered-fragrance/mambo365_deploymentphase/blob/master/deploy_plan/NOTES.md) | Việc thấy nhưng chưa tới lượt, nợ kỹ thuật |
| [supabase/VAN_HANH.md](https://github.com/remembered-fragrance/mambo365_deploymentphase/blob/master/supabase/VAN_HANH.md) | Bảng kiểm vận hành: Auth, kịch bản đồng bộ, luồng tiền |
| `KE_HOACH_*.md` ở gốc | Kế hoạch gốc (sản phẩm, frontend, deploy) — một phần đã lỗi thời theo hướng mới |

---

## 12. Thuật ngữ

| Từ | Nghĩa trong dự án |
|---|---|
| Vựa | Điểm thu mua của thương lái / chủ vựa / đại lý |
| Sổ | Toàn bộ dữ liệu nghiệp vụ của một tổ chức (phiếu, đối tác, mặt hàng, công nợ) — chạy offline |
| Phiếu | Một lần mua hoặc bán đã chốt, có phiếu cân và các lần trả |
| Đơn | Ý định mua/bán giữa hai tổ chức, **trước** khi cân; do server giữ |
| Kết nối | Liên kết giữa một dòng danh bạ trong sổ và một tổ chức có tài khoản thật |
| Vỏ | Bộ màn hình + điều hướng theo loại tổ chức (nông dân / vựa / doanh nghiệp) |
| Contract | Schema zod trong `packages/contracts` — thoả thuận giữa backend và frontend |
| `features` | Danh sách tính năng bật cho từng tổ chức, trả trong `/v1/me` — cách mở dần tính năng mới cho nhóm pilot |
