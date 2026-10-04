-- ═══════════════════════════════════════════════════════════════════════════
-- 0005 — Nhân viên, chi nhánh (BE7) · KH backend §1.6, §6
--
-- Không đổi bảng (schema.prisma giữ nguyên). Viết tay:
--   1. memberships_guard — vai trò `owner` chỉ có từ lúc lập tổ chức; không gán, không tước,
--      không gỡ được bằng api_service. Bắt đúng lỗi "API lỡ cho nhân viên lên làm chủ".
--   2. org_members() — danh sách người trong tổ chức kèm tên, số điện thoại. RLS của profiles chỉ
--      cho đọc hồ sơ CỦA MÌNH, nên chủ không đọc được tên nhân viên nếu không qua hàm hẹp này.
--   3. create_member_profile() — hồ sơ cho tài khoản chủ vừa tạo cho nhân viên (cùng lý do RLS).
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1. Vai trò owner ───────────────────────────────────────────────────────

create or replace function public.memberships_guard()
returns trigger
language plpgsql
as $$
begin
  if current_user <> 'api_service' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.role = 'owner' and exists (
      select 1 from public.memberships m where m.organization_id = new.organization_id
    ) then
      raise exception 'Tổ chức đã có người — không thêm chủ mới' using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;
  if old.role = 'owner' and (new.role <> 'owner' or new.status <> old.status or new.user_id <> old.user_id) then
    raise exception 'Không đổi, không gỡ được chủ tổ chức' using errcode = 'insufficient_privilege';
  end if;
  if new.role = 'owner' and old.role <> 'owner' then
    raise exception 'Không nâng ai lên làm chủ tổ chức' using errcode = 'insufficient_privilege';
  end if;
  if new.user_id <> old.user_id or new.organization_id <> old.organization_id then
    raise exception 'Không đổi người hay tổ chức của một membership' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger memberships_guard
  before insert or update on memberships
  for each row execute function public.memberships_guard();

-- ─── 2. Người trong tổ chức ─────────────────────────────────────────────────
-- Chỉ thành viên đang hoạt động của tổ chức đang làm việc mới gọi ra kết quả. Trả tên và số
-- điện thoại từ hồ sơ — không email khôi phục, không mã giới thiệu.

create or replace function public.org_members()
returns table (
  id uuid,
  user_id uuid,
  role text,
  status text,
  branch_id uuid,
  branch_name text,
  name text,
  phone text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select m.id, m.user_id, m.role, m.status, m.branch_id, b.name, p.name, p.phone, m.created_at
  from public.memberships m
  left join public.branches b on b.id = m.branch_id
  left join public.profiles p on p.id = m.user_id and p.deleted_at is null
  where m.organization_id = public.app_org_id()
    and exists (
      select 1 from public.memberships me
      where me.organization_id = public.app_org_id()
        and me.user_id = public.app_user_id()
        and me.status = 'active'
    )
  order by (m.status = 'active') desc, m.created_at, m.id;
$$;

-- ─── 3. Hồ sơ cho tài khoản chủ vừa tạo ─────────────────────────────────────
-- API tạo tài khoản Supabase trước, rồi membership, rồi gọi hàm này trong CÙNG transaction với
-- membership. Hàm chỉ chạy khi: người gọi là CHỦ đang hoạt động của tổ chức đang làm việc, và tài
-- khoản kia có membership (không phải chủ) trong chính tổ chức đó. Hồ sơ đã có thì để nguyên.

create or replace function public.create_member_profile(p_user uuid, p_name text, p_phone text)
returns void
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_org uuid := public.app_org_id();
begin
  if v_org is null then
    raise exception 'create_member_profile cần app.org_id';
  end if;
  if not exists (
    select 1 from public.memberships m
    where m.organization_id = v_org and m.user_id = public.app_user_id()
      and m.role = 'owner' and m.status = 'active'
  ) then
    raise exception 'Chỉ chủ tổ chức tạo hồ sơ cho người của mình' using errcode = 'insufficient_privilege';
  end if;
  if not exists (
    select 1 from public.memberships m
    where m.organization_id = v_org and m.user_id = p_user and m.role <> 'owner'
  ) then
    raise exception 'Tài khoản này không thuộc tổ chức' using errcode = 'insufficient_privilege';
  end if;

  insert into public.profiles (id, name, phone)
  values (p_user, p_name, public.normalize_phone(p_phone))
  on conflict (id) do nothing;
end;
$$;

revoke all on function public.org_members() from public;
revoke all on function public.create_member_profile(uuid, text, text) from public;
grant execute on function public.org_members() to api_service;
grant execute on function public.create_member_profile(uuid, text, text) to api_service;
