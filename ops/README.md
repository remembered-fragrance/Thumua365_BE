# Vận hành — giám sát API (BE9)

## Prometheus đọc `/metrics`

API mở `GET /metrics` (ngoài `/v1`) **chỉ khi** có biến `METRICS_TOKEN` (≥ 24 ký tự) và người gọi gửi
`Authorization: Bearer <METRICS_TOKEN>`; thiếu hay sai → 404. Cấu hình scrape (Prometheus / Grafana
Alloy / Grafana Cloud):

```yaml
scrape_configs:
  - job_name: thumua365-api
    scheme: https
    metrics_path: /metrics
    scrape_interval: 60s
    authorization:
      type: Bearer
      credentials: <METRICS_TOKEN>
    static_configs:
      - targets: ['thumua365-api-staging.onrender.com']
```

Render gói free ngủ sau ~15 phút không có request: scrape 60 giây giữ nó thức — chỉ bật cho
production (gói trả phí), không bật cho staging.

## Gói free ↔ gói trả phí

App web đang chạy trên API staging gói **free**. Hai việc bù cho chuyện API ngủ, mỗi việc có một công
tắc — nâng cấp chỉ là gạt công tắc, không sửa code:

| Ở đâu | Việc | Công tắc |
|---|---|---|
| Repo BE — `.github/workflows/keep-warm.yml` | Gọi `/v1/health` mỗi 5 phút để API không ngủ | Biến Actions `KEEP_WARM` (`off` = tắt), `KEEP_WARM_URL` (URL khác) |
| Repo FE — `src/data/client.ts` (`warmUpApi`) | Mở app là gọi `/v1/health` để đánh thức API sớm | Biến Vercel `VITE_API_WARMUP` (`off` = tắt) |

Bỏ qua công tắc nào cũng không hỏng gì: ở gói trả phí hai việc trên chỉ tốn vài request thừa.
Phần app tự nhớ `/v1/me` để mở ngay (FE `src/data/meCache.ts`) có ích ở mọi gói — không có công tắc.

**Lên gói trả phí (Render Starter, ~7 USD/tháng, không ngủ):**

1. Render → service `thumua365-api-staging` → Settings → Instance Type → **Starter**. Sửa luôn
   `plan: free` → `plan: starter` trong `render.yaml` để Blueprint không kéo về free.
   (Hoặc dựng service production riêng theo [`PRODUCTION.md`](PRODUCTION.md) rồi đổi `VITE_API_URL`
   của Vercel sang URL mới.)
2. GitHub repo BE → Settings → Secrets and variables → Actions → Variables → thêm `KEEP_WARM` = `off`.
3. Vercel → Settings → Environment Variables (Production) → thêm `VITE_API_WARMUP` = `off` → Redeploy.

**Quay về free:** làm ngược lại — xoá hai biến, đổi Instance Type về Free.

Lịch của GitHub Actions có thể trễ, và tự tắt khi repo 60 ngày không có commit. Muốn chắc hơn mà vẫn
free: thêm một monitor HTTP 5 phút ở UptimeRobot hoặc cron-job.org trỏ vào `/v1/health` (chạy song
song với workflow cũng được).

## Số đo

| Tên | Nghĩa |
|---|---|
| `http_request_duration_seconds{method,route,status}` | Thời gian phản hồi; `route` là mẫu (`/v1/orders/:id`), `status` là nhóm (`2xx`…) |
| `sync_push_ops_total{status}` | Op đồng bộ: `applied` · `duplicate` · `rejected` |
| `sync_push_rejected_total{code}` | Op bị từ chối theo mã lỗi — pilot: không có op `rejected` ngoài dự kiến (BE10) |
| `sync_push_batch_size` | Số op mỗi lô |
| `notification_failures_total{kind}` | Listener thông báo / đo lường hỏng (việc chính vẫn xong) |
| `analytics_events_total{result}` | Sự kiện đo lường nhận / bỏ |
| `process_*`, `nodejs_*` | Mặc định của prom-client |

## Dashboard

`grafana/thumua365-api.json` — Grafana → Dashboards → Import → chọn nguồn Prometheus. Ngưỡng p95
300ms vẽ sẵn (một trong "ba số phải giữ trong tầm" của MEMORY).

## Phễu đo lường

`GET /v1/admin/funnel?from=&to=` (quản trị viên) — mỗi (loại tổ chức, sự kiện) một dòng, theo thứ
tự xảy ra lần đầu. Dữ liệu ở bảng `analytics_events` (Postgres), chỉ `api_privileged` đọc được.

## Backup (BE10)

`ops/backup/backup.sh` — `pg_dump` schema `public` (+ dữ liệu `auth.users`, `auth.identities` trên
Supabase), mã hoá AES-256 trước khi rời máy, lên kho S3-compatible khác Supabase, giữ 30 ngày.
`ops/backup/restore-check.sh` — phục hồi vào database trống, so số dòng với lúc dump. Workflow
`.github/workflows/backup.yml`: sao lưu 02:00 mỗi ngày, thử phục hồi mỗi Chủ nhật (hoặc chạy tay).

Thử trọn vòng ở máy dev (cùng bước CI chạy sau `test:db`): sao lưu Postgres của docker compose rồi phục
hồi vào một cluster Postgres **mới tinh** — chưa có role nào của ta, như lúc dựng lại ở nơi khác. Công cụ
(`pg_dump` 17, `openssl`) chạy trong image postgis, máy không cần cài:

```bash
npm run db:up && bash ops/backup/roundtrip-check.sh
```

Đừng thử bằng cách phục hồi vào chính cluster vừa dump: role (`api_service`…) là của cả cluster, có sẵn
ở đó nên che mất lỗi "role does not exist" — `restore-check.sh` giờ tự tạo các role đó trước khi phục hồi.

Phục hồi vào một project Supabase MỚI: tạo project → chạy phần A của migration đầu tiên (role
`api_service`, `api_privileged`, extension) → `pg_restore` bản `public` (gồm cả `_prisma_migrations`) →
`pg_restore --data-only` bản `auth` → đặt lại mật khẩu role → trỏ API vào project mới.

Bảng kiểm lên production: [`PRODUCTION.md`](PRODUCTION.md).
