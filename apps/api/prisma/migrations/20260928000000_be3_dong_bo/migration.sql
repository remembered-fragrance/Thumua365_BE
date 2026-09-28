-- ═══════════════════════════════════════════════════════════════════════════
-- 0002 — Đồng bộ sổ (BE3)
--
-- Hai phần:
--   A. (Prisma sinh) khoá ngoại ghép (bản ghi, tổ chức); updated_at của 8 bảng sổ
--      chính xác tới mili-giây
--   B. (viết tay) cấm khôi phục bản ghi đã xoá mềm; mặt hàng mặc định cho sổ đã có
--
-- Vì sao khoá ngoại ghép: khoá ngoại được Postgres kiểm KHÔNG qua RLS. Với khoá một
-- cột, tổ chức A gắn được lần trả vào phiếu của tổ chức B (đã thử được trên Postgres
-- ở máy trước khi sửa). Khoá (transaction_id, organization_id) → (id, organization_id)
-- buộc hai bên cùng tổ chức. Chi nhánh cũng vậy.
--
-- Migration này thay khoá ngoại cũ bằng khoá chặt hơn (bỏ + thêm trong một file) —
-- không phải bỏ cột hay đổi nghĩa, image API cũ chạy trên schema mới vẫn đúng.
-- Khoá chi nhánh cũ là ON DELETE SET NULL; khoá ghép không làm vậy được (sẽ đặt null
-- cả organization_id) ⇒ RESTRICT. Chi nhánh chỉ xoá mềm nên không đổi hành vi.
--
-- Vì sao updated_at mili-giây: cursor của /v1/sync/pull phân trang theo
-- (updated_at, id). JS Date chỉ có mili-giây; để micro-giây thì hai bản ghi khác nhau
-- trong cùng một mili-giây so sánh sai và trang sau lặp lại hoặc bỏ sót.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── A. Prisma sinh ─────────────────────────────────────────────────────────

-- DropForeignKey
ALTER TABLE "drafts" DROP CONSTRAINT "drafts_branch_id_fkey";

-- DropForeignKey
ALTER TABLE "memberships" DROP CONSTRAINT "memberships_branch_id_fkey";

-- DropForeignKey
ALTER TABLE "payments" DROP CONSTRAINT "payments_transaction_id_fkey";

-- DropForeignKey
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_branch_id_fkey";

-- AlterTable
ALTER TABLE "buyers" ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "drafts" ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "notes" ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "payments" ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "pricing_rules" ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "products" ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "suppliers" ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "transactions" ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3);

-- CreateIndex
CREATE UNIQUE INDEX "branches_id_organization_id_key" ON "branches"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_id_organization_id_key" ON "transactions"("id", "organization_id");

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_branch_id_organization_id_fkey" FOREIGN KEY ("branch_id", "organization_id") REFERENCES "branches"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_branch_id_organization_id_fkey" FOREIGN KEY ("branch_id", "organization_id") REFERENCES "branches"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_transaction_id_organization_id_fkey" FOREIGN KEY ("transaction_id", "organization_id") REFERENCES "transactions"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_branch_id_organization_id_fkey" FOREIGN KEY ("branch_id", "organization_id") REFERENCES "branches"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─── B1. Xoá thắng — ở database, không chỉ ở API ─────────────────────────────
-- Quy tắc chống mất tiền số 3. Trước migration này api_service đặt được
-- deleted_at = null (đã thử được trên Postgres ở máy): quy tắc chỉ còn nằm ở code API.
-- Giờ bản ghi đã xoá mềm KHÔNG sống lại và mốc xoá không đổi được, dù ai gọi.

create or replace function public.keep_soft_deleted()
returns trigger
language plpgsql
as $$
begin
  if old.deleted_at is not null and new.deleted_at is distinct from old.deleted_at then
    raise exception 'Bản ghi đã xoá mềm không khôi phục được (%.%)', tg_table_name, old.id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'suppliers', 'buyers', 'products', 'transactions', 'payments', 'drafts', 'pricing_rules', 'notes'
  ] loop
    execute format(
      'create trigger %I_keep_deleted before update on public.%I
       for each row execute function public.keep_soft_deleted()', t, t);
  end loop;
end;
$$;

-- ─── B2. Mặt hàng mặc định cho sổ đã có ────────────────────────────────────
-- Sổ mới trên máy khởi đầu bằng 4 mặt hàng DEFAULT_PRODUCTS của @mambo/core, id kiểu
-- `prod-rubber` — không phải UUID, không lên server được. Từ BE3, /v1/me/bootstrap
-- tạo sẵn 4 mặt hàng này (id do server sinh) cho vựa và doanh nghiệp; app nhận chúng
-- khi kéo về và gộp theo TÊN như normalize() của core vẫn làm. Đây là phần cho các
-- tổ chức đã đăng ký trước BE3. Tên, công thức, loại cây GIỐNG HỆT DEFAULT_PRODUCTS.

insert into products (id, organization_id, created_by, name, unit, formula_type, is_suggested, is_active, crop, quality_grades)
select gen_random_uuid(), o.id, o.created_by, d.name, 'kg', d.formula_type, true, true, d.crop, '{}'
from organizations o
cross join (values
  ('Cao su', 'rubberLatex', 'rubber'),
  ('Điều', 'netAfterTare', 'cashew'),
  ('Cà phê', 'netAfterTare', 'coffee'),
  ('Hồ tiêu', 'netAfterTare', 'pepper')
) as d (name, formula_type, crop)
where o.type in ('trader', 'enterprise')
  and o.deleted_at is null
  and not exists (
    select 1 from products p where p.organization_id = o.id and lower(p.name) = lower(d.name)
  );
