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
| Trạng thái sản phẩm | Chưa từng deploy, chưa có project Supabase, **chưa có dữ liệu thật** |

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

## Bốn số phải giữ trong tầm

| Chỉ số | Ngưỡng | Cuối BE0 |
|---|---|---|
| Phủ test `core` | ≥ 80% dòng | **97,7%** |
| Vi phạm ranh giới | 0 | **0** |
| File dài nhất trong `packages/*/src` | ≤ 300 dòng | 285 (`sheetImport.ts`, bê từ frontend) |
| Thời gian phản hồi p95 API | ≤ 300ms ở staging | chưa có API |

---

## Việc còn treo vì cần thứ ngoài repo

| Việc | Cần gì | Chặn bước |
|---|---|---|
| Chọn nơi chạy container API | Quyết định + đăng ký tài khoản | BE1 |
| Tên miền `api.thumua365.vn`, `api-staging.thumua365.vn` | Quyền DNS của `thumua365.vn` | BE1 |
| Nhà cung cấp SMS cho OTP | Chọn + đăng ký (Twilio/Vonage hoặc eSMS/SpeedSMS qua Send SMS Hook) | BE2 |
| Số tài khoản nhận tiền, người chịu trách nhiệm pháp lý | Nguyên, Linh | BE6 |

---

## Ghi chú vận hành

- Máy làm việc: **Windows 11, Node 24, npm 11. Không có Docker, không có WSL, không có
  `gh` CLI.** CI chạy Node 22 (`engines: >=22`).
- Git đang bật `core.autocrlf=true` ⇒ cảnh báo "LF will be replaced by CRLF" khi commit là
  bình thường; trong repo vẫn lưu LF.
- Phát hành phiên bản mới: nâng `version` của **mọi** gói cùng lúc → ghi
  `packages/contracts/CHANGELOG.md` → `git tag vX.Y.Z && git push origin vX.Y.Z`. Tag lệch
  version thì `release.yml` dừng.
- Xem trạng thái CI khi không có `gh`: `curl -s https://api.github.com/repos/remembered-fragrance/Thumua365_BE/actions/runs?per_page=1`.
