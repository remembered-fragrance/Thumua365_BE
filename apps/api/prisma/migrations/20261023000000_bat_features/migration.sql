-- ═══════════════════════════════════════════════════════════════════════════
-- Bật cờ tính năng cho mọi tổ chức đang có
--
-- `organization_features` chưa từng được ghi: /v1/me trả `features: []` cho mọi tổ chức, không khớp
-- hợp đồng (docs/FRONTEND.md §5.3). Từ bản này bootstrap ghi sẵn `orders` + `links` cho tổ chức
-- mới; ở đây bù cho tổ chức tạo trước đó. Tổ chức đã xoá mềm bỏ qua. Chạy lại không sinh trùng.
--
-- Không đổi bảng (schema.prisma giữ nguyên).
-- ═══════════════════════════════════════════════════════════════════════════

insert into organization_features (organization_id, feature)
select o.id, f.feature
from organizations o
cross join (values ('orders'), ('links')) as f(feature)
where o.deleted_at is null
on conflict (organization_id, feature) do nothing;
