-- ═══════════════════════════════════════════════════════════════════════════
-- 0006 — Tài khoản, gói, thanh toán (BE6) · KH backend §1.7, §5, §6
--
-- Không đổi bảng (schema.prisma giữ nguyên). Viết tay:
--   1. claim_referral() — ghi nhận người mời, như RPC cùng tên của bản cũ (0009), đổi auth.uid()
--      sang app_user_id(). RLS của profiles chỉ cho đọc hồ sơ của mình, nên tra mã của người khác
--      phải qua hàm hẹp này.
--   2. Quyền của api_privileged trên hàm dùng chung (find_login_user cho quản trị).
--
-- Webhook ngân hàng, quản trị, xoá tài khoản chạy bằng api_privileged (BYPASSRLS, đã có quyền trên
-- mọi bảng từ 0001) — không cần policy mới.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1. Ghi nhận người mời ──────────────────────────────────────────────────
-- Trả true khi ghi nhận được. KHÔNG nói vì sao thất bại: "mã này có thật hay không" đủ để dò ra ai
-- đang dùng app. Ghi đúng một lần (`referred_by is null`) — đổi được thì phần thưởng thành thứ khai
-- lại mỗi tháng.

create or replace function public.claim_referral(p_code text)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_me uuid := public.app_user_id();
  v_inviter uuid;
begin
  if v_me is null or coalesce(trim(p_code), '') = '' then
    return false;
  end if;

  select p.id into v_inviter
  from public.profiles p
  where p.referral_code = trim(p_code)::citext
    and p.deleted_at is null
    and p.id <> v_me;

  if v_inviter is null then
    return false;
  end if;

  update public.profiles
  set referred_by = v_inviter
  where id = v_me and referred_by is null and deleted_at is null;

  return found;
end;
$$;

revoke all on function public.claim_referral(text) from public;
grant execute on function public.claim_referral(text) to api_service;

-- ─── 2. Hàm dùng chung cho api_privileged ───────────────────────────────────

grant execute on function public.find_login_user(text) to api_privileged;

-- ─── 3. Chỉ tiền thật mới mở được gói ───────────────────────────────────────
-- api_service (mọi request thường) có quyền ghi subscriptions / payment_intents vì bootstrap tạo gói
-- dùng thử và chủ vựa tạo ý định thanh toán. Nhưng MỞ / GIA HẠN gói, đánh dấu "đã trả" là việc
-- của webhook ngân hàng và quản trị viên (api_privileged) — chặn ở database, không chỉ ở API: một
-- lỗi code ở endpoint thường không được thành cách tự gia hạn miễn phí (VAN_HANH §7.3 mục 8).

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
      if new.status <> 'trialing' or new.current_period_end is not null or new.branch_limit is not null then
        raise exception 'Gói mới chỉ là dùng thử — mở gói trả tiền qua webhook hoặc quản trị'
          using errcode = 'insufficient_privilege';
      end if;
      return new;
    end if;
    if new.status is distinct from old.status
       or new.current_period_end is distinct from old.current_period_end
       or new.trial_ends_at is distinct from old.trial_ends_at
       or new.branch_limit is distinct from old.branch_limit then
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
  return new;
end;
$$;

create trigger subscriptions_billing_guard
  before insert or update on subscriptions
  for each row execute function public.billing_guard();

create trigger payment_intents_billing_guard
  before insert or update on payment_intents
  for each row execute function public.billing_guard();
