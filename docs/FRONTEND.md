# HƯỚNG DẪN FRONTEND — làm gì để khớp với backend THUMUA365

> Viết cho người làm frontend, nhất là khi **dựng lại app từ đầu**. Đọc hết file này là biết
> cài gì, gọi gì, theo luật nào, và mỗi bước backend sắp ra thì frontend phải làm gì. Chi
> tiết sâu hơn: [BE-backend-nestjs.md](BE-backend-nestjs.md).
>
> Cập nhật **03/10/2026** · Hợp đồng đã phát hành **`v0.5.0`** (BE0–BE4: tài khoản, tổ chức,
> đồng bộ sổ, kết nối bằng **mã kết nối** + phần xem của nông dân; OTP tạm ẩn) · Tiếp theo: BE5 (đơn,
> đặt lịch, thông báo).
> **Backend làm trước, frontend làm sau** (chốt 28/09/2026): file này cùng `openapi.json` và các
> trang thử trong `tools/login-test` là bản mô tả đầy đủ để dựng app khi tới lượt frontend.
> File này được sửa **cùng PR** với mọi thay đổi hợp đồng. Nếu thấy lệch với code thì code
> là đúng — báo backend sửa file này.

---

## 0. Tóm tắt 12 dòng

1. Một app web React + TypeScript (PWA) có **ba vỏ** giao diện, chọn theo `organization.type`:
   `farmer` · `trader` · `enterprise`.
2. Trình duyệt chỉ nói chuyện với **ba chỗ**: Supabase Auth (qua `supabase-js`), NestJS API
   (qua `@mambo/sdk`), Supabase Storage (qua URL ký sẵn do API cấp, từ BE8). **Không bao giờ**
   đọc hay ghi bảng Postgres trực tiếp.
3. Cài ba gói `@mambo/core`, `@mambo/contracts`, `@mambo/sdk` từ GitHub Release của repo BE,
   ba gói **cùng một số phiên bản**.
4. Gọi API **chỉ qua `@mambo/sdk`**. Không `fetch` tay, không tự khai kiểu request/response.
5. Đường dẫn bắt đầu bằng `/v1/…`. Token gửi bằng `Authorization: Bearer <access_token Supabase>`.
   Tổ chức đang làm việc gửi bằng header `X-Organization-Id` (SDK tự gửi).
6. Lỗi luôn có dạng `{ "error": { code, message, details?, requestId? } }`. Rẽ nhánh theo
   `code`, **không** theo `message`.
7. Tên trường camelCase · tiền là số nguyên đồng · thời gian ISO 8601 có múi giờ · id bản
   ghi sổ là UUID v4 do máy khách sinh.
8. Tính tiền **chỉ** bằng `@mambo/core`. Server tính lại bằng đúng hàm đó; lệch thì bị từ chối.
9. Ẩn/hiện chức năng theo `membership.permissions` của `/v1/me`. Server vẫn luôn kiểm lại.
10. Vựa và doanh nghiệp ghi sổ offline vào IndexedDB + hàng đợi, đồng bộ qua `/v1/sync/push`
    và `/v1/sync/pull` (BE3). Nông dân không có sổ offline.
11. Không tự dựng backend, không viết migration Supabase, không tự đặt đường dẫn, header hay
    định dạng lỗi khác.
12. Cần endpoint hay trường mới thì mở PR/issue vào `packages/contracts` ở repo BE **trước**.
    Cả backend lẫn frontend cùng duyệt.

---

## 1. App nói chuyện với ai

```
┌─────────────── Trình duyệt: React PWA, ba vỏ ───────────────┐
│  features/ (màn hình)  ──▶  data/ (chỗ DUY NHẤT chạm mạng)   │
└──────────────┬──────────────────┬───────────────────┬────────┘
          supabase-js         @mambo/sdk          PUT file
               ▼                  ▼                   ▼
        Supabase Auth      NestJS API /v1      Supabase Storage
        đăng ký, đăng      (Render,            (URL ký sẵn do API
        nhập, OTP,         Singapore)          cấp — từ BE8)
        làm mới token          │
                               ▼
                        Postgres (RLS)
```

| Việc | Gọi ai | Ghi chú |
|---|---|---|
| Đăng ký, đăng nhập, đăng xuất, làm mới token, OTP | Supabase Auth qua `supabase-js` | Mật khẩu **không** đi qua API |
| Mọi dữ liệu nghiệp vụ: hồ sơ, tổ chức, sổ, đơn, kết nối, gói… | NestJS API qua `@mambo/sdk` | |
| Ảnh chứng từ | Xin URL ở API, rồi `PUT` thẳng lên Storage | BE8 |
| Bảng Postgres | **Không** gọi từ trình duyệt | Data API (PostgREST) đã tắt; `anon`/`authenticated` không có quyền trên bảng nào ⇒ `supabase.from(…)` và `supabase.rpc(…)` đều hỏng |

**Khuyến nghị cấu trúc.** Frontend tự quyết cấu trúc thư mục, nhưng nên giữ ranh giới này để
khi backend đổi thì chỉ phải sửa một thư mục:

- `src/data/` là nơi **duy nhất** import `supabase-js` và `@mambo/sdk`. Thư mục này giữ
  IndexedDB, hàng đợi và cache.
- `src/features/<vỏ>/` và `src/components/` chỉ đọc/ghi qua store của `data/`.
- Hàm tính toán lấy từ `@mambo/core/*`, không chép lại.

---

## 2. Cài đặt

### 2.1 Gói

```json
{
  "dependencies": {
    "@mambo/core": "https://github.com/remembered-fragrance/Thumua365_BE/releases/download/v0.5.0/mambo-core-0.5.0.tgz",
    "@mambo/contracts": "https://github.com/remembered-fragrance/Thumua365_BE/releases/download/v0.5.0/mambo-contracts-0.5.0.tgz",
    "@mambo/sdk": "https://github.com/remembered-fragrance/Thumua365_BE/releases/download/v0.5.0/mambo-sdk-0.5.0.tgz",
    "@supabase/supabase-js": "^2.116.0",
    "zod": "^4.1.0"
  }
}
```

- Ba gói `@mambo/*` **luôn cùng một số phiên bản**. Muốn nâng thì đổi cả ba URL, và đọc
  [CHANGELOG](../packages/contracts/CHANGELOG.md) trước khi đổi.
- `zod` là peer dependency: app và các gói dùng chung **một** bản zod.
- `@mambo/core` xuất **từng file**, ví dụ `import { normalizePhone } from '@mambo/core/identifier'`.
  Không có `import … from '@mambo/core'`.
- TypeScript: `moduleResolution: "bundler"` (mặc định của Vite). Đã thử cài từ release, kiểm
  kiểu và chạy đều được.
- `openapi.json` đi kèm gói contracts (`node_modules/@mambo/contracts/openapi.json`), có thể
  mở bằng Swagger hoặc Postman.

### 2.2 Biến môi trường

| Biến | Staging | Ghi chú |
|---|---|---|
| `VITE_API_URL` | `https://thumua365-api-staging.onrender.com` | **Không** thêm `/v1`, không có `/` ở cuối — đường dẫn trong `routes` đã gồm `/v1` |
| `VITE_SUPABASE_URL` | `https://bldlrkmszjmhifubxjvl.supabase.co` | Project `thumua365-staging` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | xin Tài | Khoá publishable, để công khai được. **Không bao giờ** đặt secret key hay `service_role` vào frontend |

Giá trị production sẽ điền ở BE10 (`api.thumua365.vn` khi có quyền DNS).

**CORS.** Staging chỉ cho phép `http://localhost:5173` và `http://localhost:5174`. Nếu chạy dev
ở cổng khác, hoặc có domain preview (Vercel…), báo Tài thêm vào `CORS_ORIGINS`. Header được
phép gửi: `authorization`, `content-type`, `x-organization-id`, `x-request-id`. Mọi header
khác đều bị trình duyệt chặn ngay ở bước preflight.

**Staging chạy gói free của Render:** không có request trong ~15 phút thì máy ngủ, và request
đầu tiên sau đó có thể chậm. Đó không phải lỗi.

### 2.3 Khởi tạo client

```ts
// src/data/client.ts
import { createClient as createSupabase } from '@supabase/supabase-js';
import { createClient } from '@mambo/sdk';

export const supabase = createSupabase(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
);

let currentOrgId: string | null = null;
export const setCurrentOrg = (id: string | null) => {
  currentOrgId = id;
};

export const api = createClient({
  baseUrl: import.meta.env.VITE_API_URL,
  // Luôn lấy token của phiên HIỆN TẠI — supabase-js tự làm mới khi sắp hết hạn.
  getAccessToken: async () => (await supabase.auth.getSession()).data.session?.access_token ?? null,
  // SDK gửi giá trị này làm header X-Organization-Id.
  getOrganizationId: () => currentOrgId,
});
```

Các hàm SDK đã có ở `v0.5.0`:

| Hàm | Endpoint | Cần | Trả về |
|---|---|---|---|
| `api.health()` | `GET /v1/health` | — | `{ status, version, commit, env }` |
| `api.me()` | `GET /v1/me` | đăng nhập | `Me` |
| `api.meBootstrap(input)` | `POST /v1/me/bootstrap` | đăng nhập | `Me` |
| `api.resolveIdentifier({ identifier })` | `POST /v1/auth/resolve-identifier` | — (10 lần/phút/IP) | `{ email }` |
| `api.discoverLinks()` | `POST /v1/links/discover` | đăng nhập + tổ chức + quyền `linked:read` | `{ created, pending }` |
| `api.links.list()` · `.invite(input)` · `.claim({ code })` · `.revoke(id)` | `/v1/links…` (BE4; `discover`, `accept` là đường OTP — tạm ẩn) | tổ chức; quyền theo mục 5.6 | `{ links }` / `LinkSummary` |
| `api.linked.receipts({ orgId })` · `api.linked.balance()` | `/v1/linked/…` (BE4) | tổ chức + `linked:read` | mục 5.6 |
| `api.sync.push({ deviceId, ops })` | `POST /v1/sync/push` | đăng nhập + tổ chức + quyền `book:sync` | `{ results }` — mục 7.3 |
| `api.sync.pull({ cursor, limit })` | `GET /v1/sync/pull` | đăng nhập + tổ chức + quyền `book:sync` | `{ cursor, hasMore, resetRequired, changes }` — mục 7.4 |

Ví dụ chạy được với đúng các hàm này: [`tools/login-test/app.js`](../tools/login-test/app.js) (tài
khoản) và [`tools/login-test/sync.js`](../tools/login-test/sync.js) (sổ offline: hàng đợi, đẩy, kéo,
hợp nhất). Chạy `npm run login-test` ở repo BE rồi mở http://localhost:5174; đồng bộ sổ ở
`/sync.html?may=A` và `?may=B` — hai "máy" trên một trình duyệt.

---

## 3. Quy ước hợp đồng — không đổi

| Mục | Quy ước |
|---|---|
| Đường dẫn | `/v1/…`. Trong `/v1` chỉ **thêm**, không bỏ hay đổi nghĩa |
| Xác thực | `Authorization: Bearer <access_token Supabase>`. API chỉ kiểm token, không phát token |
| Tổ chức | Header `X-Organization-Id` bắt buộc với endpoint nghiệp vụ. Server kiểm người gọi đang là thành viên `active` |
| Tên trường | camelCase, trùng `@mambo/core/types`. Server lọc bỏ mọi trường không có trong schema |
| Thân request | Schema chặt (`strictObject`): gửi **trường lạ là bị 422**, không bị lặng lẽ bỏ qua |
| Id | Bản ghi sổ: UUID v4 do máy khách sinh (`newId()` của `@mambo/core/id`). Đơn, kết nối, thành viên: server sinh |
| Thời gian | ISO 8601 có múi giờ |
| Tiền | `number`, số nguyên đồng |
| Khối lượng, % | `number` thập phân |
| Khách lẻ | `counterpartyId: null` |
| Xoá | Không `DELETE` cứng dữ liệu nghiệp vụ — chỉ xoá mềm (`deletedAt`) |

---

## 4. Lỗi

```json
{ "error": { "code": "PLAN_EXPIRED", "message": "Gói đã hết hạn", "details": {}, "requestId": "…" } }
```

SDK ném `ApiError` có các trường `code`, `status`, `message`, `requestId`, `details`. Ngoài các
mã của hợp đồng, còn hai trường hợp nữa:

- `CONTRACT_MISMATCH`: API trả về sai hợp đồng. SDK chặn lại, không để dữ liệu sai chảy vào sổ.
  Báo backend.
- Lỗi mạng (không có phản hồi): `fetch` ném `TypeError` như thường, SDK không bọc lại.

| `code` | HTTP | Frontend làm gì |
|---|---|---|
| `UNAUTHENTICATED` | 401 | Làm mới token, thử lại một lần. Vẫn lỗi thì về màn đăng nhập, **giữ** hàng đợi |
| `NOT_A_MEMBER` | 403 | Xoá cache của tổ chức đó, gọi lại `/v1/me`, về màn chọn tổ chức |
| `FORBIDDEN` | 403 | Không thử lại. Nếu là op sync thì đánh dấu `conflict` |
| `PHONE_NOT_VERIFIED` | 403 | Mở màn xác thực OTP — chỉ khi OTP mở lại (mục 5.5); hiện chưa gặp |
| `LINK_REQUIRED` | 403 | Báo "Cần kết nối trước" |
| `PLAN_EXPIRED` | 402 | Dừng lượt sync, **không tính là một lần thử**, hiện màn gia hạn |
| `BRANCH_LIMIT` | 402 | Báo "Gói hiện tại cho tối đa N chi nhánh" |
| `VALIDATION_FAILED` | 422 | Không thử lại. `details.fields` = `{ "orgName": "…" }` (tên trường → câu lỗi), gắn câu lỗi vào đúng ô |
| `PARENT_MISSING` | 409 | Thử lại theo lịch giãn cách |
| `ORDER_STATE_CHANGED` | 409 | Tải lại đơn |
| `NOT_FOUND` | 404 | Không thử lại |
| `PAYLOAD_TOO_LARGE` | 413 | Thân > 1MB: chia nhỏ lô sync, không gửi lại nguyên lô |
| `RATE_LIMITED` | 429 | Thử lại sau `Retry-After` giây |
| `INTERNAL` | 5xx | Thử lại theo lịch giãn cách; không có chi tiết (chi tiết nằm trong log) |
| `CONTRACT_MISMATCH` | — | Chỉ SDK sinh ra. Báo backend kèm `requestId` |
| lỗi mạng (`TypeError`) | — | Coi như 5xx: thử lại theo lịch giãn cách |

- Hàng đợi dùng `isRetryable(code)` của `@mambo/contracts`: chỉ `PARENT_MISSING`, `RATE_LIMITED`,
  `INTERNAL` (và lỗi mạng) được thử lại.
- Thiếu hoặc sai header tổ chức sẽ trả `VALIDATION_FAILED` kèm `details.header: 'X-Organization-Id'`.
  Đây là lỗi của app, không phải lỗi người dùng.
- Hiện `requestId` ở màn báo lỗi hoặc nút "Gửi cho hỗ trợ", vì backend tra log bằng nó.
- Câu chữ trong `message` có thể đổi bất cứ lúc nào — đừng so sánh chuỗi.

---

## 5. Tài khoản, tổ chức, quyền — đã chạy trên staging (`v0.3.0`)

### 5.1 Đăng ký

```ts
import { normalizePhone } from '@mambo/core/identifier';

const phone = normalizePhone(rawPhone);        // '' nếu sai → báo "Số điện thoại chưa đúng"
// Có email thật thì dùng email đó; không có thì dùng email nội bộ tạo từ số: 849…@id.thumua365.vn
const email = realEmail || `${phone.replace('+', '')}@id.thumua365.vn`;
const { data, error } = await supabase.auth.signUp({ email, password });
// data.session phải có ngay (staging đã tắt "Confirm email"). Không có session = lỗi cấu hình, báo backend.
const me = await api.me();                     // memberships: [] → sang bước "Bác là ai?"
```

Bước **"Bác là ai?"**:

```ts
const me = await api.meBootstrap({
  orgType: 'trader',          // 'farmer' | 'trader' | 'enterprise'
  orgName: 'Vựa Tư Hùng',     // 1–120 ký tự
  name: 'Tư Hùng',            // 1–80 ký tự
  username: 'tuhung',         // tuỳ chọn: 3–32 ký tự a-z 0-9 . _ (không phân biệt hoa thường), không giống SĐT
  phone: '0912345678',        // tuỳ chọn — CHỈ dùng khi đăng ký bằng email thật
});
```

- Một lần gọi tạo đủ hồ sơ, tổ chức, vai trò `owner`, và gói dùng thử 30 ngày (vựa, doanh
  nghiệp). Nông dân không có gói.
- **Gọi lại an toàn:** người đã có tổ chức gọi lại thì nhận về `Me` hiện tại, không tạo tổ chức thứ hai.
- Tài khoản đăng ký bằng số điện thoại: server lấy số từ chính tài khoản, bỏ qua trường `phone`.
- Tên đăng nhập hoặc số đã có người dùng → `VALIDATION_FAILED`, `details.fields.username` /
  `details.fields.phone`.
- **Xoá sạch form "Bác là ai?" khi đăng xuất và sau khi tạo xong.** Lỗi này đã gặp thật khi
  nghiệm thu: form giữ lựa chọn của người trước, nên tài khoản sau tạo nhầm loại tổ chức.

### 5.2 Đăng nhập bằng một ô

```ts
const { email } = await api.resolveIdentifier({ identifier });   // tên tài khoản / SĐT / email
const { error } = await supabase.auth.signInWithPassword({ email, password });
if (error) showError('Tài khoản hoặc mật khẩu không đúng');       // MỘT câu cho mọi trường hợp
```

- API **luôn** trả về một email, kể cả khi không có tài khoản nào, để không ai dùng endpoint
  này dò xem ai có tài khoản. Vì vậy **đừng** thêm câu kiểu "không tìm thấy tài khoản".
- Quá 10 lần/phút/IP thì bị `RATE_LIMITED`.
- ⚠️ **Có thể đổi:** nhóm đang cân nhắc thay bằng `POST /v1/auth/login` (API đăng nhập hộ),
  vì gõ đúng tên tài khoản thì lộ ra email đăng nhập. Hãy gói hai dòng trên vào **một** hàm
  `signIn(identifier, password)` trong `data/` để nếu đổi thì chỉ sửa một chỗ.

### 5.3 Sau khi đăng nhập — `/v1/me` quyết định mọi thứ

```jsonc
{
  "user": { "id": "uuid", "name": "Cô Mai", "phone": "+84912…", "email": null, "phoneVerified": true },
  "memberships": [{
    "organization": { "id": "uuid", "type": "farmer", "name": "Hộ cô Mai" },
    "role": "owner",
    "branch": null,                       // DN: { id, name } với nhân viên chi nhánh
    "permissions": ["order:create", "order:respond", "linked:read", "report:view", "billing:manage", "account:delete"],
    "plan": null,                         // vựa/DN: { tier, status, periodEnd, branchLimit }
    "features": ["orders", "links"]
  }],
  "pendingLinks": 2
}
```

| Tình huống | Làm gì |
|---|---|
| `memberships` rỗng | Màn "Bác là ai?" |
| Một tổ chức | Chọn luôn |
| Nhiều tổ chức | Màn chọn tổ chức; nhớ lựa chọn theo người dùng |
| Tổ chức đã nhớ không còn trong `memberships` | Bỏ lựa chọn cũ, chọn lại |
| `NOT_A_MEMBER` ở bất kỳ endpoint nào | Xoá cache của tổ chức đó, gọi lại `/v1/me`, về màn chọn tổ chức |

- **Vỏ giao diện** = `membership.organization.type`. `hasBook(type)` của contracts cho biết tổ
  chức có sổ offline và có gói hay không.
- **Ẩn/hiện chức năng** = `membership.permissions.includes('…')`. Đừng suy quyền từ tên vai trò.
  `can(type, role, permission)` của contracts đọc cùng bảng quyền, dùng khi cần tính lúc offline.
- **Gói** = `membership.plan` (luôn `null` với nông dân):
  - `tier`: `trial | premium | grace | free`
  - các trường khác: `status`, `periodEnd`, `branchLimit`

  Hết gói thì **vẫn đọc và xuất file được** — chỉ chặn ghi sổ.
- **Cờ tính năng** = `membership.features` (`orders`, `links`). Chức năng mới chỉ hiện khi tổ
  chức có cờ tương ứng — đây là cách mở dần cho nhóm pilot.
- `user.email` là `null` với tài khoản chỉ có số điện thoại (email nội bộ bị giấu).
  `user.phone` có dạng `+84…`; hiển thị bằng `formatPhoneVn` của `@mambo/core/identifier`.
- `pendingLinks` là số lời mời kết nối đang chờ (hiện chấm đỏ).
- Gọi `/v1/me` khi: mở app lúc có mạng, sau khi đăng nhập, sau bootstrap, sau OTP, sau
  `NOT_A_MEMBER`. Lưu bản mới nhất vào IndexedDB (khoá theo `user.id`), để mở app lúc offline
  vẫn biết vỏ và quyền.

### 5.4 Ma trận quyền

Bảng gốc: `PERMISSIONS_BY` trong `@mambo/contracts`. Bảng dưới đây để thiết kế màn hình.

| Quyền | Nông dân | Vựa owner | Vựa staff (người cân) | DN owner | DN manager | DN staff |
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

Vựa **không có** vai trò `manager`; nông dân chỉ có `owner`.

### 5.5 Xác thực số điện thoại (OTP) — TẠM ẨN, chưa làm màn này

**Quyết định 01/10/2026:** kết nối dùng **mã kết nối** (mục 5.6). OTP tạm ẩn tới khi > 100 tổ chức
trả phí — **không làm màn OTP** cho tới lúc đó. Staging và production **tắt** Phone provider, nên
`supabase.auth.updateUser({ phone })` báo lỗi và `api.links.discover()` luôn trả
`PHONE_NOT_VERIFIED` — app chưa gọi hai việc này.

Khi mở lại (để dành, backend không phải sửa gì):

```ts
await supabase.auth.updateUser({ phone });                                  // phone dạng +84…
await supabase.auth.verifyOtp({ phone, token: code, type: 'phone_change' });
const me = await api.me();                                                  // user.phoneVerified === true
const { created, pending } = await api.links.discover();                    // cần đã chọn tổ chức
```

- Gặp `PHONE_NOT_VERIFIED` thì mở màn OTP. Chỉ bắt nhập OTP khi xác thực số, **không** phải mỗi
  lần đăng nhập (mỗi SMS tốn tiền). `discover` cần `linked:read`.

### 5.6 Kết nối và phần xem của nông dân — BE4 (`v0.5.0`, đã nghiệm thu trên staging) · mã kết nối từ 01/10

Một kết nối nối **một dòng danh bạ trong sổ của vựa** (người bán / người mua) với **một tổ chức
có tài khoản thật**. Nhìn từ tổ chức đang làm việc, mỗi kết nối có `side`:
`owner` = dòng danh bạ nằm trong sổ của mình · `linked` = mình là người được nhắc tới trong sổ
bên kia, và mình được xem.

**Phía vựa** (`side: 'owner'`) — trên trang nông hộ, nút "Mời kết nối":

```ts
const link = await api.links.invite({ partnerKind: 'supplier', partnerId });
link.inviteCode; // { code: 'K7M2QX9P', expiresAt } — hiện "K7M2-QX9P", to, dễ đọc; sau này kèm QR
```

- Vựa đưa mã **tận tay** cho đúng người: đọc lúc cân, hoặc nút "Gửi qua Zalo" (app tự soạn câu
  mời kèm mã). Mã hạn **7 ngày**, dùng **một lần**.
- Gọi lại `invite` an toàn: mã còn hạn → **đúng mã cũ** (QR đã in vẫn dùng được); hết hạn → mã
  mới. `api.links.list()` trả `inviteCode` của từng lời mời đang chờ (`null` = hết hạn → hiện nút
  "Lấy mã mới", gọi lại `invite`). Chỉ phía `owner` thấy mã.
- Dòng danh bạ **không cần** có số điện thoại.
- `list()` cho biết từng người bán: chưa kết nối / đã mời (kèm mã) / đang kết nối / đã huỷ.

**Phía nông dân** (`side: 'linked'`) — ô "Nhập mã kết nối" (vỏ Nông dân, và cả vựa / DN khi được
bên trên mời):

```ts
const link = await api.links.claim({ code });  // gõ kiểu gì cũng được: 'k7m2-qx9p', ' K7M2 QX9P '
// → 'active' ngay, link.counterpart = vựa vừa nối. Nhập mã chính là bấm đồng ý.
const { items } = await api.linked.balance();  // mỗi vựa đang kết nối: theyOwe / youOwe
const page = await api.linked.receipts({ orgId: items[0].organization.id }); // mới nhất trước, có cursor
```

- `NOT_FOUND` = mã sai, đã dùng hoặc hết hạn — **một câu chung**: "Mã không đúng hoặc đã hết hạn,
  xin vựa mã mới". `VALIDATION_FAILED` với `fields.code` = sai hình dạng (không đủ 8 ký tự, có
  0/O/1/I/L) hoặc là mã của chính sổ mình. `RATE_LIMITED` sau 10 lần thử trong một phút.
- **QR (sau này):** QR chỉ là cách khác để chuyển **cùng mã đó** — app vựa vẽ QR từ
  `inviteCode.code` (ví dụ chứa `https://<app>/ket-noi?ma=K7M2QX9P`), app nông dân quét, lấy `ma`,
  gọi đúng `api.links.claim({ code })`. Backend không cần thêm gì.
- Bảng chữ của mã: `LINK_CODE_ALPHABET` trong `@mambo/contracts` — dùng nó để lọc ký tự khi gõ.

Luật:

- **Chỉ bên được mời** nhập mã; mã chứng minh vựa đã trao cho đúng người. (Đường OTP —
  `discover` + `accept` — tạm ẩn, mục 5.5.)
- Huỷ: cả hai bên. Bên sổ cần `partner:manage`, bên được xem cần `linked:read`. Huỷ là mất quyền
  xem **ngay**; kết nối đã huỷ không mở lại được — muốn nối lại thì vựa mời lại (kết nối mới).
- Chưa `active` mà gọi `linked.receipts` → `LINK_REQUIRED` ("Cần kết nối trước").
- Người cân của vựa không xem, không mời, không huỷ kết nối (`FORBIDDEN`).
- Phiếu bên kia cho xem (`LinkedReceipt`) **chỉ có trường in trên biên nhận**: ngày, loại, tên
  mình trên biên nhận, từng dòng (mặt hàng, cân, bì / hàm lượng / hao hụt, số tính tiền, đơn giá,
  thành tiền), khoản cộng/trừ, các lần trả, tổng, đã trả, còn nợ. Không có ghi chú nội bộ, người
  lập phiếu, chi nhánh, ảnh. Tổng do server tính bằng `@mambo/core` — hiển thị nguyên số.
- `kind` nhìn từ bên giữ sổ: `purchase` — họ mua của mình (**họ nợ mình** phần còn lại);
  `sale` — họ bán cho mình (**mình nợ họ**). `balance` đã cộng sẵn thành `theyOwe` / `youOwe`.
- Cùng cơ chế cho vựa ↔ doanh nghiệp.

### 5.8 Đơn hàng, đặt lịch, thông báo — BE5 (hợp đồng đã có, chưa phát hành)

Đơn **cần mạng** (id do server sinh, không nằm trong sổ offline) và chỉ gửi được cho tổ chức **đã
kết nối đúng chiều** — chưa thì `LINK_REQUIRED` ("Cần kết nối trước"). Danh sách tổ chức chọn được
lấy từ `api.links.list()` (`counterpart` của kết nối `active`).

```ts
// Nông dân — "Tạo đơn bán"
const order = await api.orders.create({ role: 'seller', counterpartOrgId, crop: 'rubber', estQuantity: 1000, note });
// Vựa — danh sách đơn tới, nhận, hẹn lịch (mọi bước gửi kèm version đang thấy)
const { orders, cursor } = await api.orders.list({ role: 'buyer', status: 'submitted' });
await api.orders.accept(o.id, { version: o.version });
await api.orders.schedule(o.id, { version: o.version + 1, pickupAt, pickupAddress });
// Bên nào cũng huỷ được; lịch sử đơn
await api.orders.cancel(o.id, { version, note });
const detail = await api.orders.get(o.id); // detail.events: [{ toStatus, by: 'me' | 'counterpart', note, at }]
```

| Bước | Ai | Từ trạng thái |
|---|---|---|
| `accept` · `reject` | bên **nhận** đơn (không phải bên tạo), `order:respond` | `submitted` |
| `schedule` | bên **mua** (người đến cân), `order:respond`; gọi lại để đổi lịch | `accepted`, `scheduled` |
| `cancel` | bên nào cũng được (bên tạo cần `order:create`, bên nhận `order:respond`) | `submitted`, `accepted`, `scheduled` |
| `fulfilled` | **không có nút** — phiếu có `orderId` đồng bộ lên thì server tự chuyển | mọi trạng thái còn mở |

- `ORDER_STATE_CHANGED` (409): bên kia vừa đổi đơn, hoặc trạng thái không cho bước đó. `details`
  mang `status`, `version` mới — tải lại đơn (`get`), vẽ lại, **không tự bấm lại**.
- **Ô "Theo đơn" ở màn Tạo phiếu (vựa/DN):** chọn một đơn `accepted`/`scheduled` → điền sẵn
  `counterpartyId = order.partnerId` (dòng danh bạ của bên kia **trong sổ mình**; null thì người
  dùng chọn tay) và đặt `orderId` vào `data` của op `transaction` insert (nháp cũng mang được
  `orderId`). Phiếu bán gắn đơn mình **bán**, phiếu mua gắn đơn mình **mua**.
- Đơn bị huỷ trong lúc vựa cân offline, đơn không còn (bên kia đã xoá tài khoản), hay gắn sai chiều:
  phiếu **vẫn được ghi**, server gỡ `orderId`, op có `warning: 'ORDER_NOT_OPEN'` — báo nhẹ "Đơn
  không còn mở; phiếu vẫn lưu", không coi là lỗi. Phiếu không bao giờ bị `rejected` vì đơn. Nháp
  cũng vậy.
- Người gắn chi nhánh (DN) chỉ thấy đơn của chi nhánh mình; đơn tạo ra mang chi nhánh đó.

**Thông báo** (mọi vai trò): gọi `api.notifications.list()` khi mở app và mỗi 60 giây; huy hiệu
lấy `unread`. Mở thông báo → `api.notifications.read({ ids: [id] })`; "Đánh dấu tất cả" →
`api.notifications.read()`. Mỗi thông báo có `kind` (`order.submitted` · `order.accepted` ·
`order.scheduled` · `order.cancelled` · `order.fulfilled` · `link.accepted` · `link.revoked`, và
về sau `member.*`, `plan.activated`), `from` (tổ chức gây ra việc), `orderId`/`orderStatus`/
`pickupAt` hoặc `linkId`. Gặp `kind` chưa biết vẽ thì bỏ qua. Thông báo là của **tổ chức** — mọi
thành viên cùng thấy, cùng trạng thái đã đọc.

### 5.9 Nhân viên, chi nhánh, báo cáo — BE7 (hợp đồng đã có, chưa phát hành)

**Chủ tạo tài khoản cho người của mình** — người cân / quản lý không tự đăng ký, không cần OTP:

```ts
const { members } = await api.org.members.list();              // chủ: staff:manage
await api.org.members.create({ name, phone, password, role: 'staff', branchId });
await api.org.members.update(id, { role: 'manager', branchId });  // đổi chi nhánh → máy người đó resetRequired
await api.org.members.remove(id);                                 // mất quyền ngay
const { branches, limit, used } = await api.org.branches.list();  // branch:manage
await api.org.branches.create({ name, address });                 // vượt gói → BRANCH_LIMIT (details.limit)
await api.org.branches.update(id, { archived: true });            // còn người gắn → VALIDATION_FAILED
const report = await api.reports.summary({ from, to, branchId }); // report:view
```

- Người được tạo đăng nhập bằng **số điện thoại + mật khẩu chủ đặt** (màn đăng nhập một ô như mọi
  người), rồi tự đổi mật khẩu. App của họ thấy ngay tổ chức trong `/v1/me` — **không** hiện "Bác là
  ai?" (đã có membership).
- Lỗi khi tạo: `details.reason` `ACCOUNT_EXISTS` → "Số này đã có tài khoản ở nơi khác";
  `ALREADY_MEMBER` → "Người này đã ở trong tổ chức". Số từng bị gỡ khỏi tổ chức → được bật lại với
  tài khoản (và mật khẩu) cũ — báo chủ "đã thêm lại, dùng mật khẩu cũ".
- Vai trò chọn được: vựa — chỉ `staff` (người cân); doanh nghiệp — `manager`, `staff`. Không có nút
  sửa / gỡ trên dòng của chủ và của chính mình (server cũng chặn).
- Báo cáo: `from`/`to` là mốc ISO có múi giờ (app tính đầu ngày giờ Việt Nam), `to` không gồm, tối đa
  366 ngày. `totals` + từng `branches[]` (chi nhánh `null` = phiếu không gắn chi nhánh); mỗi bên
  `{ count, netWeight, amount, paid, debt }`. Người gắn chi nhánh chỉ thấy chi nhánh mình. Nông dân
  cũng gọi được: số là phiếu các vựa ghi về mình, nhìn từ phía mình (`sale` = mình bán).

### 5.10 Gói, chuyển khoản, hồ sơ, xoá tài khoản — BE6 (hợp đồng đã có, chưa phát hành)

**Màn Gói** — chỉ hiện với người có `billing:manage`; nông dân không có màn này:

```ts
const sub = await api.billing.subscription();        // { plan, trialEndsAt, currentPeriodEnd, selfServe, prices }
if (sub.selfServe) {                                  // vựa: tự mua
  const intent = await api.billing.createIntent({ months: 12 });
  // Mã QR VietQR: số tài khoản / ngân hàng từ config của app, số tiền intent.amount,
  // nội dung intent.transferContent ("TM365 K7M2P9") — người dùng KHÔNG được sửa nội dung.
}
const { intents } = await api.billing.intents();     // lịch sử: pending → paid
```

- Tiền vào → Casso / SePay báo server → gói tự gia hạn (thường vài giây đến vài phút). App không
  gọi gì để "xác nhận đã trả": sau khi người dùng bấm "Tôi đã chuyển", hỏi lại `/v1/me` (hoặc
  `billing.subscription`) mỗi 10–15 giây trong vài phút, và có thông báo `plan.activated`.
- Bấm "Mua" lại trong 24 giờ trả **cùng** mã — không lo sinh nhiều mã.
- Doanh nghiệp: `selfServe: false`, `prices` rỗng → hiện "Liên hệ để kích hoạt" (Zalo hỗ trợ).
  `createIntent` của doanh nghiệp / nông dân → `FORBIDDEN`.
- Chuyển thiếu hoặc gõ sai nội dung: gói **không** tự mở; người dùng liên hệ, quản trị viên mở tay.

**Hồ sơ**: `api.account.profile()`, `api.account.updateProfile({ name, username, recoveryEmail })`. Tên đăng nhập
giống số điện thoại (`0912345678`) → 422 ngay ở hợp đồng; tên đã có người dùng → `fields.username`; email khôi
phục tài khoản khác đang dùng → `fields.recoveryEmail` — mỗi định danh đăng nhập chỉ trỏ đúng một người.
Số điện thoại là khoá đăng nhập, không đổi ở đây. Mã giới thiệu của mình: `profile.referralCode`;
nhập mã của người mời (một lần): `api.account.claimReferral({ code })` → `{ claimed }` — `false`
thì báo chung "Mã không dùng được", không nói vì sao.

**Xoá tài khoản** (`api.account.delete()`) là xoá THẬT: ảnh, sổ, đơn, kết nối của tổ chức mình là
chủ duy nhất, hồ sơ, rồi tài khoản đăng nhập. Hỏi xác nhận hai lần, nêu hậu quả bằng số (bao nhiêu
phiếu). `ORG_HAS_MEMBERS` → "Gỡ nhân viên trước". Xong thì xoá sổ, hàng đợi, ảnh trong IndexedDB
và đăng xuất — máy có thể là máy mượn. Nhân viên xoá tài khoản chỉ rời tổ chức.

### 5.11 Ảnh chứng từ — BE8 (hợp đồng đã có, chưa phát hành)

Ảnh đi thẳng giữa app và Supabase Storage; API chỉ ký URL. App không cầm khoá Storage nào.

```ts
// Chụp: nén (JPEG, cạnh dài 1600px) → lưu IndexedDB với id = newId() → đặt id vào attachmentIds của phiếu.
// Hàng đợi ảnh (riêng với hàng đợi op sổ), khi có mạng:
await api.attachments.upload(id, blob);       // xin URL + PUT; 409 = đã lên từ lần trước → xong
// Xem trên máy khác:
const { url, expiresAt } = await api.attachments.url(id);  // hết hạn sau 10 phút → xin lại
```

- Ảnh lên trước hay sau op của phiếu đều được. Xem ảnh thì phiếu (hoặc nháp) nhắc tới id đó phải đã
  lên máy chủ; ảnh chưa lên → `NOT_FOUND` "Ảnh chưa lên máy chủ" — hiện ảnh trong máy nếu có, không
  thì ô xám "Ảnh ở máy khác, chưa có mạng".
- Sai loại (chỉ JPEG / PNG / WebP) hay quá 3MB → `VALIDATION_FAILED` ngay, chưa tốn mạng.
- Người cân chi nhánh A không xem được ảnh phiếu chi nhánh B — cùng phạm vi như sổ.
- Xoá tài khoản xoá cả thư mục ảnh của tổ chức (mục 5.10).

### 5.12 Đo lường — BE9 (hợp đồng đã có, chưa phát hành)

`track(name, props)` ghi vào hàng đợi riêng trong IndexedDB (giống hàng đợi op, nhưng mất thì thôi),
xả lô ≤ 50 qua `api.events.track({ events })` khi có mạng — kể cả lúc chưa đăng nhập.

```ts
track('receipt_created', { kind: 'purchase', lines: 2, offline: !navigator.onLine, fromOrder: Boolean(orderId) });
// mỗi sự kiện gửi đi: { anonId, at: new Date().toISOString(), platform: 'pwa', appVersion, name, props }
```

- `anonId`: chuỗi ngẫu nhiên sinh một lần, giữ trong máy. `at`: giờ trên máy lúc xảy ra.
- Danh mục và thuộc tính đúng `TrackedEvent` trong `@mambo/contracts` — kiểu TypeScript bắt lỗi
  lúc biên dịch. Thuộc tính lạ (số tiền, SĐT, tên) làm server **bỏ** sự kiện (`dropped`).
- KHÔNG gửi `plan_activated`, `order_fulfilled`, `link_accepted` — server tự bắn.
- Đã đăng nhập: SDK gửi kèm token + tổ chức (route có `optionalAuth`), server gắn tổ chức và
  `orgType` thật. Chưa đăng nhập: có thể gửi `orgType` nếu đã biết (sau bước "Bác là ai?").
- `dropped > 0` là lỗi của app (sai danh mục) — xoá khỏi hàng đợi, ghi Sentry, không gửi lại.

### 5.7 Đăng xuất

- Gọi `supabase.auth.signOut()`, rồi xoá tổ chức đang chọn, bản `/v1/me` đã lưu và mọi form
  đang điền.
- Hàng đợi còn thao tác chưa gửi thì cảnh báo trước khi đăng xuất. **Không** lặng lẽ xoá hàng đợi.
- Nếu phiên hết hạn (vẫn `UNAUTHENTICATED` sau khi đã thử làm mới token) thì về màn đăng
  nhập và **giữ** hàng đợi.

---

## 6. Ba vỏ giao diện

| Vỏ | `type` | Màn chính | Sổ offline | Gói |
|---|---|---|---|---|
| Nông dân | `farmer` | Trang chủ · Tạo đơn bán · Đơn của tôi · Tiền vựa còn nợ · Vựa đã kết nối · Tài khoản (≈ 6 màn) | ❌ cần mạng | Miễn phí — **không có màn Gói** |
| Thương lái / Vựa | `trader` | Sổ thu mua (phiếu cân, công nợ, kho suy từ phiếu, đối tác, giá, báo cáo, nhập Excel, xuất Excel/PDF) + Đơn + Kết nối | ✅ | 149.000đ/tháng · 1.490.000đ/năm, dùng thử 30 ngày |
| Doanh nghiệp | `enterprise` | Như vựa, thêm Nhân viên · Chi nhánh · Báo cáo tổng | ✅ (nhân viên chỉ thấy chi nhánh mình) | Theo số chi nhánh, kích hoạt tay |

- Đơn và kết nối **miễn phí cho mọi bên**, kể cả vựa đã hết gói.
- Nông dân chỉ thấy những gì in trên biên nhận của mình trong sổ vựa (cân, giá, tổng, các lần
  trả, còn nợ). Không thấy ghi chú nội bộ hay lợi nhuận của vựa.
- Giao diện responsive: ở màn 375px và 320px không được cuộn ngang. Cùng một code chạy cho
  PWA và TWA (bản lên CH Play).

---

## 7. Sổ offline và đồng bộ — BE3 (`v0.4.0`, đã nghiệm thu trên staging)

**Trạng thái:** phát hành trong `v0.4.0`, chạy trên staging, nghiệm thu hai máy đạt (28/09). Hợp
đồng ở `packages/contracts` (`sync.ts`, `sync-records.ts`, `sync-parse.ts`); mock: `npm run mock`.
Kiểu dữ liệu import từ `@mambo/contracts`, không tự khai. Ví dụ chạy được:
[`tools/login-test/sync.js`](../tools/login-test/sync.js).

**Mở sổ là đồng bộ ngay** (có mạng thì kéo về trước khi cho ghi): mặt hàng mặc định và phiếu của
máy khác nằm trên server — chưa kéo thì ô chọn mặt hàng trống (gặp đúng lỗi này khi nghiệm thu).

### 7.1 Ghi: luôn ghi cục bộ trước

Mỗi thao tác ghi sổ gồm hai việc: (1) sửa IndexedDB, rồi (2) thêm một op vào hàng đợi (cũng
nằm trong IndexedDB, không nằm trong bộ nhớ React). Giao diện không bao giờ đợi mạng.

```ts
import { parseSyncOp, type SyncOp } from '@mambo/contracts';

const op: SyncOp = {
  opId: newId(),       // id của THAO TÁC — chống gửi trùng
  seq: 42,             // tăng dần trên máy; KHÔNG BAO GIỜ đổi thứ tự
  entity: 'payment',   // supplier · buyer · product · pricingRule · note · draft · transaction · payment
  kind: 'insert',      // insert · update · softDelete
  recordId: newId(),   // id BẢN GHI — máy khách sinh, luôn là UUID
  data: { transactionId, date: new Date().toISOString(), amount: 500_000 },
};
// Bắt lỗi ngay ở máy, trước khi op vào hàng đợi:
const check = parseSyncOp(op); // { ok: true, op } | { ok: false, fields }
```

Luật của `data` (schema ở `sync-records.ts`):

- `insert` dùng `*Insert`; `update` dùng `*Patch` — vá một phần: chỉ trường gửi lên bị đổi,
  `null` là để trống, patch rỗng bị từ chối; `softDelete` **không có** `data`.
- **Không** gửi `organizationId`, `createdBy`, `createdAt`, `updatedAt`, `deletedAt` — server tự
  điền. Trường lạ bị từ chối.
- **Khách lẻ** là `counterpartyId: null`. Core dùng `'guest'` / `'guest-buyer'` — đổi ở `data/`
  khi gửi và khi nhận.
- **Phiếu (`transaction`)** không có `amountPaid`, không có `payments`: số đã trả luôn là tổng các
  `payment`. Mỗi dòng phải đã đóng băng bằng `freezeLineTotals` (có `rawTotal`,
  `roundedTotal`). Server tính lại bằng đúng hàm đó; lệch thì bị `VALIDATION_FAILED` chỉ đúng
  dòng (`data.lines.1.roundedTotal`). Phiếu đã chốt chỉ `update` được `attachmentIds` và
  `note`; sai cân, sai giá thì xoá phiếu, lập phiếu mới.
- **Lần trả (`payment`)** chỉ có `insert` và `softDelete`. Huỷ lần trả = `softDelete`.
- Thời gian là ISO 8601 có múi giờ (`toISOString()`); `'2026-09-28'` bị từ chối.
- **Id luôn là UUID.** Bốn mặt hàng mặc định của core (`prod-rubber`, `prod-cashew`…) **không**
  đồng bộ được. Server đã tạo sẵn bốn mặt hàng này cho mọi vựa và doanh nghiệp, id là UUID; lần
  kéo đầu tiên sẽ có chúng. Gộp theo **tên** như `normalize()` vẫn làm, rồi dùng id của server.
  Đừng đưa op có id `prod-…` vào hàng đợi: server trả `VALIDATION_FAILED` ở `recordId` và hàng
  đợi dừng ở đó.
- Sửa mặt hàng: chỉ gửi trường thực sự đổi. Lập phiếu kéo theo đổi giá gần nhất thì gửi riêng
  patch `{ lastPricePerUnit }` — người cân làm được. Gửi cả bản ghi thì cần `pricing:manage`, và
  người cân bị từ chối.
- Doanh nghiệp: phiếu và nháp có `branchId`. Người gắn với một chi nhánh để trống, server tự điền
  chi nhánh của họ; gửi chi nhánh khác → `FORBIDDEN`.
- Hàng đợi, cache, cursor đều **tách theo tổ chức**: ở máy, mỗi op lưu kèm `organizationId`.

### 7.2 Quyền của từng op

Route cần `book:sync`. Mỗi op cần thêm một quyền; `syncOpPermission(op)` trả đúng quyền đó.
Dùng nó cùng `membership.permissions` để ẩn nút.

| Op | Quyền | Người cân của vựa |
|---|---|:-:|
| Tạo phiếu, nháp; tạo người bán, người mua, mặt hàng mới; sửa **chỉ** giá gần nhất | `receipt:create` | ✅ |
| Ghi lần trả | `payment:record` | ✅ |
| Ghi chú | `book:sync` | ✅ |
| Xoá phiếu | `receipt:delete` | ❌ |
| Huỷ lần trả | `payment:void` | ❌ |
| Sửa, xoá người bán / người mua | `partner:manage` | ❌ |
| Sửa (không chỉ giá), xoá mặt hàng; mọi thao tác với quy tắc giá | `pricing:manage` | ❌ |

### 7.3 Đẩy lên: `sdk.sync.push({ deviceId, ops })`

- Tối đa `SYNC_PUSH_MAX_OPS` (200) op một lô, `seq` tăng dần, `opId` không trùng. Thân tối đa
  1MB: gặp `PAYLOAD_TOO_LARGE` thì chia nhỏ lô.
- `deviceId`: UUID sinh một lần cho mỗi máy, lưu cục bộ.
- `results` theo đúng thứ tự op, **dừng ở op `rejected` đầu tiên**. Op sau nó không có trong
  `results` và chưa được xử lý — giữ nguyên trong hàng đợi.

| Nhận được | App làm gì |
|---|---|
| `applied` | Xoá op khỏi hàng đợi |
| `duplicate` | Xoá op — server đã có (gửi lại vì mất phản hồi, bấm hai lần) |
| `applied` kèm `warning: 'RECORD_DELETED'` | Xoá op. Bản ghi (hoặc phiếu cha của lần trả) đã bị xoá ở máy khác — xoá thắng; lần trả vẫn được lưu. Báo nhẹ |
| `rejected`, `isRetryable(error.code)` đúng (`PARENT_MISSING`, `RATE_LIMITED`, `INTERNAL`) | Giữ op, thử lại theo lịch giãn cách (1 giây, 5 giây, 30 giây, 5 phút) |
| `rejected`, mã khác (`VALIDATION_FAILED`, `FORBIDDEN`) | Giữ op, đánh dấu `conflict`, cho người dùng xem. Op sau nó chờ |
| Cả request lỗi `402 PLAN_EXPIRED` | Dừng lượt, **giữ nguyên** hàng đợi, không tính lần thử; báo gói hết hạn |
| Lỗi mạng | Thử lại theo lịch giãn cách |

- `warning: 'ORDER_NOT_OPEN'` (từ BE5): đơn đã huỷ, không còn hay sai chiều; phiếu / nháp vẫn được ghi nhưng bị gỡ khỏi đơn.
- Nông dân gọi sync sẽ bị `403 FORBIDDEN` — đừng gọi.

### 7.4 Kéo về: `sdk.sync.pull({ cursor, limit })`

```jsonc
{ "cursor": "opaque", "hasMore": false, "resetRequired": false,
  "changes": { "suppliers": [], "buyers": [], "products": [], "pricingRules": [], "notes": [],
               "drafts": [], "transactions": [], "payments": [] } }
```

- `cursor` do server cấp. Lưu **theo tổ chức**, gửi lại nguyên văn; lần đầu để trống. Không tự
  đọc, không dùng giờ máy làm mốc.
- Gọi liên tục tới khi `hasMore: false`. `limit` 1–1000, mặc định 500, tính cộng mọi loại.
- Mỗi bản ghi có `id`, `createdBy`, `createdAt`, `updatedAt` (giờ server), `deletedAt`. Bản ghi
  đã xoá mềm vẫn về: `deletedAt` khác null thì xoá khỏi sổ cục bộ. Xoá thắng cập nhật đến sau.
- Hợp nhất theo `id`. Bản ghi còn op chưa gửi trong hàng đợi thì giữ bản cục bộ.
- **Phiếu kéo về không mang lần trả.** Đừng thay danh sách lần trả của phiếu bằng rỗng; hợp nhất
  `payments` theo id vào sổ đã có (như `unionPayments` của bản cũ).
- Server luôn trả phiếu cha **trước hoặc cùng trang** với lần trả của nó (bảng lần trả đi cuối).
  App vẫn nên giữ lần trả chưa thấy phiếu cha sang trang sau thay vì bỏ — lỗi thật của bản cũ là
  `if (!tx) continue`.
- Có thể nhận lại bản ghi đã nhận ở lượt trước: server kéo chồng lấn 15 giây để không sót thay
  đổi đang ghi dở. Hợp nhất theo id nên vô hại.
- `resetRequired: true` (khi đổi chi nhánh): **xả hết hàng đợi trước**, rồi xoá sổ cục bộ của tổ
  chức đó và kéo lại từ `cursor` vừa nhận. `changes` lúc này rỗng.
- Cursor hỏng hoặc của tổ chức khác → `422 VALIDATION_FAILED` (`details.fields.cursor`): bỏ
  cursor, kéo lại từ đầu.
- Người gắn chi nhánh chỉ nhận phiếu, nháp, lần trả của chi nhánh mình. Danh mục (người bán,
  người mua, mặt hàng, quy tắc giá, ghi chú) là chung của tổ chức.

### 7.5 Khi chưa đăng nhập

Kế hoạch giữ chế độ "tài khoản của máy này": chưa đăng nhập vẫn ghi sổ cục bộ được; đăng nhập
xong thì đẩy sổ của máy lên tài khoản qua `/sync/push`. Nếu bản mới bỏ chế độ này thì báo
backend để sửa kế hoạch.

### 7.6 Năm quy tắc chống mất tiền — phần việc của frontend

| # | Quy tắc | Frontend phải |
|---|---|---|
| 1 | `payments` là bảng riêng, chỉ ghi thêm | Số đã trả = tổng các payment; huỷ lần trả = `softDelete` |
| 2 | Gửi trùng id = `duplicate` | Sinh id **lúc tạo** bản ghi; khi thử lại thì gửi lại đúng `opId`/`recordId` đó |
| 3 | Xoá mềm thắng | Khi hợp nhất, bản ghi có `deletedAt` không bị một `update` đến sau "hồi sinh" |
| 4 | Xử lý theo `seq` | Không bao giờ đổi thứ tự hàng đợi; đẩy theo `seq` tăng dần |
| 5 | Không có payment mồ côi khi phân trang | Hợp nhất qua nhiều trang, không bỏ payment chưa thấy phiếu cha |

**Dựng lại giao diện, nhưng mang logic sổ sang.** Repo frontend cũ đã có hàng đợi (`queue.ts`,
`localDb.ts`), `mergeChanges` trong `pullChanges.ts` và `deviceAccount.ts`, kèm test, và đã
giữ đúng năm quy tắc này. Khi mang sang, đổi ba chỗ cho khớp hợp đồng mới: op dùng `entity`
số ít và `data` camelCase (không phải `table` + hàng snake_case); `softDelete` không mang
`data`, server tự đặt mốc xoá; kéo về theo `cursor` thay cho mốc giờ máy.

---

## 8. Lộ trình — mỗi bước frontend làm gì

Mỗi bước, hợp đồng (route + schema + mock) ra **trước** khi backend viết service, để frontend
làm song song trên mock. Endpoint của các bước chưa làm lấy từ kế hoạch
([§6](BE-backend-nestjs.md)); tên hàm SDK sẽ chốt khi hợp đồng ra.

| Bước | Backend mở ra | Frontend làm | Xong khi (nghiệm thu chung) |
|---|---|---|---|
| **BE0–BE2 ✅** | `v0.3.0`: `me`, `meBootstrap`, `resolveIdentifier`, `discoverLinks`, ma trận quyền, mã lỗi | Mục 2 và 5: cài gói, client, đăng ký, "Bác là ai?", đăng nhập một ô, chọn tổ chức, chọn vỏ, màn OTP (giao diện) | Đăng ký thật trên staging bằng cả ba loại tổ chức, đăng nhập lại trên máy khác |
| **BE3 ✅** | `v0.4.0`: `sync.push` · `sync.pull`, hình dạng 8 loại bản ghi, quyền từng op | Mục 7: sổ offline, hàng đợi, đẩy/kéo, cache theo tổ chức | Hai máy thật, một máy tắt mạng, ghi phiếu + trả nợ + huỷ lần trả → sau khi đồng bộ khớp từng đồng |
| **BE4 ✅** | `v0.5.0` (mục 5.6): `GET /v1/links` · `POST /v1/links/invite { partnerKind, partnerId }` (trả `inviteCode`) · `POST /v1/links/claim { code }` · `POST /v1/links/:id/revoke` · `GET /v1/linked/receipts?orgId=&cursor=&limit=` · `GET /v1/linked/balance`. OTP (`discover`, `accept`) tạm ẩn | Vỏ Nông dân phần xem (phiếu, còn nợ, vựa đã kết nối); ô "Nhập mã kết nối"; nút "Mời kết nối" hiện mã trên trang nông hộ của vựa. Không làm màn OTP | Vựa ghi phiếu có nợ → mời, đưa mã → nông dân đăng ký, nhập mã → thấy đúng phiếu, đúng số nợ; mã đã dùng / hết hạn → không nhập được; huỷ kết nối → mất quyền xem ngay |
| **BE5** 🟡 | Hợp đồng đã có (mục 5.8): `api.orders.*` (list/create/get/accept/reject/schedule/cancel, kèm `version`) · `api.notifications.list/read` · `orderId` trong op phiếu/nháp | Nông dân tạo đơn bán, xem lịch sử đơn; vựa xem danh sách đơn, hẹn lịch; ô "Theo đơn" ở màn Tạo phiếu; hỏi thông báo khi mở app và mỗi 60 giây | Nông dân tạo đơn → vựa nhận, hẹn lịch → vựa cân, lập phiếu theo đơn, trả một phần **lúc mất mạng** → có mạng → đơn tự hoàn thành → nông dân thấy phiếu và số còn nợ |
| **BE6** 🟡 | Hợp đồng đã có (mục 5.10): `api.account.*` (hồ sơ, mã giới thiệu, xoá tài khoản), `api.billing.*` (gói, chuyển khoản) | Màn Gói (chỉ chủ vựa/DN), trả tiền bằng chuyển khoản kèm mã đối soát (`@mambo/core/transferCode`); màn Tài khoản; xoá tài khoản | Một lần chuyển khoản thật gia hạn được gói |
| **BE7** 🟡 | Hợp đồng đã có (mục 5.9): `api.org.members.*`, `api.org.branches.*`, `api.reports.summary` | Vỏ Doanh nghiệp: nhân viên, chi nhánh, báo cáo tổng; `BRANCH_LIMIT` | DN hai chi nhánh: mỗi nhân viên chỉ thấy phiếu chi nhánh mình; owner thấy tổng khớp; tạo chi nhánh vượt gói → `BRANCH_LIMIT` |
| **BE8** 🟡 | Hợp đồng đã có (mục 5.11): `api.attachments.upload(id, blob)`, `api.attachments.url(id)` | Ảnh chụp lúc mất mạng xếp hàng; có mạng thì xin URL rồi `PUT` thẳng lên Storage; xem ảnh bằng URL có hạn | Ảnh chụp offline lên được khi có mạng; máy thứ hai xem được; URL hết hạn thì không mở được |
| **BE9** 🟡 | Hợp đồng đã có (mục 5.12): `api.events.track`, danh mục `TrackedEvent` | `track()` đi qua hàng đợi; Sentry cho web; sửa trang Quyền riêng tư cùng PR; TWA + CH Play thử nghiệm kín | Một vòng luồng BE5 trên staging → phễu có đủ sự kiện đúng thứ tự, tách được theo `orgType` |
| **BE10** | Production: URL, CORS, bật `features` cho nhóm pilot | Đổi env sang production; nộp bản CH Play | Pilot một tuần không có op `rejected` ngoài dự kiến |

Ghi chú từng bước:

- **BE5 — đơn:** id đơn do server sinh ⇒ tạo đơn cần mạng, đơn không nằm trong sổ offline.
  Trạng thái đơn:

  ```
  submitted ──accept──▶ accepted ──schedule──▶ scheduled ──(phiếu theo đơn đồng bộ lên)──▶ fulfilled
      └──reject/cancel──────┴────────cancel──────────┴──▶ cancelled
  ```

  - Frontend **không** gọi "hoàn thành": đơn tự chuyển sang `fulfilled` khi phiếu có
    `orderId` được đồng bộ lên.
  - Gặp `ORDER_STATE_CHANGED` thì tải lại đơn. Gặp `LINK_REQUIRED` thì báo: bản đầu chỉ gửi
    đơn được cho tổ chức đã kết nối.
- **BE6 — không có lệnh rút tiền.** Giữ tiền hộ rồi chi ra là làm trung gian thanh toán, cần
  giấy phép NHNN. Hết gói không giữ dữ liệu làm con tin: vẫn đọc và xuất file được.
- **BE9 — tên sự kiện** theo dạng `đối_tượng_hành_động`, tiếng Anh, `snake_case`, thì quá khứ
  (việc đã xong):
  - Danh mục của app (chính xác: `TrackedEvent` trong contracts, mục 5.12): `app_opened` ·
    `sign_up_completed` · `login_succeeded` · `login_failed` · `order_created` · `order_accepted` ·
    `order_scheduled` · `receipt_created` · `receipt_shared` · `debt_payment_recorded` ·
    `import_completed` · `quota_wall_shown` · `plans_viewed` · `checkout_started` · `member_invited` ·
    `contact_clicked` · `account_deleted`.
  - `plan_activated`, `order_fulfilled`, `link_accepted` do **server** bắn (BE9 chốt — đáng tin hơn).
  - Không gửi tên, số điện thoại, email hay số tiền cụ thể.
- **Sau BE10** (chưa làm, mỗi mục có điều kiện bật riêng): Realtime thay cho hỏi 60 giây ·
  thông báo đẩy/SMS/Zalo · giao hàng nhiều chặng · nhập/xuất kho tường minh · bản đồ và chợ mở ·
  Capacitor.

---

## 9. Làm khi API chưa xong

- **Mock:** ở repo BE chạy `npm run mock`. Prism dựng server giả từ `openapi.json` (mặc định
  `http://127.0.0.1:4010`). Trỏ `VITE_API_URL` vào đó. Mock chỉ có những route đã vào contracts.
- **Endpoint mới chỉ có trong kế hoạch:** viết hàm trong `src/data/` với đúng hình dạng ở mục
  7–8, tạm trả dữ liệu giả. Khi hợp đồng ra thì thay thân hàm bằng lời gọi SDK; màn hình không
  phải sửa.
- **Xem luồng chạy thật:** `npm run login-test` (mục 2.3) — tài khoản ở `/`, đồng bộ sổ ở
  `/sync.html?may=A`.

---

## 10. Luật phối hợp

- `packages/contracts` là nguồn sự thật duy nhất. Kiểu dữ liệu import từ `@mambo/contracts`
  (`Me`, `MeMembership`, `ErrorCode`, `Permission`, `OrgType`…), không tự khai lại.
- Cần endpoint hay trường mới: mở PR (hoặc issue) vào `packages/contracts` ở repo BE. PR vào
  `core` và `contracts` cần **cả hai người** duyệt.
- Muốn sửa hàm tính tiền: mở PR vào `packages/core` ở repo BE. Không vá một bản sao ở frontend,
  vì một hàm tính tiền phải cho ra đúng một con số ở cả trình duyệt lẫn server.
- Trong `/v1` chỉ **thêm**. Muốn bỏ hay đổi nghĩa thì thêm trường mới, đánh dấu trường cũ
  `deprecated` ít nhất một bản phát hành. Nhờ vậy nâng phiên bản gói không làm vỡ app.
- Mỗi thay đổi hợp đồng ghi một dòng vào [CHANGELOG](../packages/contracts/CHANGELOG.md), kèm
  sửa file này nếu frontend phải làm gì.
- Nhịp làm việc: 15 phút đầu tuần chốt hợp đồng của tuần; đổi giữa tuần thì qua PR.
- Nghiệm thu trên **staging**, không chỉ trên máy dev. Có loại lỗi chỉ lộ ra trên hạ tầng thật.

---

## 11. Không làm

| Không làm | Thay bằng | Vì sao |
|---|---|---|
| Tự dựng backend hay API trong repo frontend | NestJS ở repo BE | Hai backend = hai nguồn sự thật, dữ liệu không khớp |
| Viết `supabase/migrations/`, chạy `supabase db push` | Prisma Migrate ở repo BE | Schema do repo BE sở hữu; `supabase/migrations/` bên frontend đã đóng băng |
| `supabase.from(…)`, `supabase.rpc(…)` | `@mambo/sdk` | Data API đã tắt, client không có quyền trên bảng nào |
| `fetch` tay, tự viết `ApiError` | `@mambo/sdk` | SDK kiểm phản hồi theo hợp đồng, lỗi đúng kiểu |
| Tiền tố `/api/v1` | `/v1` | Theo `routes` |
| Header `X-Workspace-Id`, `Idempotency-Key`, header tự đặt | `X-Organization-Id`; chống trùng bằng `opId` trong thân sync | Header lạ bị CORS chặn |
| Lỗi dạng phẳng `{ code, message }` | `{ error: { code, message, details, requestId } }` | Định dạng lỗi duy nhất |
| Endpoint đồng bộ tự đặt (`/legacy/…`) | `/v1/sync/push`, `/v1/sync/pull` (BE3) | Theo kế hoạch §4 |
| Dùng giờ máy làm mốc đồng bộ | `cursor` do server cấp | Máy lệch giờ là mất thay đổi |
| Cột "đã trả", sửa số tiền lần trả | Cộng các `payment`; huỷ = `softDelete` | Quy tắc chống mất tiền số 1 |
| `DELETE` cứng | `softDelete` | Quy tắc số 3 |
| Tính tổng tiền bằng code riêng | `@mambo/core` | Server tính lại, lệch là bị từ chối |
| Đoán quyền theo tên vai trò | `membership.permissions` | Ma trận có thể mở thêm ô |
| Báo lỗi đăng nhập khác nhau cho từng trường hợp | Một câu chung | Không để ai dò được ai có tài khoản |
| Secret key / `service_role` trong frontend | Chỉ publishable key | Lộ khoá = lộ toàn bộ database |
| Gửi tên, số điện thoại, số tiền vào sự kiện đo lường | Chỉ tên sự kiện + thuộc tính không định danh | Trang Quyền riêng tư chỉ hứa những gì làm thật |
| Lệnh rút tiền | — | Cần giấy phép trung gian thanh toán |

---

## 12. Bảng kiểm trước khi merge một PR frontend có chạm mạng

- [ ] Gọi API qua `@mambo/sdk`; không có `fetch` tay, không có `supabase.from(` / `supabase.rpc(`
- [ ] Rẽ nhánh lỗi theo `err.code`; hiện `requestId` khi báo lỗi
- [ ] Ghi sổ: sửa IndexedDB trước, op vào hàng đợi, id sinh bằng `newId()`
- [ ] Tiền là số nguyên; tổng tính bằng `@mambo/core`
- [ ] Ẩn/hiện theo `permissions`, không theo tên vai trò
- [ ] Cache, hàng đợi, cursor khoá theo `organizationId`
- [ ] Ba gói `@mambo/*` cùng một phiên bản; đã đọc CHANGELOG khi nâng
- [ ] Không log hay gửi token, mật khẩu, số điện thoại đi đâu cả
- [ ] Đã chạy trên staging, không chỉ trên máy dev

---

## 13. Còn mở — có thể ảnh hưởng frontend

| Việc | Ảnh hưởng | Khi nào |
|---|---|---|
| Đăng nhập hộ `POST /v1/auth/login` thay cho `resolve-identifier` | Hàm `signIn` trong `data/` | Nhóm quyết |
| Nhà cung cấp SMS cho OTP | Màn OTP chạy thật | Khi > 100 tổ chức trả phí — chưa cần (kết nối bằng mã) |
| Tên miền `api.thumua365.vn` | `VITE_API_URL` | Khi có quyền DNS; tạm dùng `*.onrender.com` |
| Realtime cho đơn và thông báo | Bỏ hỏi 60 giây | Sau BE10 |

---

## 14. Tài liệu và hỏi ai

| Cần | Xem |
|---|---|
| Sản phẩm, ba vai trò, quyết định đã chốt | [THONG_TIN_DU_AN.md](THONG_TIN_DU_AN.md) |
| Hợp đồng chi tiết, schema, đồng bộ, từng bước | [BE-backend-nestjs.md](BE-backend-nestjs.md) |
| Sơ đồ kiến trúc v2 | [so-do-kien-truc-v2.html](so-do-kien-truc-v2.html) |
| Hợp đồng dạng code | [`packages/contracts/src/`](../packages/contracts/src) — nhất là `routes.ts` |
| Mỗi bản phát hành thêm gì | [CHANGELOG](../packages/contracts/CHANGELOG.md) · [Releases](https://github.com/remembered-fragrance/Thumua365_BE/releases) |
| Backend đã làm gì, vì sao | [MEMORY.md](../MEMORY.md) |
| Ví dụ chạy được | [`tools/login-test/app.js`](../tools/login-test/app.js) |

Hỏi về backend, hợp đồng, CORS, khoá staging: **Tài**.

Bản sao tài liệu backend nằm trong repo frontend (`deploy_plan/BE-backend-nestjs.md`,
`THONG_TIN_DU_AN.md`…) là **bản cũ ngày 21/09**. Luôn đọc bản ở repo này.
