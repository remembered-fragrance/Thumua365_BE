-- ═══════════════════════════════════════════════════════════════════════════
-- Gói Pro Đợt 2 — hình thức trả (V13) và thưởng giới thiệu
--
-- Chỉ thêm cột cho phép NULL: hàng cũ giữ nguyên, app bản cũ không gửi các cột này và bỏ qua khi đọc.
-- ═══════════════════════════════════════════════════════════════════════════

-- V13: lần trả bằng tiền mặt hay chuyển khoản. NULL = app cũ / không ghi (coi như tiền mặt khi nhắc).
alter table payments add column method text;
alter table payments add constraint payments_method_check check (method in ('cash', 'transfer'));

-- Thưởng giới thiệu: đánh dấu đã cộng 1 tháng cho người được giới thiệu và người mời (chỉ một lần).
alter table subscriptions add column referral_rewarded_at timestamptz;

-- V6: màn Nhật ký phân trang theo cursor (created_at, id) như đơn, thông báo (`common/page-cursor`). Cursor
-- mang độ chính xác của JS Date (mili giây); để micro giây thì các dòng ghi trong CÙNG transaction (cùng
-- now()) không so được với cursor và bị bỏ sót khi sang trang. Làm tròn về mili giây như các bảng kia.
alter table audit_log alter column created_at type timestamptz(3);
