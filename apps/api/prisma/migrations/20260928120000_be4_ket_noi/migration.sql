-- ═══════════════════════════════════════════════════════════════════════════
-- 0003 — Kết nối giữa tổ chức (BE4) · KH backend §1.4, §5
--
-- Không đổi bảng (schema.prisma giữ nguyên). Viết tay toàn bộ:
--   1. Luật chuyển trạng thái của partner_links — ở database, không chỉ ở API
--   2. discover_links: nhận luôn lời mời bên sổ đã gửi trước tới đúng số này
--   3. my_links(): hai phía xem kết nối của mình, kèm tên tổ chức bên kia
--   4. linked_receipts(): phần sổ bên kia cho mình xem — chỉ trường in trên biên nhận
--
-- Hai hàm đọc là security definer vì RLS (đúng) không cho tổ chức này đọc sổ hay tên
-- của tổ chức khác. Mỗi hàm chỉ nhìn qua app.org_id() và chỉ api_service gọi được.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1. Luật chuyển trạng thái ──────────────────────────────────────────────
-- pending → active (CHỈ bên được liên kết) · pending|active → revoked · revoked là cuối.
-- Hai đầu của kết nối không đổi; bên được liên kết chỉ gắn một lần (lời mời được nhận).
-- Áp cho api_service; hàm security definer (chạy bằng owner) vẫn phải theo các luật chung.

create or replace function public.partner_links_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'pending' and current_user = 'api_service' then
      raise exception 'Kết nối mới luôn ở trạng thái pending' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if new.owner_org_id <> old.owner_org_id
     or new.partner_kind <> old.partner_kind
     or new.partner_id <> old.partner_id then
    raise exception 'Không đổi được hai đầu của kết nối' using errcode = 'check_violation';
  end if;
  if old.linked_org_id is not null and new.linked_org_id is distinct from old.linked_org_id then
    raise exception 'Kết nối đã có bên được liên kết — không đổi được' using errcode = 'check_violation';
  end if;
  if old.status = 'revoked' and new.status <> 'revoked' then
    raise exception 'Kết nối đã huỷ không mở lại được' using errcode = 'check_violation';
  end if;
  if old.status = 'active' and new.status = 'pending' then
    raise exception 'Kết nối đã đồng ý không quay về chờ được' using errcode = 'check_violation';
  end if;
  if new.status = 'active' and old.status <> 'active' then
    if new.linked_org_id is null then
      raise exception 'Chưa có bên được liên kết thì không đồng ý được' using errcode = 'check_violation';
    end if;
    if current_user = 'api_service' and public.app_org_id() is distinct from new.linked_org_id then
      raise exception 'Chỉ bên được liên kết mới đồng ý được' using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end;
$$;

create trigger partner_links_guard
  before insert or update on partner_links
  for each row execute function public.partner_links_guard();

-- ─── 2. Dò kết nối — nhận luôn lời mời ──────────────────────────────────────
-- Như bản BE2, thêm một bước: lời mời bên sổ đã gửi (/links/invite — chưa có bên được
-- liên kết) tới ĐÚNG số này thì gắn về tổ chức đang làm việc. Vẫn chỉ là `pending`: phải
-- chính bên được liên kết đồng ý. API kiểm số đã xác thực OTP TRƯỚC khi gọi.

create or replace function public.discover_links(p_phone text)
returns integer
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_org uuid := public.app_org_id();
  v_claimed integer;
  v_count integer;
begin
  if v_org is null then
    raise exception 'discover_links cần app.org_id';
  end if;
  if p_phone is null or public.normalize_phone(p_phone) is distinct from p_phone then
    raise exception 'discover_links cần số điện thoại dạng +84…';
  end if;

  update public.partner_links l
     set linked_org_id = v_org
   where l.linked_org_id is null
     and l.status = 'pending'
     and l.invited_phone = p_phone
     and l.owner_org_id <> v_org;
  get diagnostics v_claimed = row_count;

  insert into public.partner_links
    (owner_org_id, partner_kind, partner_id, linked_org_id, invited_phone, status)
  select c.organization_id, c.kind, c.id, v_org, p_phone, 'pending'
  from (
    select s.organization_id, 'supplier'::text as kind, s.id, s.phone
      from public.suppliers s where s.deleted_at is null
    union all
    select b.organization_id, 'buyer'::text, b.id, b.phone
      from public.buyers b where b.deleted_at is null
  ) c
  join public.organizations o on o.id = c.organization_id and o.deleted_at is null
  where c.organization_id <> v_org
    and public.normalize_phone(c.phone) = p_phone
    and not exists (
      select 1 from public.partner_links l
      where l.owner_org_id = c.organization_id
        and l.partner_kind = c.kind
        and l.partner_id = c.id
        and (l.status <> 'revoked' or l.linked_org_id = v_org)
    )
  on conflict do nothing;
  get diagnostics v_count = row_count;

  return v_claimed + v_count;
end;
$$;

-- ─── 3. Kết nối của tổ chức đang làm việc, cả hai phía ──────────────────────
-- Tên dòng danh bạ là tên bên sổ ghi — chính tên in trên biên nhận gửi cho bên kia.

create or replace function public.my_links()
returns table (
  id uuid,
  side text,
  status text,
  partner_kind text,
  partner_id uuid,
  partner_name text,
  invited_phone text,
  counterpart_id uuid,
  counterpart_name text,
  counterpart_type text,
  created_at timestamptz,
  decided_at timestamptz
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select l.id,
         case when l.owner_org_id = public.app_org_id() then 'owner' else 'linked' end,
         l.status,
         l.partner_kind,
         l.partner_id,
         coalesce(s.name, b.name, ''),
         l.invited_phone,
         c.id,
         c.name,
         c.type,
         l.created_at,
         l.decided_at
  from public.partner_links l
  left join public.suppliers s
    on l.partner_kind = 'supplier' and s.id = l.partner_id and s.organization_id = l.owner_org_id
  left join public.buyers b
    on l.partner_kind = 'buyer' and b.id = l.partner_id and b.organization_id = l.owner_org_id
  left join public.organizations c
    on c.id = case when l.owner_org_id = public.app_org_id() then l.linked_org_id else l.owner_org_id end
  where public.app_org_id() is not null
    and (l.owner_org_id = public.app_org_id() or l.linked_org_id = public.app_org_id())
  order by l.created_at desc, l.id;
$$;

-- ─── 4. Phần sổ bên kia cho mình xem ────────────────────────────────────────
-- Phiếu còn hiệu lực của bên sổ `p_owner` (null = mọi bên) có đối tác là dòng danh bạ nối
-- với tổ chức đang làm việc bằng kết nối ACTIVE: phiếu mua ↔ người bán, phiếu bán ↔ người
-- mua. Chỉ cột in trên biên nhận; lần trả chưa huỷ. Huỷ kết nối → hàm trả rỗng ngay.
-- Phân trang (date, id) giảm dần; p_limit null = tất cả (tính công nợ).

create or replace function public.linked_receipts(
  p_owner uuid,
  p_before_date timestamptz,
  p_before_id uuid,
  p_limit integer
)
returns table (
  id uuid,
  organization_id uuid,
  date timestamptz,
  kind text,
  party_name text,
  lines jsonb,
  adjustments jsonb,
  payments jsonb
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select t.id,
         t.organization_id,
         t.date,
         t.kind,
         t.supplier_name,
         t.lines,
         t.adjustments,
         coalesce((
           select jsonb_agg(jsonb_build_object('id', p.id, 'date', p.date, 'amount', p.amount) order by p.date, p.id)
           from public.payments p
           where p.transaction_id = t.id
             and p.organization_id = t.organization_id
             and p.deleted_at is null
         ), '[]'::jsonb)
  from public.transactions t
  where public.app_org_id() is not null
    and t.deleted_at is null
    and (p_owner is null or t.organization_id = p_owner)
    and exists (
      select 1 from public.partner_links l
      where l.owner_org_id = t.organization_id
        and l.linked_org_id = public.app_org_id()
        and l.status = 'active'
        and l.partner_id = t.counterparty_id
        and l.partner_kind = case t.kind when 'purchase' then 'supplier' else 'buyer' end
    )
    and (p_before_date is null or (t.date, t.id) < (p_before_date, p_before_id))
  order by t.date desc, t.id desc
  limit p_limit;
$$;

revoke all on function public.my_links() from public;
revoke all on function public.linked_receipts(uuid, timestamptz, uuid, integer) from public;
grant execute on function public.my_links() to api_service;
grant execute on function public.linked_receipts(uuid, timestamptz, uuid, integer) to api_service;
