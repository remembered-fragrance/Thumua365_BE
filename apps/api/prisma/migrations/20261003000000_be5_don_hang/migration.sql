-- ═══════════════════════════════════════════════════════════════════════════
-- 0004 — Đơn hàng, đặt lịch, thông báo (BE5) · KH backend §1.5, §1.8, §4.1 mục 8
--
-- A. (Prisma) order_events.actor_org_id — tổ chức làm bước này, để lịch sử đơn nói được
--    "mình" hay "bên kia" (một người có thể thuộc nhiều tổ chức).
-- B. (Viết tay)
--   1. orders_guard — luật chuyển trạng thái, version, ai làm bước nào: ở database, không chỉ ở API
--   2. book_order_guard — phiếu/nháp chỉ gắn được đơn mà tổ chức đó là ĐÚNG bên. Khoá ngoại
--      transactions.order_id → orders được Postgres kiểm KHÔNG qua RLS (bài học BE3), và đơn là
--      thực thể của HAI tổ chức nên không dùng khoá ghép được — phải là trigger.
--   3. order_counterparts() — tên tổ chức bên kia của các đơn (RLS không cho đọc tổ chức khác)
--   4. notify_order(), notify_link() — thông báo cho bên kia, chỉ bên kia, của đúng đơn/kết nối
--   5. notifications.kind — tập giá trị trùng NOTIFICATION_KINDS của @mambo/contracts
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── A. Prisma ──────────────────────────────────────────────────────────────

ALTER TABLE "order_events" ADD COLUMN "actor_org_id" UUID;

-- Danh sách đơn và thông báo phân trang theo (created_at, id) với cursor là JS Date (mili-giây).
-- Cột micro-giây làm bản ghi cùng mili-giây với cuối trang bị bỏ sót — cùng lỗi BE3 đã sửa cho
-- updated_at của sổ. Bảng chưa có dữ liệu thật; làm tròn về mili-giây không mất gì.
ALTER TABLE "orders" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3);
ALTER TABLE "notifications" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3);

-- ─── 1. Luật của đơn ────────────────────────────────────────────────────────
--   submitted → accepted | cancelled | fulfilled
--   accepted  → scheduled | cancelled | fulfilled
--   scheduled → scheduled (hẹn lại) | cancelled | fulfilled
--   fulfilled, cancelled là cuối.
-- `fulfilled` từ mọi trạng thái còn mở: phiếu theo đơn là việc đã cân THẬT ngoài đời (KH §4.1).
-- Với api_service: chỉ bên NHẬN đơn nhận đơn; chỉ bên MUA hẹn lịch.

create or replace function public.orders_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'submitted' or new.version <> 1 then
      raise exception 'Đơn mới luôn ở trạng thái submitted, version 1' using errcode = 'check_violation';
    end if;
    if new.seller_org_id is not distinct from new.buyer_org_id then
      raise exception 'Bên bán và bên mua phải là hai tổ chức khác nhau' using errcode = 'check_violation';
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

  if new.seller_org_id is distinct from old.seller_org_id
     or new.buyer_org_id is distinct from old.buyer_org_id
     or new.seller_partner_id is distinct from old.seller_partner_id
     or new.buyer_partner_id is distinct from old.buyer_partner_id
     or new.created_by_org_id <> old.created_by_org_id
     or new.created_by <> old.created_by then
    raise exception 'Không đổi được hai bên của đơn' using errcode = 'check_violation';
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

create trigger orders_guard
  before insert or update on orders
  for each row execute function public.orders_guard();

-- ─── 2. Phiếu / nháp theo đơn ───────────────────────────────────────────────
-- Phiếu MUA gắn đơn mà tổ chức là bên mua; phiếu BÁN gắn đơn mà tổ chức là bên bán; nháp chưa
-- chọn chiều thì bên nào cũng được. Chạy với quyền người gọi: dưới api_service, RLS của orders
-- đã chỉ cho thấy đơn của tổ chức đang làm việc — điều kiện ở đây còn đúng cả khi RLS bị bỏ qua.

create or replace function public.book_order_guard()
returns trigger
language plpgsql
as $$
begin
  if new.order_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.order_id is not distinct from old.order_id then
    return new;
  end if;
  if not exists (
    select 1 from public.orders o
    where o.id = new.order_id
      and ((new.kind is distinct from 'sale' and o.buyer_org_id = new.organization_id)
        or (new.kind is distinct from 'purchase' and o.seller_org_id = new.organization_id))
  ) then
    raise exception 'Không có đơn này, hoặc tổ chức không phải đúng bên của đơn'
      using errcode = 'foreign_key_violation';
  end if;
  return new;
end;
$$;

create trigger transactions_order_guard
  before insert or update of order_id on transactions
  for each row execute function public.book_order_guard();

create trigger drafts_order_guard
  before insert or update of order_id on drafts
  for each row execute function public.book_order_guard();

-- ─── 3. Tên tổ chức bên kia ─────────────────────────────────────────────────
-- Chỉ trả tổ chức có CHUNG ít nhất một đơn với tổ chức đang làm việc.

create or replace function public.order_counterparts(p_orgs uuid[])
returns table (id uuid, name text, type text)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select g.id, g.name, g.type
  from public.organizations g
  where g.id = any(p_orgs)
    and public.app_org_id() is not null
    and exists (
      select 1 from public.orders o
      where (o.seller_org_id = public.app_org_id() and o.buyer_org_id = g.id)
         or (o.buyer_org_id = public.app_org_id() and o.seller_org_id = g.id)
    );
$$;

-- ─── 4. Thông báo cho bên kia ───────────────────────────────────────────────
-- Gọi trong ngữ cảnh của tổ chức GÂY RA việc (listener sau commit). Ghi một dòng vào
-- notifications của BÊN KIA — RLS chỉ cho ghi vào tổ chức đang làm việc, nên phải là security
-- definer; đổi lại chỉ ghi được cho đúng bên kia của một đơn/kết nối mà mình là một bên.
-- Payload chỉ mang id, trạng thái, lịch hẹn và tên tổ chức gây ra — không số tiền, không SĐT.

create or replace function public.notify_order(p_order uuid, p_kind text)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_org   uuid := public.app_org_id();
  v_order public.orders%rowtype;
  v_from  public.organizations%rowtype;
  v_to    uuid;
  v_id    uuid;
begin
  if v_org is null then
    raise exception 'notify_order cần app.org_id';
  end if;
  if p_kind not like 'order.%' then
    raise exception 'notify_order chỉ cho thông báo về đơn';
  end if;
  select * into v_order from public.orders
  where id = p_order and (seller_org_id = v_org or buyer_org_id = v_org);
  if not found then
    return null;
  end if;
  v_to := case when v_order.seller_org_id = v_org then v_order.buyer_org_id else v_order.seller_org_id end;
  if v_to is null then
    return null;
  end if;
  select * into v_from from public.organizations where id = v_org;

  insert into public.notifications (organization_id, kind, payload)
  values (v_to, p_kind, jsonb_build_object(
    'orderId', v_order.id,
    'orderStatus', v_order.status,
    'pickupAt', v_order.pickup_at,
    'fromOrgId', v_from.id,
    'fromOrgName', v_from.name,
    'fromOrgType', v_from.type))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.notify_link(p_link uuid, p_kind text)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_org  uuid := public.app_org_id();
  v_link public.partner_links%rowtype;
  v_from public.organizations%rowtype;
  v_to   uuid;
  v_id   uuid;
begin
  if v_org is null then
    raise exception 'notify_link cần app.org_id';
  end if;
  if p_kind not like 'link.%' then
    raise exception 'notify_link chỉ cho thông báo về kết nối';
  end if;
  select * into v_link from public.partner_links
  where id = p_link and (owner_org_id = v_org or linked_org_id = v_org);
  if not found then
    return null;
  end if;
  v_to := case when v_link.owner_org_id = v_org then v_link.linked_org_id else v_link.owner_org_id end;
  if v_to is null then
    return null;
  end if;
  select * into v_from from public.organizations where id = v_org;

  insert into public.notifications (organization_id, kind, payload)
  values (v_to, p_kind, jsonb_build_object(
    'linkId', v_link.id,
    'fromOrgId', v_from.id,
    'fromOrgName', v_from.name,
    'fromOrgType', v_from.type))
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.order_counterparts(uuid[]) from public;
revoke all on function public.notify_order(uuid, text) from public;
revoke all on function public.notify_link(uuid, text) from public;
grant execute on function public.order_counterparts(uuid[]) to api_service;
grant execute on function public.notify_order(uuid, text) to api_service;
grant execute on function public.notify_link(uuid, text) to api_service;

-- ─── 5. Loại thông báo ──────────────────────────────────────────────────────

alter table notifications add constraint notifications_kind_check
  check (kind in (
    'order.submitted', 'order.accepted', 'order.scheduled', 'order.cancelled', 'order.fulfilled',
    'link.accepted', 'link.revoked',
    'member.invited', 'member.role_changed',
    'plan.activated'));
