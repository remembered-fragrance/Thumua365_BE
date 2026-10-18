-- ═══════════════════════════════════════════════════════════════════════════
-- Xoá tài khoản KHÔNG làm sổ bên kia mất đơn và kết nối (quyết định 18/10/2026)
--
-- THUMUA365 là sổ sách thay giấy CHO VỰA; nông dân chỉ vào xem. Trước đây nông dân xoá tài khoản
-- là đơn, lịch sử đơn và kết nối phía vựa mất theo. Nay tổ chức bị xoá chỉ được GỠ khỏi đơn và kết
-- nối mà bên kia còn sổ (`account-deletion.service.ts` quyết định giữ hay xoá):
--
--   A. (Prisma) orders.buyer_org_id, orders.created_by_org_id cho phép null; khoá ngoại ON DELETE
--      SET NULL như seller_org_id đã có.
--   B. (Viết tay)
--     1. orders_guard — hai bên của đơn vẫn không đổi được, trừ một việc: gỡ bên đã xoá về null.
--        Chỉ dưới quyền khác api_service (xoá tài khoản chạy bằng api_privileged; khoá ngoại SET
--        NULL chạy bằng chủ bảng). Chỉ gỡ mà không chuyển trạng thái thì không tăng version.
--     2. partner_links_guard — bên được liên kết chỉ gỡ về null được khi kết nối CŨNG thành
--        revoked trong cùng câu lệnh, cũng chỉ dưới quyền khác api_service. Kết nối đang sống mà
--        tổ chức bị xoá đi đường khác thì khoá ngoại SET NULL bị chặn — hỏng to, không lặng lẽ.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── A. Prisma ──────────────────────────────────────────────────────────────

-- DropForeignKey
ALTER TABLE "orders" DROP CONSTRAINT "orders_buyer_org_id_fkey";

-- DropForeignKey
ALTER TABLE "orders" DROP CONSTRAINT "orders_created_by_org_id_fkey";

-- AlterTable
ALTER TABLE "orders" ALTER COLUMN "buyer_org_id" DROP NOT NULL,
ALTER COLUMN "created_by_org_id" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_buyer_org_id_fkey" FOREIGN KEY ("buyer_org_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_created_by_org_id_fkey" FOREIGN KEY ("created_by_org_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── B1. Luật của đơn ───────────────────────────────────────────────────────
-- Như bản BE5, khác ở khối "hai bên của đơn".

create or replace function public.orders_guard()
returns trigger
language plpgsql
as $$
declare
  v_detach boolean;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'submitted' or new.version <> 1 then
      raise exception 'Đơn mới luôn ở trạng thái submitted, version 1' using errcode = 'check_violation';
    end if;
    if new.seller_org_id is not distinct from new.buyer_org_id then
      raise exception 'Bên bán và bên mua phải là hai tổ chức khác nhau' using errcode = 'check_violation';
    end if;
    -- Hai cột này hết NOT NULL chỉ để gỡ bên đã xoá tài khoản — đơn mới vẫn bắt buộc có.
    if new.buyer_org_id is null or new.created_by_org_id is null then
      raise exception 'Đơn mới phải có bên mua và bên tạo đơn' using errcode = 'check_violation';
    end if;
    if new.created_by_org_id is distinct from new.seller_org_id
       and new.created_by_org_id is distinct from new.buyer_org_id then
      raise exception 'Bên tạo đơn phải là bên bán hoặc bên mua' using errcode = 'check_violation';
    end if;
    if current_user = 'api_service' and public.app_org_id() is distinct from new.created_by_org_id then
      raise exception 'Chỉ tạo đơn cho tổ chức đang làm việc' using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  -- Một cột tổ chức đổi thì chỉ được là: từ có giá trị về null (bên đó đã xoá tài khoản).
  if (new.seller_org_id is distinct from old.seller_org_id and new.seller_org_id is not null)
     or (new.buyer_org_id is distinct from old.buyer_org_id and new.buyer_org_id is not null)
     or (new.created_by_org_id is distinct from old.created_by_org_id and new.created_by_org_id is not null)
     or new.seller_partner_id is distinct from old.seller_partner_id
     or new.buyer_partner_id is distinct from old.buyer_partner_id
     or new.created_by <> old.created_by then
    raise exception 'Không đổi được hai bên của đơn' using errcode = 'check_violation';
  end if;
  v_detach := new.seller_org_id is distinct from old.seller_org_id
              or new.buyer_org_id is distinct from old.buyer_org_id
              or new.created_by_org_id is distinct from old.created_by_org_id;
  if v_detach and current_user = 'api_service' then
    raise exception 'Chỉ khi xoá tài khoản mới gỡ được một bên khỏi đơn' using errcode = 'insufficient_privilege';
  end if;
  -- Chỉ gỡ bên đã xoá (đơn đã xong / đã huỷ giữ nguyên trạng thái).
  if v_detach and new.status = old.status and new.version = old.version then
    return new;
  end if;

  if new.version <> old.version + 1 then
    raise exception 'Mỗi lần đổi đơn tăng version đúng 1' using errcode = 'check_violation';
  end if;
  if not (
    (old.status = 'submitted' and new.status in ('accepted', 'cancelled', 'fulfilled'))
    or (old.status = 'accepted' and new.status in ('scheduled', 'cancelled', 'fulfilled'))
    or (old.status = 'scheduled' and new.status in ('scheduled', 'cancelled', 'fulfilled'))
  ) then
    raise exception 'Không chuyển được đơn từ % sang %', old.status, new.status using errcode = 'check_violation';
  end if;
  if current_user = 'api_service' then
    if new.status = 'accepted' and public.app_org_id() is not distinct from new.created_by_org_id then
      raise exception 'Bên tạo đơn không tự nhận đơn của mình' using errcode = 'insufficient_privilege';
    end if;
    if new.status = 'scheduled' and public.app_org_id() is distinct from new.buyer_org_id then
      raise exception 'Chỉ bên mua hẹn lịch lấy hàng' using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end;
$$;

-- ─── B2. Luật của kết nối ───────────────────────────────────────────────────
-- Như bản mã kết nối (20261001000000), khác ở luật "bên được liên kết".

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
  -- Bên được liên kết đã gắn thì không đổi — trừ khi bên đó xoá tài khoản: gỡ về null, và kết nối
  -- thành revoked luôn (bên sổ thấy "đã ngừng kết nối", mời lại được bằng lời mời mới).
  if old.linked_org_id is not null and new.linked_org_id is distinct from old.linked_org_id
     and (new.linked_org_id is not null or new.status <> 'revoked' or current_user = 'api_service') then
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
