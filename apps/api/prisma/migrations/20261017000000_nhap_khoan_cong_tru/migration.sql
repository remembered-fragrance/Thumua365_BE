-- ═══════════════════════════════════════════════════════════════════════════
-- Nháp giữ khoản cộng/trừ (tiền xe, chiết khấu…)
--
-- Trước đây khoản cộng/trừ chỉ có ở phiếu đã chốt: nháp chuyển khách hay "Để dành" là mất.
-- Cột mới cùng hình dạng transactions.adjustments (JSONB, camelCase bên trong). Cột trống được,
-- không default — thêm cột không viết lại bảng, nháp cũ đọc ra NULL = chưa có khoản nào.
--
--   A. (Prisma sinh, `prisma migrate diff`) cột — khớp schema.prisma.
--   B. (viết tay) CHECK — hình dạng chi tiết do @mambo/contracts kiểm (DraftInsert / DraftPatch).
--
-- Quyền: api_service, backup_reader đã có quyền trên cả bảng drafts — cột mới đi theo.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── A. Cột (Prisma sinh) ───────────────────────────────────────────────────

-- AlterTable
ALTER TABLE "drafts" ADD COLUMN     "adjustments" JSONB;

-- ─── B. Viết tay ────────────────────────────────────────────────────────────

-- Mảng, tối đa 20 khoản — như contracts. Ghi thẳng vào DB sai hình dạng thì bị chặn ở đây.
-- CASE chứ không AND: Postgres không hứa thứ tự tính, jsonb_array_length trên số/chuỗi là lỗi.
alter table drafts add constraint drafts_adjustments_check
  check (
    adjustments is null
    or case when jsonb_typeof(adjustments) = 'array' then jsonb_array_length(adjustments) <= 20 else false end
  );
