-- ═══════════════════════════════════════════════════════════════════════════
-- 0007 — Mỗi định danh đăng nhập trỏ đúng một người (BE6, sửa khi gom 03/10/2026)
--
-- Đăng nhập một ô: người dùng gõ SĐT, tên đăng nhập hoặc email khôi phục vào CÙNG một ô. Bản cũ
-- của find_login_user tra "tên = x OR SĐT = x OR email = x … LIMIT 1": tên đăng nhập được phép là một
-- dãy số giống SĐT, email khôi phục không duy nhất — nên một định danh có thể khớp hai hồ sơ và hàm
-- trả ngẫu nhiên một trong hai. BE6 cho sửa tên đăng nhập / email khôi phục bất cứ lúc nào
-- (PATCH /v1/me/profile), và quản trị viên tra tài khoản theo SĐT bằng chính hàm này.
--
-- Không đổi bảng (schema.prisma giữ nguyên). Viết tay:
--   1. CHECK: tên đăng nhập không giống SĐT — cùng luật isPhoneLike của @mambo/core/identifier
--   2. Email khôi phục duy nhất trong các hồ sơ còn dùng (index một phần — hồ sơ đã xoá không giữ chỗ)
--   3. find_login_user tra ĐÚNG MỘT loại định danh theo cách gõ: giống SĐT → SĐT; có @ → email khôi
--      phục; còn lại → tên đăng nhập. Mỗi loại đều duy nhất ⇒ không còn LIMIT 1 nào phải đoán.
--
-- Đã kiểm staging trước khi viết (03/10): 8 hồ sơ, 0 tên đăng nhập giống SĐT, 0 email khôi phục.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1. Tên đăng nhập không giống SĐT ──────────────────────────────────────
-- isPhoneLike: bỏ khoảng trắng . - ( ) rồi khớp 0 + 8–10 số, hoặc (+)84 + 8–10 số.

alter table profiles add constraint profiles_username_not_phone
  check (
    username is null
    or regexp_replace(username::text, '[[:space:].()-]', '', 'g') !~ '^(0[0-9]{8,10}|[+]?84[0-9]{8,10})$'
  );

-- ─── 2. Email khôi phục duy nhất ───────────────────────────────────────────
-- citext ⇒ không phân biệt hoa thường.

create unique index profiles_recovery_email_live
  on profiles (recovery_email)
  where deleted_at is null and recovery_email is not null;

-- ─── 3. Đăng nhập một ô ─────────────────────────────────────────────────────
-- Giữ nguyên chữ ký, quyền (api_service, api_privileged) và cách API dùng: trả id hoặc null; API luôn
-- trả một email cùng hình dạng dù không tìm thấy (/v1/auth/resolve-identifier).

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
    select p.id into v_id from public.profiles p where p.recovery_email = v_key::citext and p.deleted_at is null;
  else
    select p.id into v_id from public.profiles p where p.username = v_key::citext and p.deleted_at is null;
  end if;
  return v_id;
end;
$$;
