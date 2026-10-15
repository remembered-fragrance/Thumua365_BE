-- ═══════════════════════════════════════════════════════════════════════════
-- Bản đồ thu mua — mang sang từ LiveMap
--
-- Vựa / thương lái và doanh nghiệp tự đặt địa điểm của mình; MỌI người đã đăng nhập (cả nông dân)
-- đều xem được. Vị trí của người dùng không lưu ở đâu cả — chỉ địa điểm tổ chức chủ động đặt.
--
--   A. (Prisma sinh, `prisma migrate diff`) bảng, khoá, index — khớp schema.prisma.
--      Sửa tay đúng một chỗ: places.location thành cột generated.
--   B. (viết tay) index GiST, CHECK, trigger, quyền, RLS, hàm security definer
--
-- Cột organizations.location / branches.location (0001) vẫn để trống — chưa dùng.
-- ═══════════════════════════════════════════════════════════════════════════

-- PostGIS ở schema `extensions` (0001 §A) — tên kiểu và hàm bên dưới cần thấy nó.
set search_path to "$user", public, extensions;

-- ─── A. Bảng (Prisma sinh) ──────────────────────────────────────────────────

-- CreateTable
-- (sửa tay) "location" là cột generated từ (lng, lat): Prisma không ghi được cột Unsupported, và
-- toạ độ chỉ có một nguồn sự thật là lat/lng.
CREATE TABLE "places" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "created_by" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "phone" TEXT,
    "description" TEXT,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "location" geography(Point, 4326)
      GENERATED ALWAYS AS (extensions.st_setsrid(extensions.st_makepoint("lng", "lat"), 4326)::extensions.geography) STORED,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "places_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "places_organization_id_updated_at_idx" ON "places"("organization_id", "updated_at" DESC);

-- AddForeignKey
ALTER TABLE "places" ADD CONSTRAINT "places_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── B. Viết tay ────────────────────────────────────────────────────────────

-- ─── B1. Index không gian ───────────────────────────────────────────────────
-- Một phần: chỉ điểm còn hiện — bản đồ không bao giờ hỏi điểm đã gỡ.
create index places_location_live on places using gist (location) where deleted_at is null;

-- ─── B2. CHECK ──────────────────────────────────────────────────────────────
-- Khung toạ độ = VN_BOUNDS của @mambo/contracts (gồm Hoàng Sa, Trường Sa). Độ dài = PlaceInput.
alter table places
  add constraint places_kind_valid check (kind in ('trader', 'enterprise')),
  add constraint places_name_len check (char_length(name) between 1 and 120),
  add constraint places_address_len check (address is null or char_length(address) <= 255),
  add constraint places_phone_len check (phone is null or char_length(phone) <= 20),
  add constraint places_description_len check (description is null or char_length(description) <= 1000),
  add constraint places_lat_vn check (lat between 7 and 24),
  add constraint places_lng_vn check (lng between 102 and 118);

-- Loại địa điểm phải khớp loại tổ chức sở hữu — nông dân không có địa điểm. Chạy với quyền người
-- gọi: tổ chức không thấy được (không phải tổ chức đang làm việc) ra NULL ⇒ cũng bị chặn.
create or replace function public.places_kind_matches_org()
returns trigger
language plpgsql
as $$
declare
  org_type text;
begin
  select type into org_type from public.organizations where id = new.organization_id;
  if org_type is distinct from new.kind then
    raise exception 'places.kind (%) khác loại tổ chức (%)', new.kind, org_type
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger places_kind_matches_org
  before insert or update of kind, organization_id on places
  for each row execute function public.places_kind_matches_org();

-- Xoá thắng (BE3 §B1): điểm đã gỡ không hiện lại, mốc gỡ không đổi, dù ai gọi.
create trigger places_keep_deleted before update on public.places
  for each row execute function public.keep_soft_deleted();

create trigger touch_updated_at before update on public.places
  for each row execute function public.touch_updated_at();

-- ─── B3. Quyền ──────────────────────────────────────────────────────────────
-- api_service: đọc, thêm, sửa — KHÔNG DELETE (gỡ là xoá mềm). api_privileged: xoá tài khoản xoá
-- hẳn tổ chức, kéo theo địa điểm của nó (0001 chỉ grant trên bảng có lúc đó).
grant select, insert, update on places to api_service;
grant select, insert, update, delete on places to api_privileged;

-- ─── B4. RLS ────────────────────────────────────────────────────────────────
alter table places enable row level security;

-- MỌI người đã đăng nhập đọc được điểm còn hiện (bản đồ chung của cả ba vai trò). Tổ chức chủ
-- còn thấy điểm đã gỡ của mình — Prisma `UPDATE … RETURNING` đọc lại hàng vừa gỡ, thiếu vế này
-- thì gỡ báo lỗi RLS.
create policy places_read on places for select to api_service
  using (public.app_user_id() is not null
         and (deleted_at is null or organization_id = public.app_org_id()));
create policy places_insert on places for insert to api_service
  with check (organization_id = public.app_org_id() and created_by = public.app_user_id());
create policy places_update on places for update to api_service
  using (organization_id = public.app_org_id())
  with check (organization_id = public.app_org_id());

-- ─── B5. Tên tổ chức chủ ────────────────────────────────────────────────────
-- Popup trên bản đồ cần tên tổ chức sở hữu điểm. RLS của organizations chỉ cho đọc tổ chức mình
-- là thành viên — KHÔNG nới nó (sẽ lộ SĐT, địa chỉ của tổ chức). Hàm này chỉ trả id + tên, và chỉ
-- của tổ chức đang có ít nhất một điểm còn hiện; người gọi phải đã đăng nhập.

create or replace function public.place_owners(p_orgs uuid[])
returns table (id uuid, name text)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select g.id, g.name
  from public.organizations g
  where g.id = any(p_orgs)
    and g.deleted_at is null
    and public.app_user_id() is not null
    and exists (select 1 from public.places p where p.organization_id = g.id and p.deleted_at is null);
$$;

revoke all on function public.place_owners(uuid[]) from public;
grant execute on function public.place_owners(uuid[]) to api_service;
