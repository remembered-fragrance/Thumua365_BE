-- ═══════════════════════════════════════════════════════════════════════════
-- Mã Khách hàng sáng lập (0.29.0) — gói Thương lái 149.000đ/tháng thay 199.000đ, trong 12 kỳ tháng đã trả
--
-- Chỉ thêm bảng / cột (cho phép NULL hoặc có mặc định) + thay hàm trigger: API 0.28.0 vẫn chạy được trên nó.
-- Chạy migration TRƯỚC khi deploy API 0.29.0. Mã KHÔNG nạp ở đây (repo không chứa mã thật) — quản trị chèn bằng SQL.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── promo_codes ────────────────────────────────────────────────────────────

-- Một mã gắn với đúng một tổ chức (chủ nhập trên màn Gói), một tổ chức có tối đa một mã. `periods_used` tăng khi
-- tiền của ý định dùng giá mã đã vào (webhook / quản trị) — hết `periods` kỳ thì về giá niêm yết.
create table promo_codes (
  code text primary key,
  plan text not null default 'thuong_lai',
  monthly_amount integer not null,
  periods smallint not null,
  periods_used smallint not null default 0,
  organization_id uuid unique references organizations (id),
  redeemed_by uuid,
  redeemed_at timestamptz(6),
  note text,
  created_at timestamptz(6) not null default current_timestamp
);

alter table promo_codes add constraint promo_codes_code_check check (code ~ '^[A-Z0-9-]{4,32}$');
alter table promo_codes add constraint promo_codes_plan_check check (plan in ('thuong_lai', 'vua'));
alter table promo_codes add constraint promo_codes_amount_check check (monthly_amount > 0);
alter table promo_codes add constraint promo_codes_periods_check check (periods between 1 and 36);
alter table promo_codes add constraint promo_codes_used_check check (periods_used between 0 and periods);
alter table promo_codes add constraint promo_codes_redeemed_check
  check ((organization_id is null) = (redeemed_at is null));

-- api_service chỉ đọc mã của tổ chức đang làm việc; gắn mã chỉ qua `redeem_promo_code()`, trừ kỳ chỉ api_privileged.
grant select on promo_codes to api_service;
grant select, insert, update, delete on promo_codes to api_privileged;

alter table promo_codes enable row level security;
create policy own_promo on public.promo_codes for select to api_service
  using (organization_id = public.app_org_id());

-- Trả true khi gắn được. KHÔNG nói vì sao không được (mã sai / đã có người dùng): "mã này có thật" là thứ dò được.
-- Chỉ chủ đang hoạt động của tài khoản vựa, tổ chức chưa có mã nào.
create or replace function public.redeem_promo_code(p_code text)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_me uuid := public.app_user_id();
  v_org uuid := public.app_org_id();
begin
  if v_me is null or v_org is null or coalesce(trim(p_code), '') = '' then
    return false;
  end if;

  if not exists (
    select 1 from organizations o
    join memberships m on m.organization_id = o.id
    where o.id = v_org and o.type = 'trader' and o.deleted_at is null
      and m.user_id = v_me and m.role = 'owner' and m.status = 'active'
  ) then
    return false;
  end if;

  if exists (select 1 from promo_codes where organization_id = v_org) then
    return false;
  end if;

  update promo_codes
  set organization_id = v_org, redeemed_by = v_me, redeemed_at = now()
  where code = upper(trim(p_code)) and organization_id is null;

  return found;
end;
$$;

revoke all on function public.redeem_promo_code(text) from public;
grant execute on function public.redeem_promo_code(text) to api_service;

-- ─── payment_intents ────────────────────────────────────────────────────────

-- Ý định dùng giá mã: mã nào, trừ bao nhiêu kỳ khi tiền vào (tháng 1, năm 12).
alter table payment_intents add column promo_code text references promo_codes (code);
alter table payment_intents add column promo_periods smallint not null default 0;
alter table payment_intents add constraint payment_intents_promo_check
  check ((promo_code is null and promo_periods = 0) or (promo_code is not null and promo_periods between 1 and 36));

-- ─── billing_guard: thêm mã sáng lập ────────────────────────────────────────

-- Như 0.28.0, thêm: api_service chỉ tạo ý định dùng mã ĐÃ GẮN với chính tổ chức đó và còn đủ kỳ; không sửa mã / số kỳ
-- của ý định đã tạo.
create or replace function public.billing_guard()
returns trigger
language plpgsql
as $$
begin
  if current_user <> 'api_service' then
    return new;
  end if;

  if tg_table_name = 'subscriptions' then
    if tg_op = 'INSERT' then
      if new.status <> 'trialing' or new.current_period_end is not null or new.branch_limit is not null
         or new.extra_staff <> 0 or new.billing_months is not null then
        raise exception 'Gói mới chỉ là dùng thử — mở gói trả tiền qua webhook hoặc quản trị'
          using errcode = 'insufficient_privilege';
      end if;
      return new;
    end if;
    if new.status is distinct from old.status
       or new.current_period_end is distinct from old.current_period_end
       or new.trial_ends_at is distinct from old.trial_ends_at
       or new.branch_limit is distinct from old.branch_limit
       or new.plan is distinct from old.plan
       or new.extra_staff is distinct from old.extra_staff
       or new.billing_months is distinct from old.billing_months then
      raise exception 'Chỉ webhook ngân hàng và quản trị viên đổi được gói' using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  -- payment_intents
  if tg_op = 'INSERT' and new.status <> 'pending' then
    raise exception 'Ý định thanh toán mới luôn ở trạng thái pending' using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'INSERT' and new.promo_code is not null and not exists (
    select 1 from promo_codes p
    where p.code = new.promo_code and p.organization_id = new.organization_id
      and p.periods_used + new.promo_periods <= p.periods
  ) then
    raise exception 'Mã ưu đãi không thuộc tổ chức này hoặc đã hết kỳ' using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'UPDATE' and new.status = 'paid' and old.status <> 'paid' then
    raise exception 'Chỉ webhook ngân hàng và quản trị viên đánh dấu đã trả' using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'UPDATE' and new.amount <> old.amount then
    raise exception 'Không sửa số tiền của ý định thanh toán' using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'UPDATE' and (new.kind is distinct from old.kind or new.plan is distinct from old.plan
       or new.months is distinct from old.months or new.extra_staff is distinct from old.extra_staff
       or new.promo_code is distinct from old.promo_code or new.promo_periods is distinct from old.promo_periods) then
    raise exception 'Không sửa nội dung của ý định thanh toán' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;
