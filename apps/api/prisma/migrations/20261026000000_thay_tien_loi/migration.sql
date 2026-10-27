-- ═══════════════════════════════════════════════════════════════════════════
-- Gói Pro Đợt 3 — thấy tiền lời, bớt gõ tay
--
-- Chỉ thêm cột cho phép NULL: hàng cũ giữ nguyên, app bản cũ không gửi các cột này và bỏ qua khi đọc.
-- ═══════════════════════════════════════════════════════════════════════════

-- V24: mặt hàng cà phê tươi — bao nhiêu kg tươi ra 1 kg nhân. Dòng phiếu mang bản chép của tỷ lệ trong `lines`
-- (JSONB), công thức vẫn là lossPercent nên không cần cột ở bảng phiếu.
alter table products add column green_ratio double precision;
alter table products add constraint products_green_ratio_check
  check (green_ratio > 1 and green_ratio <= 20);

-- V9: giá thu mua trên điểm bản đồ — [{ product, price, unit }], tối đa 10 (PLACE_PRICES_LIMIT ở contracts).
alter table places add column prices jsonb;
alter table places add column prices_updated_at timestamptz;
alter table places add constraint places_prices_check
  check (
    prices is null
    or case when jsonb_typeof(prices) = 'array' then jsonb_array_length(prices) <= 10 else false end
  );

-- Gói của chủ các điểm có giá — để máy chủ không trả giá của điểm có chủ đã hết gói. Như place_owners():
-- RLS của subscriptions không nới cho người ngoài, nên đi qua hàm security definer, chỉ trả cột ngày tháng
-- cần để tính bậc gói, và chỉ cho tổ chức đang có điểm khai giá.
create or replace function public.place_price_plans(p_orgs uuid[])
returns table (organization_id uuid, id uuid, status text, trial_ends_at timestamptz, current_period_end timestamptz)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select s.organization_id, s.id, s.status, s.trial_ends_at, s.current_period_end
  from public.subscriptions s
  where s.organization_id = any(p_orgs)
    and s.deleted_at is null
    and public.app_user_id() is not null
    and exists (
      select 1 from public.places p
      where p.organization_id = s.organization_id and p.deleted_at is null and p.prices is not null
    );
$$;

revoke all on function public.place_price_plans(uuid[]) from public;
grant execute on function public.place_price_plans(uuid[]) to api_service;

-- V15: hợp đồng mùa vụ — bảng sổ thứ chín, đồng bộ như ghi chú (id do app sinh, xoá mềm, RLS theo tổ chức).
create table season_contracts (
  id uuid not null,
  organization_id uuid not null,
  created_by uuid not null,
  kind text not null,
  counterparty_id text,
  counterparty_name text not null,
  product_id text,
  product_name text not null,
  unit text not null default 'kg',
  quantity double precision not null,
  price_per_unit double precision,
  start_date timestamptz(6) not null,
  end_date timestamptz(6) not null,
  note text,
  closed boolean not null default false,
  created_at timestamptz(6) not null default current_timestamp,
  updated_at timestamptz(3) not null default current_timestamp,
  deleted_at timestamptz(6),
  constraint season_contracts_pkey primary key (id),
  constraint season_contracts_kind_check check (kind in ('purchase', 'sale')),
  constraint season_contracts_quantity_check check (quantity > 0),
  constraint season_contracts_dates_check check (start_date <= end_date)
);
create index season_contracts_organization_id_updated_at_idx on season_contracts (organization_id, updated_at);
alter table season_contracts add constraint season_contracts_organization_id_fkey
  foreign key (organization_id) references organizations (id) on delete restrict on update cascade;

create trigger season_contracts_touch before update on public.season_contracts
  for each row execute function public.touch_updated_at();
create trigger season_contracts_keep_deleted before update on public.season_contracts
  for each row execute function public.keep_soft_deleted();

grant select, insert, update on season_contracts to api_service;
grant select, insert, update, delete on season_contracts to api_privileged;

alter table season_contracts enable row level security;
create policy org_rows on public.season_contracts for all to api_service
  using (organization_id = public.app_org_id())
  with check (organization_id = public.app_org_id());
