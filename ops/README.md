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
