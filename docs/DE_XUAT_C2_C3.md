# Đề xuất C2, C3 — CẦN CHỦ DỰ ÁN DUYỆT

Hai lỗi này đụng tới cách bán gói và cách đăng nhập, nên chưa sửa. Mỗi mục có hiện trạng, các phương án, phương án đề xuất và việc phải làm nếu duyệt. Ghi ngày 19/10/2026, đợt 2 (v0.20.0).

---

## C2. Gói doanh nghiệp không ép giới hạn chi nhánh cho chi nhánh đã có

### Hiện trạng

- Lúc dùng thử, `subscriptions.branch_limit = null`, tức là không giới hạn. Doanh nghiệp tạo bao nhiêu chi nhánh cũng được.
- Kích hoạt gói trả tiền (`AdminService.activatePlan`, webhook ngân hàng) ghi `branchLimit` mới mà không so với số chi nhánh đang dùng.
- `assertRoom` (`apps/api/src/org/branches.service.ts`) chỉ kiểm lúc **tạo mới** hoặc **mở lại** chi nhánh. Doanh nghiệp tạo 10 chi nhánh lúc dùng thử rồi mua gói 3 chi nhánh vẫn dùng đủ 10 chi nhánh mãi.
- `GET /v1/org/branches` đã trả `limit` và `used`, nên app hiện được "10/3" nếu muốn.

### Các phương án

| | Cách làm | Được | Mất |
|---|---|---|---|
| A | Chặn kích hoạt khi `used > branchLimit` (422 `BRANCH_LIMIT`) | Dữ liệu luôn đúng gói | Khách đã chuyển tiền mà không kích hoạt được. Người duyệt phải gọi khách lưu trữ bớt, rồi kích hoạt lại. Webhook ngân hàng tự kích hoạt thì không có ai để gọi. |
| B | Kích hoạt vẫn chạy. Chi nhánh vượt gói bị **khoá ghi**: đọc được, không lập phiếu mới, cho tới khi chủ lưu trữ bớt hoặc nâng gói | Tiền vào là kích hoạt, không kẹt webhook. Có lý do rõ để nâng gói. | Phải chọn chi nhánh nào bị khoá. Nhân viên ở chi nhánh bị khoá không làm được việc ngay hôm đó. Code lớn: guard sync, FE hiện trạng thái khoá. |
| C | Kích hoạt vẫn chạy, chỉ **cảnh báo**: banner "Đang dùng 10/3 chi nhánh" cho chủ, và không cho tạo hoặc mở lại chi nhánh nào tới khi về dưới giới hạn | Gần như không gây gián đoạn, code nhỏ (FE đọc `limit`/`used` sẵn có) | Không ép được gì: khách dùng mãi số chi nhánh lúc dùng thử. |

### Đề xuất

**C trước, B sau nếu cần.**

1. Đợt này: phương án C. `assertRoom` đã chặn tạo mới khi vượt. Thêm banner cho chủ, thêm `overLimit` vào `/v1/org/branches` (hoặc FE tự so `used > limit`). Ghi `branch.over_limit` vào nhật ký lúc kích hoạt để đội kinh doanh liên hệ.
2. Theo dõi một hai tháng. Nếu khách thật sự giữ nhiều chi nhánh mà không nâng gói thì làm B. Quy tắc chọn chi nhánh bị khoá: chi nhánh tạo **sau cùng** bị khoá trước. Không dùng A, vì A làm kẹt luồng tự kích hoạt từ ngân hàng.

### Nếu duyệt C

- BE: `activatePlan` đếm chi nhánh đang dùng, ghi audit `branch.over_limit` khi vượt. Không đổi contract (FE dùng `limit`/`used` sẵn có).
- FE: `BranchesPage` và trang chủ của chủ doanh nghiệp hiện banner khi `used > limit`.
- Test DB: kích hoạt gói 3 chi nhánh khi đang có 5 vẫn thành công, có audit, và `POST /v1/org/branches` nhận `BRANCH_LIMIT`.

---

## C3. `/v1/auth/resolve-identifier` để lộ số điện thoại và cho dò tài khoản

### Hiện trạng

- Luồng đăng nhập hiện tại có hai bước:
  1. App gửi SĐT, tên đăng nhập hoặc email khôi phục tới `POST /v1/auth/resolve-identifier` (`apps/api/src/auth/auth.controller.ts`, hàm `resolve`).
  2. API trả email đăng nhập nội bộ `84…@id.thumua365.vn`. App dùng email đó gọi `signInWithPassword` của Supabase.
- Hai chỗ rò rỉ:
  - **Lộ SĐT.** Gõ tên đăng nhập hoặc email khôi phục của người khác thì nhận về `84xxxxxxxxx@id…`, tức là chính SĐT của họ.
  - **Dò được tài khoản có tồn tại không.** Từ 0.16.0, tên đăng nhập không có thật trả email mồi (HMAC, cùng hình dạng), nên tên đăng nhập không dò được nữa. Nhưng email khôi phục không có thật thì API trả **nguyên email đó**, còn email có thật thì trả `84…@id`. So hai kiểu trả về là biết email đó có tài khoản hay không.
- Từ 0.20.0 (C4), chỉ email **đã xác nhận** mới tra ra tài khoản, nên chỉ chủ email mới khai được. Nhưng ai biết email người khác vẫn tra ra được SĐT của họ.

### Đề xuất (theo hướng dẫn): đăng nhập qua API

`POST /v1/auth/login { identifier, password }`:

1. API tra `find_login_user(identifier)` như hiện nay. Nếu không ra tài khoản thì vẫn chạy bước 2 với email mồi, để thời gian phản hồi như nhau.
2. API gọi password grant của Supabase (`POST {SUPABASE_URL}/auth/v1/token?grant_type=password`, dùng khoá publishable) bằng email nội bộ và mật khẩu.
3. Thành công thì trả `{ access_token, refresh_token, expires_in }`. App gọi `supabase.auth.setSession(...)`, nên mọi thứ sau đó (tự làm mới phiên, RLS) giữ nguyên.
4. Sai mật khẩu, không có tài khoản, hoặc bị khoá đều trả một câu lỗi chung `INVALID_CREDENTIALS` ("Sai thông tin đăng nhập hoặc mật khẩu"). App không bao giờ thấy email nội bộ.

**Giữ nguyên:**
- Hạn mức hiện có của `resolve-identifier`, áp sang `login` theo IP và theo định danh.
- Câu lỗi chung.
- Email mồi để thời gian phản hồi giống nhau.

**Gỡ:** `resolve-identifier` để thêm một bản phát hành cho app cũ còn chạy, rồi bỏ. Trong thời gian đó, cho nó luôn trả email mồi với mọi email khôi phục. App cũ đăng nhập bằng email khôi phục sẽ hỏng, nên phải ép cập nhật trước khi bỏ.

**Đổi ở FE (`src/data/auth.ts`):** `signIn` gọi `api.auth.login` rồi `supabase.auth.setSession`. Đăng ký (`signUp`) không đổi, vì đã dùng SĐT của chính người đăng ký.

### Rủi ro cần chủ dự án cân nhắc

- **Mật khẩu đi qua API của mình** chứ không đi thẳng tới Supabase. API không được ghi log body của route này (thêm vào danh sách che log). Nếu lộ log Render thì lộ mật khẩu.
- **Supabase tính hạn mức đăng nhập theo IP.** Mọi lần đăng nhập giờ đến từ IP của Render, nên một người dò mật khẩu có thể làm cả hệ thống chạm hạn mức của Supabase. Hạn mức của API phải chặt hơn hạn mức của Supabase. Cần kiểm cấu hình rate limit Auth của dự án Supabase trước khi làm.
- Render bản miễn phí ngủ khoảng 22 giây, nên lần đăng nhập đầu sau khi ngủ sẽ chậm như các lời gọi API khác. Luồng cũ cũng gọi `resolve-identifier` nên không chậm hơn.

### Nếu duyệt

- Contracts: `routes.authLogin`, `AuthLoginInput`, `AuthLoginResult`, mã lỗi `INVALID_CREDENTIALS`.
- API: `AuthController.login`, che log body, hạn mức.
- Test e2e:
  - sai mật khẩu và không có tài khoản trả cùng một lỗi;
  - không response nào chứa `@id.thumua365.vn`;
  - hạn mức hoạt động.
- FE: đổi `signIn`, giữ câu lỗi hiện tại.
