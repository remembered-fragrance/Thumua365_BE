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
300ms vẽ sẵn (một trong "bốn số phải giữ trong tầm" của MEMORY).

## Phễu đo lường

`GET /v1/admin/funnel?from=&to=` (quản trị viên) — mỗi (loại tổ chức, sự kiện) một dòng, theo thứ
tự xảy ra lần đầu. Dữ liệu ở bảng `analytics_events` (Postgres), chỉ `api_privileged` đọc được.

## Backup (BE10)

`ops/backup/backup.sh` — `pg_dump` schema `public` (+ dữ liệu `auth.users`, `auth.identities` trên
Supabase), mã hoá AES-256 trước khi rời máy, lên kho S3-compatible khác Supabase, giữ 30 ngày.
`ops/backup/restore-check.sh` — phục hồi vào database trống, so số dòng với lúc dump. Workflow
`.github/workflows/backup.yml`: sao lưu 02:00 mỗi ngày, thử phục hồi mỗi Chủ nhật (hoặc chạy tay).

Thử ở máy dev (container Postgres của docker compose có sẵn `pg_dump` 17 và `openssl`):

```bash
docker cp ops/backup/backup.sh thumua365-db-1:/tmp/ && docker cp ops/backup/restore-check.sh thumua365-db-1:/tmp/
docker exec -e BACKUP_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/thumua365 \
  -e BACKUP_PASSPHRASE=<≥32 ký tự> -e BACKUP_OUT_DIR=/tmp/bk thumua365-db-1 bash /tmp/backup.sh
docker exec -e BACKUP_PASSPHRASE=<như trên> -e RESTORE_ADMIN_URL=postgresql://postgres:postgres@localhost:5432/postgres \
  thumua365-db-1 bash /tmp/restore-check.sh /tmp/bk <STAMP>
```

Phục hồi vào một project Supabase MỚI: tạo project → chạy phần A của migration đầu tiên (role
`api_service`, `api_privileged`, extension) → `pg_restore` bản `public` (gồm cả `_prisma_migrations`) →
`pg_restore --data-only` bản `auth` → đặt lại mật khẩu role → trỏ API vào project mới.

Bảng kiểm lên production: [`PRODUCTION.md`](PRODUCTION.md).
