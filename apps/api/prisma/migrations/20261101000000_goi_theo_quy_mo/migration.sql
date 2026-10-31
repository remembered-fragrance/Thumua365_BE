-- ═══════════════════════════════════════════════════════════════════════════
-- Gói theo quy mô (0.28.0) — Thương lái 199k · Vựa 449k (+ người cân thêm 79k/người) · Doanh nghiệp giữ như cũ
--
-- Chỉ thêm cột (cho phép NULL hoặc có mặc định) + thay hàm trigger: bản API đang chạy không đọc các cột này,
-- vẫn chạy bình thường cho tới khi bản mới lên. Chạy migration TRƯỚC khi deploy API 0.28.0.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── subscriptions ──────────────────────────────────────────────────────────

-- Gói vựa đã chọn. Doanh nghiệp NULL (không đụng gói doanh nghiệp).
alter table subscriptions add column plan text;
alter table subscriptions add constraint subscriptions_plan_check check (plan in ('thuong_lai', 'vua'));
-- Người cân mua thêm ngoài 3 người gói Vựa có sẵn; tối đa 5 (tổng 8).
alter table subscriptions add column extra_staff smallint not null default 0;
alter table subscriptions add constraint subscriptions_extra_staff_check check (extra_staff between 0 and 5);
-- Kỳ trả tiền gần nhất (1 tháng / 12 tháng) — để tính đơn giá ngày khi mua thêm người cân giữa kỳ. NULL = coi là 1.
alter table subscriptions add column billing_months smallint;
alter table subscriptions add constraint subscriptions_billing_months_check check (billing_months in (1, 12));

-- Mọi tài khoản vựa đang có (đã trả tiền VÀ đang dùng thử) → gói Vựa: dùng thử giờ lọc theo gói, để trống hay
-- Thương lái thì người đang có người cân mất quyền thêm người. Người đã trả 149k cũng là Vựa tới hết kỳ (chốt 30/10).
update subscriptions s set plan = 'vua'
from organizations o
where o.id = s.organization_id and o.type = 'trader' and s.plan is null;

-- Kỳ đã trả theo khoản tiền gần nhất đã mở gói: 1.490.000đ là gói năm cũ.
update subscriptions s set billing_months = case when last.amount >= 1490000 then 12 else 1 end
from (
  select distinct on (organization_id) organization_id, amount
  from bank_transactions
  where outcome = 'applied' and organization_id is not null
  order by organization_id, created_at desc
) last
where last.organization_id = s.organization_id and s.current_period_end is not null;

-- Tài khoản vựa luôn có mã gói. Giữa lúc chạy migration và lúc API mới lên, bản cũ vẫn tạo gói dùng thử không có
-- `plan` → điền `vua` (như app cũ: dùng thử đủ tính năng). Bản mới luôn ghi `plan` nên trigger không đổi gì.
create or replace function public.subscriptions_default_plan()
returns trigger
language plpgsql
as $$
begin
  if new.plan is null and exists (select 1 from organizations where id = new.organization_id and type = 'trader') then
    new.plan := 'vua';
  end if;
  return new;
end;
$$;

create trigger subscriptions_default_plan
  before insert on subscriptions
  for each row execute function public.subscriptions_default_plan();

-- ─── payment_intents ────────────────────────────────────────────────────────

-- Webhook đọc gói / số tháng / số người cân TỪ Ý ĐỊNH, không suy từ số tiền: mua thêm người cân tính theo ngày
-- nên số tiền không còn duy nhất theo bảng giá. Ý định cũ (plan, months NULL) → bảng giá cũ 149k / 1.490k → Vựa.
alter table payment_intents add column kind text not null default 'plan';
alter table payment_intents add constraint payment_intents_kind_check check (kind in ('plan', 'staff'));
alter table payment_intents add column plan text;
alter table payment_intents add constraint payment_intents_plan_check check (plan in ('thuong_lai', 'vua'));
alter table payment_intents add column months smallint;
alter table payment_intents add constraint payment_intents_months_check check (months in (1, 12));
alter table payment_intents add column extra_staff smallint not null default 0;
alter table payment_intents add constraint payment_intents_extra_staff_check check (extra_staff between 0 and 5);
alter table payment_intents add constraint payment_intents_staff_shape
  check (kind <> 'staff' or (extra_staff > 0 and plan is null and months is null));

-- ─── billing_guard: api_service không tự đổi gói, số người cân, nội dung ý định ──

-- Như BE6: mở / đổi gói là việc của webhook ngân hàng và quản trị viên. Thêm: đăng ký (api_service) được ghi mã gói
-- lúc tạo gói dùng thử, nhưng không tự cho mình người cân thêm; ý định đã tạo không đổi được gói / số tháng / số
-- người (đổi được thì tạo ý định 26.000đ mua người cân rồi sửa thành gói năm).
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
  if tg_op = 'UPDATE' and new.status = 'paid' and old.status <> 'paid' then
    raise exception 'Chỉ webhook ngân hàng và quản trị viên đánh dấu đã trả' using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'UPDATE' and new.amount <> old.amount then
    raise exception 'Không sửa số tiền của ý định thanh toán' using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'UPDATE' and (new.kind is distinct from old.kind or new.plan is distinct from old.plan
       or new.months is distinct from old.months or new.extra_staff is distinct from old.extra_staff) then
    raise exception 'Không sửa nội dung của ý định thanh toán' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;
