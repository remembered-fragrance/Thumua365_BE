-- ═══════════════════════════════════════════════════════════════════════════
-- 0.18.0 — rà soát đồng bộ, đơn, thanh toán
--
--   1. book_order_guard — xét lại cả khi đổi CHIỀU (kind) của phiếu/nháp đang gắn đơn, không chỉ khi
--      đổi order_id. Trước đây đổi nháp mua ↔ bán mà giữ đơn thì trigger không chạy: nháp mua gắn
--      được vào đơn mình là bên bán.
--   2. bank_transactions.outcome — mọi giao dịch ngân hàng mang mã chuyển khoản đều vào sổ đối soát,
--      kể cả khi KHÔNG gia hạn (ý định đã trả rồi, chuyển thiếu, không có ý định nào): trước đây chỉ
--      giao dịch đã gia hạn được ghi, khoản chuyển thừa / chuyển hai lần mất dấu khi đối soát tay.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1. Phiếu/nháp chỉ gắn đơn mà tổ chức là ĐÚNG bên — xét cả khi đổi chiều ─

create or replace function public.book_order_guard()
returns trigger
language plpgsql
as $$
begin
  if new.order_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and new.order_id is not distinct from old.order_id
     and new.kind is not distinct from old.kind then
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

drop trigger transactions_order_guard on transactions;
create trigger transactions_order_guard
  before insert or update of order_id, kind on transactions
  for each row execute function public.book_order_guard();

drop trigger drafts_order_guard on drafts;
create trigger drafts_order_guard
  before insert or update of order_id, kind on drafts
  for each row execute function public.book_order_guard();

-- ─── 2. Sổ đối soát ghi cả giao dịch không gia hạn ──────────────────────────
--   applied        đã mở / gia hạn gói
--   intent_closed  mã đúng nhưng ý định không còn chờ (đã trả, hết hạn) — chuyển hai lần, chuyển muộn
--   underpaid      chuyển thiếu — để đường thủ công
--   no_intent      có mã chuyển khoản nhưng không khớp ý định nào

ALTER TABLE "bank_transactions" ADD COLUMN "outcome" TEXT NOT NULL DEFAULT 'applied';

alter table bank_transactions add constraint bank_transactions_outcome_check
  check (outcome in ('applied', 'intent_closed', 'underpaid', 'no_intent'));
