-- ═══════════════════════════════════════════════════════════════════════════
-- Email khôi phục CHƯA xác nhận không giữ chỗ, không đăng nhập được (C4)
--
-- Trước đây index duy nhất `profiles_recovery_email_live` và `find_login_user` tính cả email chưa ai
-- bấm link xác nhận: khai trước email của người khác là chiếm luôn — chủ thật khai sau bị chặn (sửa hồ
-- sơ 422) hoặc bị lặng lẽ bỏ email (bước đăng ký), còn người khai trước đăng nhập được bằng email đó.
-- Từ đây chỉ email ĐÃ XÁC NHẬN mới là định danh:
--   1. Duy nhất chỉ trong các email đã xác nhận. Hai hồ sơ cùng khai một email chưa xác nhận được;
--      ai bấm link trước thì giữ — người sau vướng index ngay trong confirm_recovery_email (API báo
--      EMAIL_TAKEN), không lặng lẽ thành công.
--   2. find_login_user chỉ khớp email đã xác nhận.
--
-- Không đổi bảng (schema.prisma giữ nguyên). Index hẹp hơn index cũ ⇒ tạo luôn được trên dữ liệu đang
-- có, không cần dọn trước.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1. Duy nhất trong email đã xác nhận ────────────────────────────────────

drop index if exists profiles_recovery_email_live;

create unique index profiles_recovery_email_verified
  on profiles (recovery_email)
  where deleted_at is null and recovery_email is not null and recovery_email_verified_at is not null;

-- ─── 2. Đăng nhập một ô: email chỉ khi đã xác nhận ─────────────────────────
-- Giữ nguyên chữ ký và quyền (create or replace giữ grant). Phần SĐT và tên đăng nhập không đổi.

create or replace function public.find_login_user(raw text)
returns uuid
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_key   text := lower(trim(coalesce(raw, '')));
  v_phone text;
  v_id    uuid;
begin
  if v_key = '' then
    return null;
  end if;

  -- Gõ như số điện thoại → chỉ tra SĐT. Toàn chữ số mà không phải SĐT (tên "12345") thì xuống dưới.
  if v_key ~ '^[0-9 .+()-]+$' then
    v_phone := public.normalize_phone(v_key);
    if v_phone is not null then
      select p.id into v_id from public.profiles p where p.phone = v_phone and p.deleted_at is null;
      return v_id;
    end if;
  end if;

  -- ::citext để so KHÔNG phân biệt hoa thường (citext = text sẽ so như text).
  if position('@' in v_key) > 0 then
    select p.id into v_id from public.profiles p
     where p.recovery_email = v_key::citext
       and p.recovery_email_verified_at is not null
       and p.deleted_at is null;
  else
    select p.id into v_id from public.profiles p where p.username = v_key::citext and p.deleted_at is null;
  end if;
  return v_id;
end;
$$;
