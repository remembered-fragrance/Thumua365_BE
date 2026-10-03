# Lên production — bảng kiểm (BE10)

Code của BE0–BE9 đã xong và có test trên Postgres thật. Còn lại là việc **cần tài khoản / quyết
định của nhóm** — làm đúng thứ tự dưới đây; mỗi dòng xong thì đánh dấu và ghi ngày vào `MEMORY.md`.
Không mở cho người dùng thật trước khi xong **mục 4 (backup đã thử phục hồi)**.

## 0. Quyết định còn chờ nhóm

| Việc | Ai | Chặn |
|---|---|---|
| Số tài khoản nhận tiền + người chịu trách nhiệm pháp lý | Nguyên, Linh | Thu tiền (mục 5) |
| Nhà cung cấp SMS cho OTP (Twilio/Vonage, hoặc eSMS/SpeedSMS qua Send SMS Hook) | nhóm | Kết nối nông dân (mục 3) |
| Nhà cung cấp email (Resend / SES / SMTP) | nhóm | Thông báo email (BE5) — không chặn pilot |
| Kho backup khác Supabase: Cloudflare R2 hay Backblaze B2 | nhóm | Mục 4 |
| Vựa có được nhiều chi nhánh với giá 149.000đ? Mua lúc dùng thử có cộng dồn ngày còn lại? | nhóm | Không chặn — đang theo mặc định |
| `resolve-identifier` lộ email đăng nhập khi gõ đúng tên tài khoản → `POST /v1/auth/login`? | nhóm | Không chặn |
| Quyền DNS `thumua365.vn` (`api.`, `app.`) | nhóm | Không chặn — tạm `*.onrender.com` |

## 1. Repo và CI

- [ ] Đẩy monorepo lên GitHub (`gh auth login` → `gh repo create`), bật CI; ba job `verify`, `db`,
      `docker` xanh trên `master`.
- [ ] Lưu trữ (archive) hai repo cũ `Thumua365_BE`, `mambo365_deploymentphase`.

## 2. Staging (Render + Supabase `thumua365-staging`)

- [ ] Nối lại Render Blueprint vào repo mới (service `thumua365-api-staging`).
- [ ] `prisma migrate deploy` lên staging — 4 migration mới (BE4, BE5, BE7, BE6). Chạy TRƯỚC khi
      merge/deploy code mới (migration chỉ thêm, image cũ vẫn chạy).
- [ ] Đặt mật khẩu role `api_privileged` (như `npm run db:role-password -w @mambo/api` làm cho
      `api_service`), điền `PRIVILEGED_DATABASE_URL` (user `api_privileged.<ref>`, cổng 6543).
- [ ] Render env: `BANK_WEBHOOK_SECRET` (≥ 24 ký tự ngẫu nhiên), `ADMIN_USER_IDS` (id tài khoản của
      người quản trị), `CORS_ORIGINS` thêm domain preview của app web.
- [ ] Supabase Storage: bucket `attachments` **riêng tư**, giới hạn 3MB, chỉ
      `image/jpeg,image/png,image/webp`, **không** policy nào cho `anon` / `authenticated`.
- [ ] Nghiệm thu bằng `npm run login-test`: đăng ký 3 loại tổ chức, đồng bộ hai máy, đơn → phiếu theo
      đơn → hoàn thành, nhân viên / chi nhánh, ảnh, chuyển khoản thử (mục 5 trên staging).

## 3. OTP (BE4)

- [ ] Supabase → Authentication → Phone: bật provider, nhà cung cấp SMS đã chọn, giới hạn gửi OTP.
- [ ] Thử: nông dân xác thực số thật → dò → đồng ý → thấy phiếu và công nợ; huỷ → mất quyền ngay.

## 4. Backup — điều kiện bắt buộc trước người dùng thật

- [ ] Tạo bucket ở R2 / B2 (nhà cung cấp KHÁC Supabase), khoá truy cập chỉ ghi / đọc bucket đó.
- [ ] GitHub secrets: `BACKUP_DATABASE_URL` (role postgres của **production**, Session pooler 5432),
      `BACKUP_PASSPHRASE` (≥ 32 ký tự — **cất thêm một bản ngoài GitHub**), `BACKUP_S3_BUCKET`,
      `BACKUP_S3_ENDPOINT`, `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY`.
- [ ] Chạy tay workflow **Backup** với "thử phục hồi" → job `restore-check` xanh (phục hồi vào Postgres
      trống, số dòng khớp lúc dump). Ghi ngày + người thử vào MEMORY.
- [ ] Đã thử ở máy dev ngày 03/10/2026 (`ops/backup/`, container Postgres 17): 1 tổ chức · 25 phiếu ·
      25 lần trả · 2 dòng sổ đối soát — phục hồi khớp; sai khoá → `pg_restore` từ chối.

## 5. Thu tiền (BE6)

- [ ] Điền số tài khoản thật vào config của app web (`BANK_BIN`, `BANK_ACCOUNT_NUMBER`,
      `BANK_ACCOUNT_NAME`, `BANK_NAME`); tự quét thử mã QR bằng app ngân hàng.
- [ ] Casso / SePay: webhook `https://<api>/v1/webhooks/bank`, bí mật = `BANK_WEBHOOK_SECRET`
      (Casso: header `secure-token`; SePay: `Authorization: Apikey …`).
- [ ] VAN_HANH §7.3 trên production: một lần chuyển khoản thật mở gói; gọi lại webhook → không cộng
      thêm; một lần hoàn tiền thật.
- [ ] Sau đó: gỡ Edge Function `payment-webhook` cũ khỏi project Supabase cũ (nếu còn).

## 6. Production (Render `thumua365-api`, Supabase `thumua365-prod`)

- [ ] Supabase prod: **tắt "Confirm email"** (người đăng ký bằng số dùng email nội bộ, không nhận thư),
      bật Phone provider, bucket `attachments` như staging, Data API vẫn tắt.
- [ ] `prisma migrate deploy` lên prod; đặt mật khẩu `api_service`, `api_privileged`.
- [ ] Render: tạo service `thumua365-api` từ `render.yaml` (gói starter, deploy TAY). API **không
      lên** nếu thiếu `PRIVILEGED_DATABASE_URL`, `BANK_WEBHOOK_SECRET`, `METRICS_TOKEN`, hay
      `CORS_ORIGINS` có `localhost` / `http://` — đó là cố ý.
- [ ] Deploy đúng commit đã chạy trên staging. `/v1/health` trả `env: production`, đúng `commit`.
- [ ] `npm run security:check` xanh (CI làm sẵn); `service_role` / khoá secret chỉ có trong env Render.
- [ ] Sentry: `SENTRY_DSN` cho API (và web).
- [ ] Grafana Cloud: scrape `/metrics` bằng `METRICS_TOKEN`, import `ops/grafana/thumua365-api.json`.
- [ ] Bật cho nhóm pilot; theo dõi một tuần: **không có op `rejected` ngoài dự kiến**
      (`sync_push_rejected_total`), p95 ≤ 300ms.

## 7. Frontend (apps/web) — chạy song song từ mục 2

Hợp đồng đủ cho mọi màn ở `docs/FRONTEND.md` §5–§7 (mục 5.8–5.12 là BE5–BE9). Thứ tự gợi ý: "Bác là
ai?" + chọn tổ chức + OTP → vỏ Nông dân (kết nối, phiếu, công nợ, đơn) → đơn + thông báo cho vựa →
Gói + chuyển khoản → vỏ Doanh nghiệp → ảnh → đo lường + trang Quyền riêng tư → TWA lên CH Play.
