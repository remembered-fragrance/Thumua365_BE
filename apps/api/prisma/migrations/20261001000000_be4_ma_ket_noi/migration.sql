-- ═══════════════════════════════════════════════════════════════════════════
-- 0004 — Mã kết nối thay OTP (BE4, quyết định 01/10/2026) · KH backend §1.4
--
-- OTP SMS tạm ẩn tới khi > 100 tổ chức trả phí. Đường chính để chứng minh "đúng người":
-- bên sổ (vựa / DN) mời → nhận MÃ KẾT NỐI 8 ký tự → đưa tận tay (lúc cân, qua Zalo; sau
-- này bằng QR chứa đúng mã) → bên được mời nhập mã → kết nối active ngay.
--
-- Chỉ thêm, không đổi nghĩa cái cũ: đường OTP (discover_links + accept) giữ nguyên.
--
--   A. (Prisma sinh) partner_links.invite_code (duy nhất), invite_code_expires_at
--   B. (viết tay) CHECK hình dạng mã · trigger: chỉ bên sổ đặt mã, mã chỉ sống khi
--      pending · my_links() trả mã cho bên sổ · claim_link(): nhập mã
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── A. Prisma sinh ─────────────────────────────────────────────────────────

-- AlterTable
ALTER TABLE "partner_links" ADD COLUMN     "invite_code" TEXT,
ADD COLUMN     "invite_code_expires_at" TIMESTAMPTZ(6);

-- CreateIndex
CREATE UNIQUE INDEX "partner_links_invite_code_key" ON "partner_links"("invite_code");

-- ─── B1. Hình dạng mã ───────────────────────────────────────────────────────
-- Cùng bảng chữ với LINK_CODE_ALPHABET của @mambo/contracts (bỏ 0/O, 1/I/L). Mã và hạn
-- luôn đi cùng nhau.

alter table partner_links add constraint partner_links_invite_code_check
  check (invite_code is null or invite_code ~ '^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$');
alter table partner_links add constraint partner_links_invite_code_pair
  check ((invite_code is null) = (invite_code_expires_at is null));

-- ─── B2. Luật chuyển trạng thái + luật của mã ───────────────────────────────
-- Như bản BE4 (0003), thêm hai luật:
--   - api_service chỉ đặt/đổi mã khi đang làm việc cho BÊN SỔ (bên được mời không tự cấp mã)
--   - mã chỉ sống khi pending: đổi sang active / revoked là mã bị xoá — dùng một lần, và
--     kết nối đã huỷ không còn mã nào nhập được

create or replace function public.partner_links_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'pending' and current_user = 'api_service' then
      raise exception 'Kết nối mới luôn ở trạng thái pending' using errcode = 'check_violation';
    end if;
    if new.invite_code is not null and current_user = 'api_service'
       and public.app_org_id() is distinct from new.owner_org_id then
      raise exception 'Chỉ bên sổ mới cấp được mã kết nối' using errcode = 'insufficient_privilege';
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
  if new.invite_code is distinct from old.invite_code and new.invite_code is not null
     and current_user = 'api_service' and public.app_org_id() is distinct from new.owner_org_id then
    raise exception 'Chỉ bên sổ mới cấp được mã kết nối' using errcode = 'insufficient_privilege';
  end if;

  if new.status <> 'pending' then
    new.invite_code := null;
    new.invite_code_expires_at := null;
  end if;
  return new;
end;
$$;

-- ─── B3. my_links(): thêm mã còn hạn cho bên sổ ─────────────────────────────
-- Đổi kiểu trả về ⇒ phải drop rồi tạo lại. Bên được liên kết KHÔNG bao giờ thấy mã.

drop function public.my_links();

create function public.my_links()
returns table (
  id uuid,
  side text,
  status text,
  partner_kind text,
  partner_id uuid,
  partner_name text,
  invited_phone text,
  invite_code text,
  invite_code_expires_at timestamptz,
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
         case when l.owner_org_id = public.app_org_id() and l.invite_code_expires_at > now()
              then l.invite_code end,
         case when l.owner_org_id = public.app_org_id() and l.invite_code_expires_at > now()
              then l.invite_code_expires_at end,
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

-- ─── B4. claim_link(): nhập mã kết nối ──────────────────────────────────────
-- Security definer vì trước khi nhận, lời mời chưa có bên được liên kết ⇒ RLS (đúng) không
-- cho tổ chức đang làm việc thấy nó. Hàm chỉ làm MỘT việc: mã đúng, còn hạn, của sổ khác, chưa
-- ai nhận (hoặc chính tổ chức này đã dò được qua OTP) ⇒ gắn tổ chức này + active. Trigger xoá
-- mã ngay trong cùng câu lệnh ⇒ mã dùng một lần. Trả id kết nối; null = mã không dùng được
-- (sai, đã dùng, hết hạn, của chính mình, sổ đã xoá — API trả cùng một câu cho mọi trường hợp).

create function public.claim_link(p_code text)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_org uuid := public.app_org_id();
  v_user uuid := public.app_user_id();
  v_id uuid;
begin
  if v_org is null or v_user is null then
    raise exception 'claim_link cần app.org_id và app.user_id';
  end if;

  update public.partner_links l
     set linked_org_id = v_org,
         status = 'active',
         decided_by = v_user,
         decided_at = now()
   where l.invite_code = p_code
     and l.status = 'pending'
     and l.invite_code_expires_at > now()
     and l.owner_org_id <> v_org
     and (l.linked_org_id is null or l.linked_org_id = v_org)
     and exists (select 1 from public.organizations o where o.id = l.owner_org_id and o.deleted_at is null)
  returning l.id into v_id;

  return v_id;
end;
$$;

revoke all on function public.my_links() from public;
revoke all on function public.claim_link(text) from public;
grant execute on function public.my_links() to api_service;
grant execute on function public.claim_link(text) to api_service;
