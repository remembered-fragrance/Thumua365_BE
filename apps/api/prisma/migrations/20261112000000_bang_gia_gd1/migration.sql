-- 0.30.0 — bảng giá Giai đoạn 1 (duyệt 10/11/2026): gói Thương lái có kỳ trả trước 6 tháng.
-- Chỉ nới ràng buộc → API 0.29.0 chạy được trên nó. Kỳ người cân (subscriptions.billing_months) giữ 1 | 12:
-- 6 tháng Thương lái ghi là 1 (đơn giá ngày người cân chỉ dùng cho gói Vựa).
alter table payment_intents drop constraint payment_intents_months_check;
alter table payment_intents add constraint payment_intents_months_check check (months in (1, 6, 12));
