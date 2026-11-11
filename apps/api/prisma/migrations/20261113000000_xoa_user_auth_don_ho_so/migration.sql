-- 0.30.1 — xoá user THẲNG trong Supabase Auth (Dashboard, Admin API) cũng dọn hồ sơ như `DELETE /v1/me`.
--
-- Trước đây `profiles` không có khoá ngoại tới `auth.users`: xoá user ở Dashboard thì hồ sơ, tổ chức, sổ ở lại và
-- hồ sơ vẫn giữ `profiles.phone` (unique) ⇒ đăng ký lại cùng số thì bước "Bạn là ai?" báo "Số điện thoại đã gắn với
-- tài khoản khác".
--
-- `purge_deleted_user(uid)` làm đúng phần DỮ LIỆU của `AccountDeletionService` (apps/api/src/account/
-- account-deletion.service.ts — sửa bên này thì sửa bên kia): tổ chức mình là chủ bị xoá hẳn cùng sổ; đơn và kết
-- nối với tổ chức khác xét theo bên kia (`detachOrders`, `detachLinks`); hồ sơ bị xoá. Giữ lại, cố ý:
-- `bank_transactions`, `audit_log`, `admin_access_log`.
--
-- Khác luồng của app:
--   * Người làm thuê ở tổ chức khác: app bắt chủ gỡ trước (`STILL_MEMBER`); ở đây người xoá là quản trị viên ⇒ gỡ
--     luôn (membership → `removed`).
--   * Tổ chức mình là chủ còn người đang làm: DỪNG — lệnh xoá user báo lỗi, không xoá gì (như `ORG_HAS_MEMBERS`).
--   * Ảnh trên Storage KHÔNG xoá được bằng SQL (Supabase chặn xoá thẳng `storage.objects`): số ảnh còn lại ghi vào
--     `audit_log.after.photosLeft`, dọn bằng Storage API nếu cần.
--
-- `DELETE /v1/me` xoá hồ sơ TRƯỚC rồi mới xoá user ⇒ tới trigger thì không còn gì: hàm trả null, không ghi gì.
--
-- Dọn các hồ sơ mồ côi đã có (một lần, chạy tay — KHÔNG nằm trong migration để deploy không lặng lẽ xoá dữ liệu):
--   select p.id, public.purge_deleted_user(p.id, 'orphan_cleanup')
--   from public.profiles p where not exists (select 1 from auth.users u where u.id = p.id);

create or replace function public.purge_deleted_user(p_user uuid, p_source text default 'auth_trigger')
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owned    uuid[];
  v_left     uuid[];
  v_busy     uuid[];
  v_profile  boolean;
  v_org      record;
  v_id       uuid;
  v_branches uuid[];
  v_dropped  uuid[];
  v_other    uuid;
  v_partner  uuid;
  v_open     boolean;
  v_kept     int := 0;
  v_revoked  int := 0;
  v_photos   int := 0;
  v_after    jsonb;
  o          record;
  l          record;
begin
  if p_user is null then
    return null;
  end if;

  select coalesce(array_agg(organization_id) filter (where role = 'owner'), '{}'),
         coalesce(array_agg(organization_id) filter (where role <> 'owner'), '{}')
    into v_owned, v_left
  from memberships
  where user_id = p_user and status <> 'removed';
  v_profile := exists (select 1 from profiles where id = p_user);

  if not v_profile and cardinality(v_owned) = 0 and cardinality(v_left) = 0 then
    return null;
  end if;

  -- Khoá hàng tổ chức trước khi xét người làm: thêm membership phải chờ khoá này (như luồng của app).
  perform 1 from organizations where id = any(v_owned) for update;
  select coalesce(array_agg(distinct organization_id), '{}') into v_busy
  from memberships
  where organization_id = any(v_owned) and user_id <> p_user and status = 'active';
  if cardinality(v_busy) > 0 then
    raise exception 'Tổ chức % còn người đang làm — gỡ họ trong app trước rồi mới xoá tài khoản này', v_busy
      using errcode = 'check_violation';
  end if;

  -- `storage` chỉ có trên Supabase (Postgres ở máy dev không có).
  if to_regclass('storage.objects') is not null then
    execute 'select count(*) from storage.objects where bucket_id = ''attachments'' and split_part(name, ''/'', 1) = any($1)'
      into v_photos using v_owned::text[];
  end if;

  foreach v_id in array v_owned loop
    select id, name, type into v_org from organizations where id = v_id;

    -- Sổ.
    delete from payments where organization_id = v_id;
    delete from transactions where organization_id = v_id;
    delete from drafts where organization_id = v_id;
    delete from notes where organization_id = v_id;
    delete from season_contracts where organization_id = v_id;
    delete from pricing_rules where organization_id = v_id;
    delete from products where organization_id = v_id;
    delete from suppliers where organization_id = v_id;
    delete from buyers where organization_id = v_id;
    delete from sync_ops where organization_id = v_id;

    -- Đơn (`detachOrders`): giữ khi bên kia còn, có sổ và có dòng danh bạ ứng với tổ chức này; còn lại xoá.
    select coalesce(array_agg(id), '{}') into v_branches from branches where organization_id = v_id;
    v_dropped := '{}';
    for o in
      select * from orders where seller_org_id = v_id or buyer_org_id = v_id or created_by_org_id = v_id
    loop
      v_other := case when o.seller_org_id = v_id then o.buyer_org_id else o.seller_org_id end;
      v_partner := case when o.seller_org_id = v_id then o.seller_partner_id else o.buyer_partner_id end;
      if v_other is not null and v_partner is not null and exists (
        select 1 from organizations g where g.id = v_other and g.deleted_at is null and g.type <> 'farmer'
      ) then
        v_open := o.status in ('submitted', 'accepted', 'scheduled');
        update orders set
          seller_org_id     = case when seller_org_id = v_id then null else seller_org_id end,
          buyer_org_id      = case when buyer_org_id = v_id then null else buyer_org_id end,
          created_by_org_id = case when created_by_org_id = v_id then null else created_by_org_id end,
          branch_id         = case when branch_id = any(v_branches) then null else branch_id end,
          status            = case when v_open then 'cancelled' else status end,
          version           = case when v_open then version + 1 else version end
        where id = o.id;
        if v_open then
          insert into order_events (order_id, from_status, to_status, actor_user_id, actor_org_id, note)
          values (o.id, o.status, 'cancelled', p_user, v_id, 'Bên kia đã xoá tài khoản — đơn tự huỷ');
          insert into notifications (organization_id, kind, payload)
          values (v_other, 'order.cancelled', jsonb_build_object(
            'orderId', o.id,
            'orderStatus', 'cancelled',
            'pickupAt', to_char(o.pickup_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
            'fromOrgId', v_id,
            'fromOrgName', v_org.name,
            'fromOrgType', v_org.type));
        end if;
        v_kept := v_kept + 1;
      else
        v_dropped := v_dropped || o.id;
      end if;
    end loop;
    delete from order_events where order_id = any(v_dropped);
    delete from orders where id = any(v_dropped);

    -- Kết nối (`detachLinks`): sổ của tổ chức này ⇒ xoá, báo bên được xem; tổ chức này là bên được xem ⇒ revoked.
    for l in
      select id, linked_org_id from partner_links
      where owner_org_id = v_id and status = 'active' and linked_org_id is not null
    loop
      insert into notifications (organization_id, kind, payload)
      values (l.linked_org_id, 'link.revoked', jsonb_build_object(
        'linkId', l.id, 'fromOrgId', v_id, 'fromOrgName', v_org.name, 'fromOrgType', v_org.type));
    end loop;
    delete from partner_links where owner_org_id = v_id;

    for l in
      select id, owner_org_id, status from partner_links where linked_org_id = v_id and status <> 'revoked'
    loop
      update partner_links
      set status = 'revoked', linked_org_id = null, decided_by = p_user, decided_at = now()
      where id = l.id;
      v_revoked := v_revoked + 1;
      if l.status = 'active' then
        insert into notifications (organization_id, kind, payload)
        values (l.owner_org_id, 'link.revoked', jsonb_build_object(
          'linkId', l.id, 'fromOrgId', v_id, 'fromOrgName', v_org.name, 'fromOrgType', v_org.type));
      end if;
    end loop;
    update partner_links set linked_org_id = null where linked_org_id = v_id;

    -- Hệ thống của tổ chức.
    delete from notifications where organization_id = v_id;
    delete from payment_intents where organization_id = v_id;
    delete from promo_codes where organization_id = v_id;
    delete from subscriptions where organization_id = v_id;
    delete from organization_features where organization_id = v_id;
    delete from memberships where organization_id = v_id;
    delete from places where organization_id = v_id;
    delete from branches where organization_id = v_id;
    delete from organizations where id = v_id;
  end loop;

  update memberships set status = 'removed' where user_id = p_user and status <> 'removed';
  delete from notifications where user_id = p_user;
  delete from feedback where user_id = p_user;
  delete from profiles where id = p_user;

  v_after := jsonb_build_object(
    'source', p_source,
    'deletedOrganizations', to_jsonb(v_owned),
    'leftOrganizations', to_jsonb(v_left),
    'keptOrders', v_kept,
    'revokedLinks', v_revoked,
    'photosLeft', v_photos);
  insert into audit_log (organization_id, actor_user_id, action, entity, entity_id, after)
  values (null, p_user, 'account.deleted', 'user', p_user::text, v_after);
  return v_after;
end;
$$;

-- Chỉ trigger và người vận hành (postgres) gọi — không ai qua PostgREST / API.
revoke all on function public.purge_deleted_user(uuid, text) from public;
revoke all on function public.purge_deleted_user(uuid, text) from anon, authenticated;

create or replace function public.on_auth_user_deleted()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.purge_deleted_user(old.id, 'auth_trigger');
  return old;
end;
$$;

revoke all on function public.on_auth_user_deleted() from public;
revoke all on function public.on_auth_user_deleted() from anon, authenticated;

-- AFTER DELETE: lỗi trong hàm (tổ chức còn người làm) huỷ luôn lệnh xoá user — không có nửa chừng.
-- `auth.users` chỉ có trên Supabase; Postgres ở máy dev bỏ qua (gọi thẳng `purge_deleted_user` để test).
do $$
begin
  if to_regclass('auth.users') is not null then
    execute 'create or replace trigger on_auth_user_deleted after delete on auth.users '
            'for each row execute function public.on_auth_user_deleted()';
  else
    raise notice 'on_auth_user_deleted: không có auth.users — bỏ qua trigger';
  end if;
end;
$$;
