-- ═══════════════════════════════════════════════════════════════════════════
-- Gói Pro Đợt 1b — giá theo chất lượng (V19) và mủ tạp theo DRC (V20)
--
-- Chỉ thêm cột cho phép NULL: hàng cũ giữ nguyên, app bản cũ không gửi các cột này và bỏ qua khi đọc.
-- Chỉ tiêu chất lượng trên dòng phiếu (dung trọng, ẩm, tạp chất, KOR, loại mủ) nằm trong `lines` (JSONB)
-- nên không cần cột.
-- ═══════════════════════════════════════════════════════════════════════════

-- V20: mặt hàng mủ — mủ nước (độ TSC) hay mủ tạp (DRC). NULL = mủ nước như trước.
alter table products add column rubber_kind text;
alter table products add constraint products_rubber_kind_check
  check (rubber_kind in ('latex', 'cuplump'));

-- V19: quy tắc theo chỉ tiêu. Có `quality_metric` thì tiền tính theo bảng mốc `quality_steps`
-- ([{ from, amountPerUnit }], tăng dần theo from), bỏ qua fixed_amount / percent_of_total.
alter table pricing_rules add column quality_metric text;
alter table pricing_rules add column quality_steps jsonb;
alter table pricing_rules add constraint pricing_rules_quality_metric_check
  check (quality_metric in ('bulkDensity', 'moisturePercent', 'impurityPercent', 'kor', 'qualityPercent'));
-- Như drafts_adjustments_check: phải là mảng, tối đa 20 mốc (PRICING_RULE_LIMITS ở contracts).
alter table pricing_rules add constraint pricing_rules_quality_steps_check
  check (
    quality_steps is null
    or case when jsonb_typeof(quality_steps) = 'array' then jsonb_array_length(quality_steps) <= 20 else false end
  );
