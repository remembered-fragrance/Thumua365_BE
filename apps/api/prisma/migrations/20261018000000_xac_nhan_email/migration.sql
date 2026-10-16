-- ═══════════════════════════════════════════════════════════════════════════
-- Xác nhận email khôi phục · tự đặt lại mật khẩu qua email
--
-- Email khôi phục trước đây chỉ là chữ người dùng gõ vào: không ai kiểm hộp thư đó có phải của họ.
-- Gửi link đặt lại mật khẩu tới một email chưa xác nhận là trao tài khoản cho người lạ. Từ đây:
--   - API gửi thư có link xác nhận (mã ngẫu nhiên, DB chỉ giữ sha256, hết hạn sau 24 giờ);
--   - bấm link → recovery_email_verified_at; chỉ email đã xác nhận mới nhận thư đặt lại mật khẩu;
--   - đổi email → trigger đưa trạng thái xác nhận và mã đang chờ về NULL.
--
--   A. (Prisma sinh, `prisma migrate diff`) cột — khớp schema.prisma.
--   B. (viết tay) CHECK, index, trigger, hai hàm security definer.
--
-- Quyền: api_service, api_privileged, backup_reader đã có quyền trên cả bảng profiles — cột mới đi
-- theo. Thêm cột trống được, không default — không viết lại bảng; hồ sơ cũ đọc ra NULL = chưa xác nhận.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── A. Cột (Prisma sinh) ───────────────────────────────────────────────────

-- AlterTable
ALTER TABLE "profiles" ADD COLUMN     "auth_mail_sent_at" TIMESTAMPTZ(6),
ADD COLUMN     "recovery_email_token_expires_at" TIMESTAMPTZ(6),
ADD COLUMN     "recovery_email_token_hash" TEXT,
ADD COLUMN     "recovery_email_verified_at" TIMESTAMPTZ(6);

-- ─── B. Viết tay ────────────────────────────────────────────────────────────

-- Mã đang chờ: có hash thì có hạn, và hash đúng dạng sha256 hex.
alter table profiles add constraint profiles_recovery_email_token_check
  check (
    (recovery_email_token_hash is null and recovery_email_token_expires_at is null)
    or (recovery_email_token_hash ~ '^[0-9a-f]{64}$' and recovery_email_token_expires_at is not null)
  );

-- Bấm link là tra theo hash.
create unique index profiles_recovery_email_token
  on profiles (recovery_email_token_hash)
  where recovery_email_token_hash is not null;

-- Đổi (hay bỏ) email → mất xác nhận, mã cũ hết dùng được. Và api_service KHÔNG tự đánh dấu
-- "đã xác nhận" được: chỉ hàm confirm_recovery_email (chạy bằng quyền chủ hàm) làm việc đó.
create or replace function public.guard_recovery_email()
returns trigger
language plpgsql
as $$
begin
  if new.recovery_email is distinct from old.recovery_email then
    new.recovery_email_verified_at := null;
    new.recovery_email_token_hash := null;
    new.recovery_email_token_expires_at := null;
  elsif new.recovery_email_verified_at is distinct from old.recovery_email_verified_at
    and new.recovery_email_verified_at is not null
    and current_user = 'api_service' then
    raise exception 'recovery_email_verified_at chỉ đặt qua confirm_recovery_email()'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger profiles_guard_recovery_email
  before update on profiles
  for each row execute function public.guard_recovery_email();

-- Hồ sơ mới cũng không được sinh ra với trạng thái "đã xác nhận".
create or replace function public.guard_recovery_email_insert()
returns trigger
language plpgsql
as $$
begin
  if new.recovery_email_verified_at is not null and current_user = 'api_service' then
    raise exception 'recovery_email_verified_at chỉ đặt qua confirm_recovery_email()'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger profiles_guard_recovery_email_insert
  before insert on profiles
  for each row execute function public.guard_recovery_email_insert();

-- Bấm link xác nhận (chưa đăng nhập cũng được ⇒ không có ngữ cảnh RLS). Mã dùng một lần; hết hạn,
-- đã dùng, hay email đã đổi sau khi gửi (trigger xoá mã) → NULL. Trả email vừa xác nhận.
create or replace function public.confirm_recovery_email(p_token_hash text)
returns text
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_email text;
begin
  update public.profiles p
     set recovery_email_verified_at = now(),
         recovery_email_token_hash = null,
         recovery_email_token_expires_at = null
   where p.recovery_email_token_hash = p_token_hash
     and p.recovery_email_token_expires_at > now()
     and p.recovery_email is not null
     and p.deleted_at is null
  returning p.recovery_email::text into v_email;
  return v_email;
end;
$$;

-- Quên mật khẩu: giữ lượt gửi thư cho tài khoản này. Chỉ khi có email ĐÃ XÁC NHẬN và lần gửi trước
-- đã qua 60 giây; giữ được thì ghi mốc gửi và trả email, không thì NULL (API vẫn trả 200 như nhau).
create or replace function public.claim_password_reset_mail(p_user uuid)
returns text
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_email text;
begin
  update public.profiles p
     set auth_mail_sent_at = now()
   where p.id = p_user
     and p.deleted_at is null
     and p.recovery_email is not null
     and p.recovery_email_verified_at is not null
     and (p.auth_mail_sent_at is null or p.auth_mail_sent_at < now() - interval '60 seconds')
  returning p.recovery_email::text into v_email;
  return v_email;
end;
$$;

revoke all on function public.guard_recovery_email() from public;
revoke all on function public.guard_recovery_email_insert() from public;
revoke all on function public.confirm_recovery_email(text) from public;
revoke all on function public.claim_password_reset_mail(uuid) from public;
grant execute on function public.confirm_recovery_email(text) to api_service;
grant execute on function public.claim_password_reset_mail(uuid) to api_service;
