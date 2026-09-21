# KẾ HOẠCH BACKEND — NestJS, ba vai trò, triển khai từng bước, khớp chính xác với frontend

Ngày lập: **21/09/2026** · Sửa lần 2: cùng ngày — đối chiếu lại với **kiến trúc v2 đã chốt** ·
Sửa lần 3: sau BE1 — khớp với code đã chạy (log ở middleware, `ContractInterceptor`, mã lỗi, Render)
Tiến độ: **BE0 ✅ · BE1 ✅ · BE2 🟡** (staging chạy, chờ nghiệm thu OTP) · tiếp theo BE3 — nhật ký ở [MEMORY.md](../MEMORY.md)
Người làm backend: **Tài** · Frontend: người khác trong nhóm
Kiến trúc đã chốt: [so-do-kien-truc-v2.html](so-do-kien-truc-v2.html) ·
Tổng hợp dự án: [THONG_TIN_DU_AN.md](THONG_TIN_DU_AN.md) §3, §9

> **Nguyên tắc chi phối cả kế hoạch**
>
> 1. **Hợp đồng trước, code sau.** Mọi endpoint có schema zod trong `packages/contracts`
>    và mock chạy được **trước** khi viết service. Frontend làm song song trên mock.
> 2. **Mỗi bước deploy được và lùi được** — bằng image API cũ + migration kiểu
>    *expand → contract* + cờ tính năng theo tổ chức (§3.3).
> 3. **Không mất năm quy tắc chống mất tiền** đã có ở giai đoạn B–D (§4.4).
> 4. **Ba vai trò có mặt trong schema ngay từ BE2.**
> 5. **Bảo mật có từ BE1**, không dồn tới lúc lên production.

### Sửa gì so với bản trước

| # | Bản trước | Sửa thành | Vì sao |
|---|---|---|---|
| 1 | Cờ `VITE_SYNC_BACKEND = supabase \| api`, "đường cũ còn chạy" | **Bỏ cờ.** Trước BE3 app chạy cục bộ ("tài khoản của máy này" — đã có); từ BE3 đồng bộ qua API | Đường "Supabase trực tiếp" **chưa từng chạy ở production**, và schema BE2 (thêm `organization_id`, RLS mới) làm nó hỏng. Giữ nó là nuôi hai thế giới cho một đường lùi không tồn tại |
| 2 | "RLS theo `organization_id` làm lớp hai", không nói cách | **RLS theo phiên**: Prisma đặt `app.org_id` trong mỗi transaction; role `api_service` **không** bypass RLS; client (`anon`/`authenticated`) **không có quyền** trên bảng nghiệp vụ | Viết như bản trước thì hoặc Prisma bị RLS chặn hết (không có `auth.uid()`), hoặc RLS vô tác dụng. Cách mới bắt đúng lỗi "repository quên lọc `orgId`" |
| 3 | Chỉ nói "dò liên kết theo SĐT" | **Luồng OTP cụ thể** qua Supabase Auth (§1.4, BE2) | Chốt: OTP bắt buộc trước khi kết nối |
| 4 | Không có event bus | `@nestjs/event-emitter`: sự kiện miền → thông báo, đo lường, audit | Có trên kiến trúc v2 |
| 5 | Audit chỉ cho quản trị viên | Bảng `audit_log` cho mọi thao tác nhạy cảm, ghi từ BE2 | Có trên kiến trúc v2 |
| 6 | Backup: "thử phục hồi" | `pg_dump` hằng ngày ra kho riêng (bắt buộc trước pilot) + backup hằng ngày của Supabase Pro khi nâng gói; PITR sau khi có doanh thu | Có trên kiến trúc v2; prod tạm ở gói Free |
| 7 | Log `pino`, không có interceptor | **Winston** (JSON), log truy cập ở **middleware** + `ContractInterceptor` (kiểm phản hồi theo hợp đồng) | Theo ô API Layer của sơ đồ; middleware để ghi cả request bị guard chặn (BE1) |
| 8 | HTTPS, CORS, rate limit, `helmet` ở BE10 | Chuyển lên **BE1** | Staging có dữ liệu thử thật từ BE2 |
| 9 | Chưa nói nông dân có bị chặn theo gói | Chặn gói **chỉ** ở ghi sổ của vựa/DN; đơn, kết nối **miễn phí cho mọi bên** | Chốt: nông dân miễn phí; mạng lưới kết nối là thứ giữ chân vựa |
| 10 | DN "trả theo số chi nhánh" nhưng không có chỗ chặn | `subscriptions.branch_limit` + lỗi `BRANCH_LIMIT` | Để giá theo chi nhánh có nghĩa |
| 11 | Email thông báo "để sau" | Kênh **email** trong BE5 (chỉ khi người dùng có email) | Kiến trúc v2 có mũi tên API → Email |
| 12 | Danh sách bảng thiếu | Đủ bảng theo bốn nhóm của kiến trúc v2 (§1.3) | — |

---

## 0. Ba sự thật làm kế hoạch này đơn giản hơn tưởng

| Sự thật | Hệ quả |
|---|---|
| **Chưa có dữ liệu thật, chưa từng deploy** | Đổi schema thoải mái, không migrate dữ liệu, không cần giữ đường cũ |
| `features/` và `components/` **không gọi Supabase**, chỉ qua `useStore()` | Điểm nối giữa backend và frontend là `src/data/` |
| Hàng đợi đã lưu `{ id, seq, kind, table, recordId, payload }` | `/sync/push` nhận gần đúng hình dạng này ⇒ frontend chỉ thay `applyOp` |

---

## 1. Mô hình ba vai trò

### 1.1 Chuỗi giá trị

| Vai trò | Việc | App hiện tại |
|---|---|---|
| **Nông dân** | Đăng ký/đăng nhập · bán nông sản · theo dõi đơn, công nợ | ❌ chỉ là dòng danh bạ trong sổ vựa |
| **Thương lái / Chủ vựa / Đại lý** | Mua & bán · kho, công nợ · đặt lịch, giao dịch | ✅ toàn bộ app hiện tại, trừ đặt lịch |
| **Doanh nghiệp** | Mua & bán · nhân viên, chi nhánh · báo cáo | 🟡 mua/bán, báo cáo có |

```
 Nông dân ──(đơn bán, hẹn lịch)──▶ Thương lái / Vựa ──(đơn bán, giao hàng)──▶ Doanh nghiệp
     ▲                                  │ phiếu cân, trả tiền, ghi nợ
     └──── thấy phiếu + công nợ ◀───────┘
```

### 1.2 Hai trục, không gộp

| Trục | Câu hỏi | Giá trị |
|---|---|---|
| `organizations.type` | Bên này là ai trong chuỗi? | `farmer` · `trader` · `enterprise` |
| `memberships.role` | Người này được làm gì trong bên đó? | `owner` · `manager` · `staff` |

Mọi chủ thể là một **tổ chức**, kể cả hộ nông dân một người. Giao dịch luôn giữa hai tổ
chức; gói trả tiền gắn vào tổ chức.

### 1.3 Schema — đủ bốn nhóm của kiến trúc v2 (tạo hết ở BE2)

| Nhóm | Bảng | Ghi chú |
|---|---|---|
| **Tổ chức** | `organizations` · `memberships` · `branches` · `subscriptions` · `profiles` | `subscriptions.organization_id`, `branch_limit NULL` |
| **Chuỗi** | `partner_links` · `orders` · `order_events` | Dùng chung giữa hai tổ chức; id do **server** sinh |
| **Sổ** | `transactions` · `payments` · `drafts` · `suppliers` · `buyers` · `products` · `pricing_rules` · `notes` | Có sẵn; thêm `organization_id`, `created_by`; `transactions`/`drafts` thêm `branch_id`, `order_id`; `payments` thêm `updated_at` |
| **Hệ thống** | `sync_ops` · `notifications` · `analytics_events` · `audit_log` · `bank_transactions` · `payment_intents` · `admin_access_log` | `audit_log`, `order_events`, `payments` chỉ ghi thêm |

```
organizations  (id, type, name, phone, address, location geography NULL, ...)
branches       (id, organization_id, name, address, location NULL, ...)
memberships    (id, user_id, organization_id, role, branch_id NULL, status: invited|active|removed)
partner_links  (id, owner_org_id, partner_kind: supplier|buyer, partner_id, linked_org_id NULL,
                invited_phone, status: pending|active|revoked, decided_by, decided_at)
orders         (id, seller_org_id NULL, seller_partner_id NULL, buyer_org_id, buyer_partner_id NULL,
                created_by_org_id, product_id, crop, est_quantity, unit, offered_price NULL,
                status, pickup_at NULL, pickup_address NULL, branch_id NULL, version)
order_events   (id, order_id, from_status, to_status, actor_user_id, note, created_at)
notifications  (id, organization_id, user_id NULL, kind, payload jsonb, read_at, created_at)
audit_log      (id, organization_id NULL, actor_user_id NULL, action, entity, entity_id,
                before jsonb NULL, after jsonb NULL, request_id, created_at)
analytics_events (id, organization_id NULL, org_type, anon_id, name, props jsonb,
                app_version, platform, created_at)
```

Extension `postgis` **bật ở BE2** (cột `location` có sẵn, chưa dùng tới giai đoạn 2).

### 1.4 Kết nối giữa tổ chức — có OTP

Sổ của vựa vẫn là **của vựa**. Nông dân chỉ **nhìn** phần sổ nói về mình.

1. Vựa có nông hộ "Cô Mai – 0912…" trong danh bạ.
2. Cô Mai đăng ký (mật khẩu như hiện nay) rồi **xác thực số**: app gọi
   `supabase.auth.updateUser({ phone })` → Supabase gửi OTP → `verifyOtp({ type:
   'phone_change' })` → `auth.users.phone_confirmed_at` có giá trị.
3. App gọi `POST /v1/links/discover`. Server đọc `phone_confirmed_at` qua Auth Admin API;
   **chưa xác thực → `PHONE_NOT_VERIFIED`**, không dò. Đã xác thực → tạo `partner_links`
   `pending` cho mọi sổ có đối tác mang số đó.
4. Cô Mai bấm đồng ý → `active`, ghi `audit_log`. Vựa cũng có thể mời trước
   (`/links/invite`), nhưng liên kết vẫn chỉ `active` khi cô Mai đồng ý **và** số đã xác thực.
5. Cô Mai thấy phiếu có `counterparty_id` là nông hộ đó — **chỉ trường in trên biên nhận**.
6. Một trong hai bên huỷ → `revoked` → mất quyền đọc ngay.

**Gửi SMS:** Supabase Auth phone provider. Nhà cung cấp Supabase hỗ trợ sẵn (Twilio,
Vonage, MessageBird…) hoặc **Send SMS Hook** trỏ sang nhà cung cấp trong nước (eSMS,
SpeedSMS…) nếu giá/tỉ lệ tới máy tốt hơn — chọn ở BE2. Rate limit OTP bật ở dashboard Auth.

Cùng cơ chế áp cho **vựa ↔ doanh nghiệp**.

### 1.5 Đơn hàng & đặt lịch

Đơn là thực thể **chung giữa hai tổ chức**, server giữ, không nằm trong sổ offline.

```
 submitted ──accept──▶ accepted ──schedule──▶ scheduled ──(phiếu có order_id đồng bộ lên)──▶ fulfilled
     └──reject/cancel─────┴───────cancel──────────┴──▶ cancelled
```

- Bản đầu chỉ gửi đơn cho tổ chức **đã kết nối** (`LINK_REQUIRED` nếu chưa).
- Chuyển trạng thái có `version`; lệch → `409 ORDER_STATE_CHANGED`.
- Mọi lần chuyển ghi `order_events` và phát sự kiện miền `order.<trạng thái>` (§1.8).

### 1.6 Ma trận quyền

`/v1/me` trả `permissions`. Frontend chỉ ẩn/hiện; server kiểm lại ở từng endpoint **và
từng op sync**. Bảng là dữ liệu trong `packages/contracts` (`PERMISSIONS_BY[type][role]`).

| Quyền | Nông dân | Vựa owner | Vựa staff | DN owner | DN manager | DN staff |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| `order:create` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `order:respond` | ✅ đơn tới mình | ✅ | ✅ | ✅ | ✅ chi nhánh | ❌ |
| `book:sync` | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ chi nhánh |
| `receipt:create` · `payment:record` | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `receipt:delete` · `payment:void` | ❌ | ✅ | ❌ | ✅ | ✅ | ❌ |
| `partner:manage` · `pricing:manage` | ❌ | ✅ | ❌ | ✅ | ✅ | ❌ |
| `linked:read` | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ |
| `staff:manage` · `branch:manage` | ❌ | ✅ | ❌ | ✅ | ❌ | ❌ |
| `report:view` | ✅ của mình | ✅ | ❌ | ✅ toàn DN | ✅ chi nhánh | ❌ |
| `billing:manage` · `account:delete` | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |

### 1.7 Trả tiền (đã chốt)

| Loại | Giá | Chặn ở đâu |
|---|---|---|
| Nông dân | **Miễn phí** | Không chặn gì |
| Vựa | 149.000đ/tháng · 1.490.000đ/năm, dùng thử 30 ngày | **Ghi sổ qua sync** (`PLAN_EXPIRED`); đọc và xuất file luôn được |
| Doanh nghiệp | Theo số chi nhánh, bán trực tiếp, kích hoạt qua `AdminModule` | Ghi sổ + `branch_limit` (`BRANCH_LIMIT` khi tạo chi nhánh vượt gói) |

**Đơn và kết nối miễn phí cho mọi bên**, kể cả vựa hết gói — chặn chúng là chặn chính
mạng lưới làm vựa ở lại. "10 người trả phí" đếm theo **tổ chức** vựa/DN có gói còn hạn.

### 1.8 Sự kiện miền (event bus nội bộ)

Module **không gọi chéo** để làm việc phụ. Việc chính xong (trong transaction) thì phát
sự kiện; các listener làm phần còn lại **sau khi commit**.

| Sự kiện | Phát từ | Listener |
|---|---|---|
| `order.submitted` · `order.scheduled` · `order.fulfilled` · `order.cancelled` | Orders, Sync | Thông báo · Đo lường |
| `link.accepted` · `link.revoked` | Links | Thông báo · Audit |
| `receipt.deleted` · `payment.voided` | Sync | Audit |
| `member.invited` · `member.role_changed` | Organization | Thông báo · Audit |
| `plan.activated` | Billing (webhook, admin) | Thông báo · Đo lường · Audit |

Listener hỏng **không** làm hỏng việc chính (đã commit); lỗi vào log + Sentry. Việc gửi ra
ngoài (email) đi qua hàng đợi job **pg-boss** để thử lại được.

---

## 2. Chia việc và ranh giới sở hữu

**Hai repo** (chốt khi bắt đầu BE0, 21/09/2026):

```
Thumua365_BE  (github.com/remembered-fragrance/Thumua365_BE)          [Backend]
├── apps/api/           ← NestJS (từ BE1); apps/api/prisma/ — schema + migration + RLS (từ BE2)
├── packages/
│   ├── core/           ← src/core/ + tests/core/ của repo frontend     [PR 2 người duyệt]
│   ├── contracts/      ← zod: lỗi, vai trò, ma trận quyền, request/response [Backend viết, Frontend duyệt]
│   └── sdk/            ← client có kiểu, sinh từ contracts (từ BE1)
└── docs/               ← kế hoạch này, THONG_TIN_DU_AN.md, sơ đồ v2

mambo365_deploymentphase (repo frontend hiện tại)                     [Frontend]
└── src/                ← app web, ba vỏ; src/data/ gọi API qua @mambo/sdk
```

- **Frontend lấy gói từ GitHub Release của repo BE**, khoá theo tag:
  `"@mambo/core": "https://github.com/remembered-fragrance/Thumua365_BE/releases/download/v0.1.0/mambo-core-0.1.0.tgz"`.
  Mỗi tag `v*` tự build và đính kèm `.tgz` của mọi gói (`.github/workflows/release.yml`).
  Nâng phiên bản = frontend đổi tag trong `package.json`, có diff rõ ràng.
- `core` xuất **từng file** là một đường dẫn: `@/core/calc` → `@mambo/core/calc`. Frontend
  chuyển bằng một lần thay tiền tố, rồi xoá `src/core/` của mình. Từ đó **chỉ repo BE
  sửa `core`**; frontend muốn đổi thì mở PR vào repo BE.
- **Một app web, ba vỏ** theo `organization.type`. Vỏ Nông dân ≈ 6 màn: Trang chủ · Tạo
  đơn bán · Đơn của tôi · Tiền vựa còn nợ · Vựa đã kết nối · Tài khoản.
- `packages/contracts` là nguồn sự thật duy nhất.

---

## 3. Hợp đồng tích hợp chung

| Mục | Quy ước |
|---|---|
| Đường dẫn | `https://api.thumua365.vn/v1/...` (staging: `api-staging.thumua365.vn`). Tới khi có quyền DNS: `https://thumua365-api-staging.onrender.com/v1` |
| Xác thực | `Authorization: Bearer <access_token Supabase>`. NestJS kiểm bằng JWKS, không phát token |
| Tổ chức | Header `X-Organization-Id` bắt buộc trên endpoint nghiệp vụ; server kiểm membership `active` |
| Tên trường | camelCase, trùng `core/types.ts`. Lớp dữ liệu (mapper/repository, BE2) đổi sang/từ snake_case; `ContractInterceptor` lọc mọi trường không có trong schema phản hồi |
| Id | UUID v4 do client sinh cho bản ghi sổ; do server sinh cho `orders`, `partner_links`, `memberships` |
| Thời gian | ISO 8601 có múi giờ |
| Tiền | `number`, số nguyên đồng |
| Khối lượng, % | `number` thập phân |
| Khách lẻ | `counterpartyId: null` |
| Xoá | Không `DELETE` cứng dữ liệu nghiệp vụ |
| Đổi hợp đồng | Chỉ thêm trong `/v1`; bỏ/đổi nghĩa = trường mới + `deprecated` ≥ một bản phát hành |

### 3.1 Định dạng lỗi

```json
{ "error": { "code": "PLAN_EXPIRED", "message": "Gói đã hết hạn", "details": {}, "requestId": "..." } }
```

| `code` | HTTP | Frontend làm gì |
|---|---|---|
| `UNAUTHENTICATED` | 401 | Làm mới token, thử lại một lần; vẫn lỗi → đăng nhập, **giữ** hàng đợi |
| `NOT_A_MEMBER` | 403 | Xoá cache tổ chức đó, về chọn tổ chức |
| `FORBIDDEN` | 403 | Không thử lại; op sync → `conflict` |
| `PHONE_NOT_VERIFIED` | 403 | Mở màn xác thực OTP |
| `LINK_REQUIRED` | 403 | "Cần kết nối trước" |
| `PLAN_EXPIRED` | 402 | Dừng lượt sync, **không đốt lượt thử** |
| `BRANCH_LIMIT` | 402 | "Gói hiện tại cho tối đa N chi nhánh" |
| `VALIDATION_FAILED` | 422 | Không thử lại; `details` chỉ trường sai |
| `PARENT_MISSING` | 409 | Thử lại theo lịch giãn cách |
| `ORDER_STATE_CHANGED` | 409 | Tải lại đơn |
| `NOT_FOUND` | 404 | Đường dẫn/bản ghi không có — không thử lại |
| `PAYLOAD_TOO_LARGE` | 413 | Body > 1MB — chia nhỏ lô sync, không gửi lại nguyên lô |
| `RATE_LIMITED` | 429 | Thử lại sau `Retry-After` |
| `INTERNAL` | 5xx | Thử lại theo lịch giãn cách hiện có |

### 3.2 `GET /v1/me`

```jsonc
{
  "user": { "id": "uuid", "name": "Cô Mai", "phone": "+84912...", "phoneVerified": true },
  "memberships": [{
    "organization": { "id": "uuid", "type": "farmer", "name": "Hộ cô Mai" },
    "role": "owner", "branch": null,
    "permissions": ["order:create", "order:respond", "linked:read", "report:view"],
    "plan": null,                 // vựa/DN: { tier, status, periodEnd, branchLimit }
    "features": ["orders", "links"]
  }],
  "pendingLinks": 2
}
```

### 3.3 Triển khai dần mà không cần đường cũ

- **API:** mỗi merge vào `master` build image có tag commit; lùi = deploy lại image trước.
- **Database:** migration kiểu *expand → contract* — thêm cột/bảng trước, đổi code, xoá cái
  cũ ở bản sau. Không migration nào vừa thêm vừa xoá.
- **Tính năng mới:** bật theo tổ chức qua `features` trong `/v1/me` (bảng
  `organization_features`), để pilot trên vài vựa trước khi bật cho tất cả.
- **Frontend:** trước BE3 vẫn chạy cục bộ bằng "tài khoản của máy này" (`deviceAccount.ts`
  — đã có). Từ BE3, có tài khoản thì đồng bộ qua API.

---

## 4. Đồng bộ sổ offline (Vựa, Doanh nghiệp)

Tổ chức `farmer` gọi sync → `403 FORBIDDEN`.

### 4.1 `POST /v1/sync/push`

```jsonc
{ "deviceId": "uuid",
  "ops": [
    { "opId": "uuid", "seq": 41, "kind": "insert", "entity": "transaction", "recordId": "uuid",
      "data": { /* Transaction wire; có thể có orderId, branchId */ } },
    { "opId": "uuid", "seq": 42, "kind": "insert", "entity": "payment", "recordId": "uuid",
      "data": { "transactionId": "uuid", "amount": 1438000, "date": "..." } } ] }
// 200
{ "results": [ { "opId": "...", "status": "applied" | "duplicate" | "rejected", "error"?: {...}, "warning"?: "ORDER_NOT_OPEN" } ] }
```

1. Tuần tự theo `seq`, **mỗi op một transaction DB** (có `set_config('app.org_id')`, §5).
   Gặp `rejected` là dừng; client xoá op `applied`/`duplicate`.
2. Chống trùng: `sync_ops(op_id pk)` ghi cùng transaction + insert trùng `recordId` = `duplicate`.
3. Không tin `organizationId`/`createdBy` từ client. `data` là `z.strictObject`.
4. Kiểm quyền từng op theo §1.6; staff chỉ ghi chi nhánh mình.
5. `payment`: chỉ `insert`/`softDelete`.
6. `update` là vá một phần, ghi sau thắng theo thời điểm server nhận.
7. `transaction` insert: tính lại tổng bằng `packages/core`; lệch → `VALIDATION_FAILED`.
8. Phiếu có `orderId` hợp lệ → đơn sang `fulfilled` + `order_events` trong **cùng**
   transaction; sau commit phát `order.fulfilled`. Đơn đã huỷ → phiếu vẫn ghi, gỡ `orderId`,
   `warning: ORDER_NOT_OPEN`.
9. Xoá phiếu, huỷ lần trả → ghi `audit_log` trong cùng transaction.
10. Vựa/DN hết gói → `PLAN_EXPIRED` ở op đầu tiên, không ghi gì.

### 4.2 `GET /v1/sync/pull?cursor=<opaque>&limit=500`

```jsonc
{ "cursor": "opaque", "hasMore": false, "resetRequired": false,
  "changes": { "suppliers": [], "buyers": [], "products": [], "drafts": [],
               "pricingRules": [], "notes": [], "transactions": [], "payments": [] } }
```

1. Cursor do server cấp (giờ server − 5 giây chồng lấn).
2. Trả cả bản ghi đã xoá mềm.
3. 🔴 Mỗi `payment` trong trang thì phiếu cha có ở trang này hoặc trang trước.
4. 🔴 `payments.updated_at` + trigger — sửa lỗi huỷ lần trả không lan sang máy khác.
5. Phạm vi: owner kéo cả tổ chức; manager/staff kéo phiếu chi nhánh mình + danh mục chung.
6. Đổi chi nhánh → `resetRequired: true`; client xoá sổ cục bộ **sau khi xả hết hàng đợi**.

### 4.3 Việc của frontend trong `src/data/`

| File | Thay đổi |
|---|---|
| `sync.ts` | `applyOp` → `sdk.sync.push(batch)`; hết gói nhận bằng `code === 'PLAN_EXPIRED'` |
| `pullChanges.ts` | `sdk.sync.pull(cursor)` tới `hasMore=false`; `mergeChanges` **giữ nguyên**; xử lý `resetRequired` |
| `cache.ts` | Lưu `cursor`; khoá cache theo `organizationId` |
| `derivedOps.ts`, `mappers.ts` | Sinh `data` camelCase |
| `queue.ts`, `localDb.ts` | Thêm `organizationId` vào op, nâng IndexedDB version |
| `deviceAccount.ts` | Giữ: chưa đăng nhập thì vẫn ghi cục bộ; đăng nhập xong "đưa sổ của máy vào tài khoản" qua `/sync/push` |

### 4.4 Năm quy tắc chống mất tiền — mỗi cái một test e2e

| # | Quy tắc | Test |
|---|---|---|
| 1 | `payments` riêng, chỉ ghi thêm | Hai thiết bị trả cùng phiếu song song → tổng = cả hai |
| 2 | Insert trùng id = `duplicate` | Gửi cùng lô hai lần → một phiếu |
| 3 | Xoá mềm thắng | Xoá rồi update đến sau → vẫn xoá |
| 4 | Xử lý theo `seq` | Payment ngay sau transaction cùng mili-giây → cả hai vào |
| 5 | Không mồ côi payment khi phân trang | Trang cắt giữa phiếu và lần trả → phiếu cha có trong trang |

Thêm: staff hai chi nhánh không thấy phiếu của nhau; nông dân bị huỷ kết nối không đọc
được nữa; **repository cố tình bỏ lọc `orgId` vẫn không đọc được dữ liệu tổ chức khác** (RLS).

---

## 5. Bảo vệ dữ liệu hai lớp

| Lớp | Cơ chế |
|---|---|
| **1 — NestJS** | `JwtAuthGuard` → `OrgContextGuard` → `PermissionGuard` → zod. Repository bắt buộc tham số `orgId` (theo kiểu) |
| **2 — Postgres RLS** | Mỗi request mở transaction và chạy `select set_config('app.org_id', $1, true)`. Policy: `organization_id = current_setting('app.org_id')::uuid`. Role `api_service` **không** có `BYPASSRLS` |
| Đọc chéo tổ chức | `orders`: policy cho cả `seller_org_id` lẫn `buyer_org_id`. Phiếu của bên kia: chỉ qua hàm `security definer` `linked_receipts(org)` kiểm `partner_links.status = 'active'` và trả đúng các cột biên nhận |
| Việc đặc quyền | Webhook ngân hàng, `AdminModule`, xoá tài khoản dùng role riêng `api_privileged` (có `BYPASSRLS`), chỉ ba module này được inject |
| Client | `anon`/`authenticated` **không có quyền** trên bảng nghiệp vụ — app không đọc DB trực tiếp nữa. Chỉ còn Auth và Storage (qua signed URL) |
| `service_role` | Chỉ trong env của API, chỉ cho Auth Admin (đọc `phone_confirmed_at`, xoá user) và tạo signed URL Storage |

---

## 6. API ngoài sync

| Endpoint | Ai | Ghi chú |
|---|---|---|
| `POST /v1/me/bootstrap` | mới đăng ký | Tạo hồ sơ + tổ chức + membership `owner` + (vựa/DN) dùng thử. Idempotent |
| `POST /v1/auth/resolve-identifier` | chưa đăng nhập | Thay RPC `resolve_identifier`; rate limit; lỗi luôn cùng một câu |
| `POST /v1/links/discover` | đã xác thực SĐT | §1.4 bước 3 |
| `GET /v1/links` · `POST /v1/links/:id/{accept,revoke}` | mọi loại | |
| `POST /v1/links/invite` `{ partnerId }` | vựa, DN | Trả link mời / Zalo |
| `GET /v1/linked/receipts?orgId=&cursor=` · `GET /v1/linked/balance` | `linked:read` | Chỉ trường biên nhận |
| `GET/POST /v1/orders` · `GET /v1/orders/:id` | mọi loại | Lọc `role=seller\|buyer`, `status` |
| `POST /v1/orders/:id/{accept,reject,schedule,cancel}` `{ version }` | §1.6 | |
| `GET /v1/notifications?cursor=` · `POST /v1/notifications/read` | mọi loại | App hỏi khi mở + mỗi 60 giây. Realtime ở giai đoạn 2 |
| `GET/POST /v1/org/members` · `PATCH/DELETE .../:id` | `staff:manage` | |
| `GET/POST/PATCH /v1/org/branches` | `branch:manage` | `BRANCH_LIMIT` |
| `GET /v1/reports/summary?from=&to=&branchId=` | `report:view` | Tổng hợp nhiều chi nhánh phía server |
| `GET/PATCH /v1/me/profile` · `GET /v1/me/subscription` | mọi loại | |
| `GET/POST /v1/billing/intents` · `POST /v1/referrals/claim` | vựa owner | Mã chuyển khoản từ `packages/core/transferCode` |
| `POST /v1/webhooks/bank` | Casso / SePay | Ba chốt của `payment-webhook` |
| `POST /v1/attachments/upload-url` · `GET /v1/attachments/:id/url` | có quyền ghi / đọc | Signed URL, `${orgId}/${attachmentId}` |
| `POST /v1/events` | mọi loại | Đo lường first-party |
| `DELETE /v1/me` | `account:delete` | Ảnh Storage xoá **trước**, rồi dữ liệu, rồi `auth.users` |
| `/v1/admin/*` | quản trị viên | Bắt buộc `approvedBy`, ghi `admin_access_log` |
| `GET /v1/health` · `GET /metrics` | hạ tầng | `/metrics` chỉ mở trong mạng nội bộ / có token |

---

## 7. Các bước triển khai

Mỗi bước: **Backend** · **Frontend** · **Xong khi**. Không sang bước sau khi "Xong khi"
chưa đạt.

### BE0 — Dựng repo backend, tách `core`, hợp đồng nền (1–2 buổi) · ✅ phần backend 21/09/2026

- **Backend:** repo `Thumua365_BE` với npm workspaces; `src/core/` + `tests/core/` →
  `packages/core/` (build ESM + CJS + `.d.ts`, xuất từng file); `packages/contracts` với
  những gì đã chốt: `ErrorCode`, `OrgType`, `MemberRole`, ma trận quyền (+ test đối chiếu
  từng ô với §1.6); dependency-cruiser giữ `core` thuần; CI trên `master`; workflow
  release đính kèm `.tgz` khi gắn tag `v*`.
- **Frontend:** **chốt quy ước §3**; cài `@mambo/core` từ release `v0.1.0`, thay
  `@/core/` → `@mambo/core/`, xoá `src/core/` + `tests/core/`; sửa `ci.yml` của repo
  frontend sang nhánh `master`.
- **Xong khi:** `npm run verify` xanh ở repo BE (315 test `core` + test contracts); CI chạy
  lần đầu trên GitHub; release `v0.1.0` có hai file `.tgz`; frontend build được với
  `@mambo/core` từ release và 43 test `data/`, `features/` còn lại vẫn xanh.

### BE1 — Khung NestJS, bảo mật nền, hạ tầng (2–3 buổi) · ✅ đóng 21/09/2026 (staging Render, `smoke:me` đạt)

- **Backend:**
  - **NestJS 11** (không phải 12 — v12 chỉ ESM, ra được 3 tuần), CommonJS, Express 5.
    Env kiểm bằng zod lúc khởi động (`src/config/env.ts`); **Winston** log JSON.
  - Log truy cập ở **middleware** (không phải interceptor) để ghi cả request bị guard chặn
    (401/403/429): `requestId`, `userId`, `orgId`, thời gian. Không ghi Authorization.
  - **Transform** = `ContractInterceptor`: mọi phản hồi đi qua schema của `routes` — trường
    thừa bị lọc, sai hình dạng → 500. Đổi camelCase ↔ snake_case thuộc lớp dữ liệu (BE2).
  - `ExceptionFilter` bắt MỌI lỗi ra đúng §3.1; lỗi 500 không lộ chi tiết, gửi Sentry nếu có
    `SENTRY_DSN`. Lỗi bộ đọc JSON (quá 1MB, sai cú pháp) chặn riêng vì xảy ra trước Nest.
  - `JwtAuthGuard` (JWKS, ES256, issuer/audience, `role = authenticated`), `OrgContextGuard`,
    `PermissionGuard` đọc ma trận từ contracts. Handler không khai `@Endpoint` bị coi là cần
    đăng nhập (mặc định đóng).
  - `@Endpoint(routes.x)`: đường dẫn, phương thức, loại xác thực, quyền, schema phản hồi đều
    lấy từ `@mambo/contracts` — controller không tự gõ đường dẫn.
  - **Bảo mật nền:** CORS chỉ domain trong `CORS_ORIGINS`, `helmet`, rate limit theo IP
    thật — `ClientIpThrottlerGuard` đọc header trong `CLIENT_IP_HEADER` (`cf-connecting-ip`,
    vì Render đứng sau Cloudflare), giới hạn body 1MB. HTTPS do Render lo.
  - `GET /v1/health`; `GET /v1/me` — thông tin người dùng lấy thật từ Supabase Auth
    (`/auth/v1/user` bằng token của chính họ, có `phone_confirmed_at`), `memberships: []`
    tới BE2, `pendingLinks: 0` tới BE4.
  - Dockerfile nhiều tầng (`apps/api/Dockerfile`, build từ gốc repo). CI build image và chạy
    thử container. `docker-compose` cho Postgres dời sang **BE2** — BE1 chưa có database.
  - `render.yaml`: chỉ staging, gói free, vùng Singapore, deploy khi CI xanh.
  - `openapi.json` sinh từ `routes`, test bắt buộc khớp; `npm run mock` (Prism).
  - Gói **`@mambo/sdk`**: client có kiểu cho frontend.
- **Frontend:** cài `@mambo/sdk`, `@mambo/contracts` từ release `v0.2.0`; `VITE_API_URL`;
  gọi `sdk.me()` sau khi đăng nhập; làm `/lien-he` + link pháp lý (R4).
- **Xong khi:** đăng nhập staging → `/v1/me` đúng; token sai → 401 đúng định dạng; gọi từ
  domain lạ bị CORS chặn; spam endpoint → 429.

### BE2 — Database, ba vai trò, OTP, audit (3–4 buổi) · 🟡 chạy trên staging 22/09/2026 (`v0.3.0`), chờ nghiệm thu OTP

- **Backend:**
  - `docker-compose.yml` (**Postgres 17** + PostGIS — cùng bản với Supabase; bản trước ghi
    16). Script dựng lại những gì Supabase có sẵn (schema `extensions`, role `anon`/
    `authenticated`, quyền mặc định) để migration chạy ở máy y như staging.
  - Prisma 7 ở `apps/api/prisma/`: baseline từ 10 migration cũ + **toàn bộ §1.3** +
    `postgis`, một migration `20260922000000_ba_vai_tro`. Từ đây Prisma Migrate sở hữu
    schema; `supabase/migrations/` của repo frontend đóng băng. CI đỏ nếu `schema.prisma` và
    migration lệch nhau.
  - **Không khoá ngoại sang `auth.users`**: database không phụ thuộc schema của Supabase
    Auth. Việc cần Auth (email đăng nhập, `phone_confirmed_at`) đi qua Auth API.
  - Hai role `api_service` (không `BYPASSRLS`, không `DELETE`, `payments` chỉ sửa được
    `deleted_at`, `audit_log`/`order_events` chỉ ghi thêm) / `api_privileged`. RLS theo phiên:
    `Database.scoped({ userId, orgId })` mở transaction, `set_config('app.user_id'|'app.org_id',
    …, true)`. Thu hồi mọi quyền của `anon`/`authenticated`. Mật khẩu role đặt bằng
    `npm run db:role-password` (gửi chuỗi băm SCRAM, không gửi mật khẩu).
  - Việc cần nhìn xuyên tổ chức là **hàm security definer** hẹp, chỉ `api_service` gọi được:
    `find_login_user(text)` (đăng nhập một ô), `discover_links(phone)` (dò kết nối).
  - `audit_log` ghi trong cùng transaction; event bus `@nestjs/event-emitter` có danh mục sự
    kiện có kiểu (§1.8).
  - `/me/bootstrap` (idempotent, khoá advisory theo người dùng; số điện thoại của hồ sơ lấy
    từ email đăng nhập nội bộ, không tin số client khai), `/auth/resolve-identifier` (luôn
    trả một email — không dò được ai có tài khoản), `/links/discover` (kiểm
    `phone_confirmed_at` ngay lúc gọi; chưa xác thực → `PHONE_NOT_VERIFIED`).
  - Còn lại (cần dashboard / nhà cung cấp): **tắt "Confirm email"** (email nội bộ
    `84…@id.thumua365.vn` không nhận thư — bật thì người chỉ có SĐT không đăng nhập được);
    bật **Phone provider** + số thử OTP; nhà cung cấp SMS thật cho "OTP tới máy thật".
    Nghiệm thu bằng `npm run login-test` (đủ luồng đăng ký → "Bác là ai?" → OTP → dò kết nối).
- **Frontend:** bước **"Bác là ai?"** khi đăng ký (`sdk.meBootstrap`); đăng nhập gọi
  `sdk.resolveIdentifier` thay RPC; màn xác thực OTP (`supabase.auth.updateUser({ phone })` →
  `verifyOtp({ type: 'phone_change' })` → `sdk.discoverLinks()`); chọn vỏ theo
  `organization.type`.
- **Xong khi:** đăng ký thật trên staging bằng cả ba loại; OTP tới máy thật; `/me` đúng ma
  trận; **test RLS xanh** (repository bỏ lọc `orgId` vẫn không thấy dữ liệu tổ chức khác) —
  ✅ 29 test RLS + 18 test API trên Postgres thật, chạy trong CI.

### BE3 — Đồng bộ sổ qua API (3–4 buổi) · quan trọng nhất về tiền

- **Backend:** `SyncModule` đúng §4; mapper 8 thực thể; audit xoá phiếu / huỷ lần trả;
  e2e năm quy tắc + ba test vai trò/RLS + bảy kịch bản VAN_HANH §6.
- **Frontend:** bảng §4.3.
- **Xong khi:** hai máy thật, một máy tắt mạng, ghi phiếu + trả nợ + huỷ lần trả — sau
  đồng bộ khớp từng đồng; e2e xanh trong CI. **Đạt R1.**

### BE4 — Kết nối + Nông dân (2–3 buổi)

- **Backend:** `/links/*`, `/linked/*`, hàm `linked_receipts()`; schema `LinkedReceipt`
  riêng trong contracts; sự kiện `link.*`.
- **Frontend:** vỏ Nông dân (phần xem); nút "Mời kết nối" trên trang nông hộ.
- **Xong khi:** vựa ghi phiếu có nợ → nông dân đăng ký, **xác thực OTP**, đồng ý → thấy
  đúng phiếu, đúng số nợ; chưa OTP → `PHONE_NOT_VERIFIED`; huỷ kết nối → mất quyền ngay.

### BE5 — Đơn, đặt lịch, thông báo (3–4 buổi) · luồng giá trị chính

- **Backend:** `OrdersModule` (state machine, `version`, `order_events`) nối vào sync;
  `NotificationsModule` với hai kênh: **trong app** (bảng `notifications`) và **email**
  (job pg-boss, chỉ khi người nhận có email và bật nhận); listener cho sự kiện `order.*`.
- **Frontend:** nông dân tạo đơn bán, lịch sử đơn; vựa danh sách đơn + hẹn lịch; ô "Theo
  đơn" ở màn Tạo phiếu; hỏi thông báo mỗi 60 giây.
- **Xong khi — nghiệm thu R2:** nông dân tạo đơn → vựa nhận, hẹn lịch → nông dân thấy lịch
  → vựa cân, lập phiếu theo đơn, trả một phần **lúc mất mạng** → có mạng → đơn tự
  `fulfilled` → nông dân thấy phiếu và số còn nợ. Một test Playwright chạy luồng này trong CI.

### BE6 — Tài khoản, gói, thanh toán (2–3 buổi)

- **Backend:** `/me/profile`, `/me/subscription`, `/billing/intents`, `/referrals/claim`,
  `/webhooks/bank` (role `api_privileged`, chống trùng `bank_tx_id` ghi **trước** khi gia
  hạn, khớp số tiền, bí mật so sánh không đo thời gian), `DELETE /v1/me`, `AdminModule`
  (kích hoạt gói tay — kể cả gói DN với `branch_limit`, đặt lại mật khẩu). Sự kiện
  `plan.activated`. Gỡ Edge Function `payment-webhook` sau khi webhook mới nghiệm thu.
- **Frontend:** `billing.ts`, `account.ts` gọi SDK; vỏ Nông dân không có màn Gói.
- **Xong khi:** 10 mục VAN_HANH §7.3 chạy trên API; một lần chuyển khoản thật. **Đạt
  phần luồng của R3.**

### BE7 — Doanh nghiệp: nhân viên, chi nhánh, báo cáo (2–3 buổi)

- **Backend:** `/org/members`, `/org/branches` (`BRANCH_LIMIT`), `/reports/summary`; sự kiện
  `member.*`.
- **Frontend:** vỏ Doanh nghiệp.
- **Xong khi:** DN hai chi nhánh, mỗi nơi một nhân viên cân — mỗi người chỉ thấy phiếu chi
  nhánh mình; owner thấy tổng khớp hai chi nhánh cộng lại; tạo chi nhánh thứ N+1 → `BRANCH_LIMIT`.

### BE8 — Ảnh chứng từ (1 buổi)

- **Backend:** signed URL; kiểm `MAX_ATTACHMENTS`, loại và kích thước file; bucket không
  còn policy cho `authenticated`.
- **Frontend:** `attachments.ts` xin URL rồi `PUT` như cũ.
- **Xong khi:** ảnh chụp lúc mất mạng lên được khi có mạng; máy thứ hai xem được; URL hết
  hạn thì không mở được.

### BE9 — Đo lường + giám sát (2 buổi) · R5

- **Backend:** `POST /v1/events`; danh mục là `z.discriminatedUnion` trong contracts, mọi
  sự kiện kèm `orgType`; `plan_activated`, `order_fulfilled`, `link_accepted` do server bắn
  qua listener. View phễu theo vai trò. `/metrics` Prometheus (thời gian phản hồi, số op
  push, tỉ lệ `rejected`, độ dài lô, số job pg-boss lỗi); một dashboard Grafana.
- **Frontend:** `track()` qua hàng đợi; Sentry cho web; sửa trang Quyền riêng tư cùng PR
  ("vựa đã kết nối thấy gì về bác", "đo lường ẩn danh", nhà cung cấp SMS, email).
- **Xong khi:** một vòng luồng R2 trên staging → phễu đủ sự kiện đúng thứ tự, tách được
  theo `orgType`. **Đạt R5.**

### BE10 — Lên production (1–2 buổi)

- **Backup:** job `pg_dump` hằng ngày ra kho riêng (khác nhà cung cấp), giữ 30 ngày,
  **thử phục hồi một lần**. Production đang ở gói Free (không có backup tự động) nên job này
  là **điều kiện bắt buộc trước khi có người dùng thật**. Nâng Pro (org riêng) khi có khách
  trả tiền đầu tiên, database > ~400MB, Storage > ~800MB hoặc production bị tạm dừng lúc có
  người dùng — khi đó thêm lớp backup hằng ngày của Pro. PITR sau khi có doanh thu.
- Rà bảo mật: `git grep` không lộ khoá; `service_role` chỉ có trong env API; `/metrics`
  không mở công khai; CORS chỉ domain prod.
- Migrate prod, deploy image đã chạy ở staging, bật `features` cho nhóm pilot.
- **Xong khi:** pilot một tuần không có op `rejected` ngoài dự kiến; phục hồi backup đã
  làm và ghi lại các bước.

**Tổng BE0 → BE10: khoảng 23–30 buổi.**

---

## 8. Đối chiếu với kiến trúc v2 — mọi ô đều có chỗ

| Ô trên sơ đồ v2 | Bước |
|---|---|
| Client một app, ba vỏ · IndexedDB · hàng đợi | FE song song BE2–BE7 |
| Supabase Auth: đăng ký, OTP SMS, refresh token, JWKS | BE1 (JWKS) · BE2 (OTP) |
| HTTPS /v1 · Bearer JWT · `X-Organization-Id` · REST + sync | BE1 · BE3 |
| Pipeline: JWT → Tổ chức → Quyền → zod → Interceptor → Lỗi chuẩn | BE1 |
| Auth & Hồ sơ | BE2 · BE6 |
| Tổ chức · Chi nhánh | BE2 (schema) · BE7 |
| Đối tác · Kết nối | BE4 |
| Đồng bộ sổ | BE3 |
| Đơn · Đặt lịch | BE5 |
| Phiếu · Công nợ · Kho | BE3 (kho suy từ phiếu, như hiện nay) |
| Báo cáo | BE7 |
| Thông báo (trong app → email) | BE5 |
| Gói · Thanh toán | BE6 |
| Quản trị · Audit | BE2 (audit) · BE6 (admin) |
| Đo lường | BE9 |
| Event bus nội bộ | BE2 (khung) · BE4–BE7 (sự kiện) |
| Prisma · repository `orgId` · 1 transaction/op | BE2 · BE3 |
| PostgreSQL · RLS theo `organization_id` · PostGIS bật sẵn | BE2 |
| Supabase Storage · signed URL | BE8 |
| Supabase Realtime | Giai đoạn 2 |
| Ngân hàng Casso/SePay → webhook | BE6 |
| Email · SMS | BE2 (SMS OTP qua Auth) · BE5 (email) |
| Backup PITR + `pg_dump` | BE10 |
| GitHub Actions · Prometheus/Grafana · Sentry · Log JSON · Bảo mật | BE1 · BE9 · BE10 |

---

## 9. Giai đoạn 2 — sau BE10, cùng khuôn (contract → mock → FE song song → e2e → cờ theo tổ chức)

| Module | Bật khi |
|---|---|
| Supabase Realtime cho đơn, thông báo | Người dùng thấy chậm với hỏi 60 giây |
| Thông báo đẩy / SMS / Zalo | Có người bỏ lỡ lịch hẹn |
| Giao hàng nhiều chặng (vựa → DN) | Có DN trả tiền yêu cầu |
| Phiếu nhập/xuất kho tường minh, lô hàng | DN cần truy xuất nguồn gốc |
| Map / PostGIS, chợ mở | Nông dân muốn gửi đơn cho vựa chưa kết nối — bàn riêng |
| Báo cáo nặng phía server cho vựa | Sổ > ~2.000 phiếu |
| Capacitor | Cần API native mà TWA không có |

---

## 10. Lịch phối hợp với frontend

| Backend làm | Frontend cần có sẵn | Frontend làm song song |
|---|---|---|
| BE0 | Release `v0.1.0` (`@mambo/core`, `@mambo/contracts`) | Chốt quy ước §3; chuyển `@/core/` → `@mambo/core/` |
| BE1 | Contract `me`, định dạng lỗi | `/lien-he`, link pháp lý (R4); khung chọn vỏ |
| BE2 | Contract `bootstrap`, `resolve-identifier`, `links/discover`, ma trận quyền | "Bác là ai?", màn OTP, `auth.ts` |
| BE3 | Contract `sync` + mock | `sync.ts`, `pullChanges.ts`, `cache.ts`, `queue.ts` |
| BE4 | Contract `links`, `linked` | Vỏ Nông dân (phần xem), "Mời kết nối" |
| BE5 | Contract `orders`, `notifications` | Đơn, hẹn lịch, ô "Theo đơn" |
| BE6 | Contract billing/account | `billing.ts`, `account.ts` |
| BE7 | Contract `org`, `reports` | Vỏ Doanh nghiệp |
| BE8 | Contract attachments | `attachments.ts` |
| BE9 | Danh mục sự kiện | `track()`, Sentry web, trang Quyền riêng tư; TWA + CH Play thử nghiệm kín |

Nhịp: 15 phút đầu tuần chốt contract của tuần; đổi contract giữa tuần qua PR, ghi một dòng
`packages/contracts/CHANGELOG.md`.

---

## 11. Rủi ro và cách chặn

| Rủi ro | Chặn bằng |
|---|---|
| Hai phía hiểu khác một trường | Một schema zod cho cả hai + `openapi.json` trong git |
| Mất khoản trả khi đồng bộ | Năm test §4.4 + bảy kịch bản e2e |
| Lộ sổ vựa này cho vựa khác | Hai lớp §5: Guard + RLS theo phiên; test cố tình bỏ lọc |
| Lộ sổ vựa cho người lạ vì SĐT | OTP bắt buộc + bấm đồng ý + chỉ trường biên nhận + huỷ có hiệu lực ngay |
| Nhân viên làm việc không được phép | Ma trận quyền kiểm ở từng op sync |
| Đơn bị hai bên đổi cùng lúc | `version` + `409` + `order_events` |
| Lệch giờ máy khách | Cursor do server cấp |
| API sập thì app chết | Vựa/DN vẫn ghi cục bộ; chỉ đơn và phần nông dân cần mạng |
| Listener hỏng làm hỏng việc chính | Listener chạy sau commit; gửi ra ngoài qua pg-boss có thử lại |
| Chi phí SMS OTP | Rate limit ở Auth; OTP chỉ khi xác thực số, không phải mỗi lần đăng nhập |
| Phạm vi phình ra | Không làm §9 trước khi BE10 đạt |

---

## 12. Quyết định đã chốt (21/09/2026)

1. **Trả tiền:** nông dân miễn phí · vựa 149.000đ/tháng · DN theo số chi nhánh; đơn và kết
   nối miễn phí cho mọi bên (§1.7).
2. **Đồng bộ qua NestJS**, cursor do server cấp (§4).
3. **OTP SMS + bấm đồng ý** trước khi kết nối (§1.4).
4. **Đơn** bản đầu chỉ gửi cho tổ chức đã kết nối; chợ mở ở giai đoạn 2.
5. **zod** thay class-validator; **Winston** cho log.
6. **Hạ tầng:** vùng Singapore, `api.thumua365.vn`, gói npm `@mambo/*`; không Redis,
   không ELK, không Kubernetes ở giai đoạn này.
7. **Duyệt PR** vào `packages/core`, `packages/contracts`: bắt buộc cả hai người.

Còn chờ: frontend xác nhận quy ước §3 (việc BE0 của frontend); nhà cung cấp SMS (BE2);
Docker Desktop trên máy dev (BE2); quyền DNS `thumua365.vn`; số tài khoản nhận tiền và
người chịu trách nhiệm pháp lý (Nguyên, Linh). Nơi chạy container: **Render**, Singapore (chốt ở BE1).
