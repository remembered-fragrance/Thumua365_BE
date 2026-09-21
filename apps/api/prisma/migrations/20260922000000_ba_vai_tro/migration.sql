-- ═══════════════════════════════════════════════════════════════════════════
-- 0001 — Ba vai trò (BE2)
--
-- Baseline: 10 migration cũ của repo frontend (supabase/migrations/0001–0010,
-- chưa từng chạy ở đâu) + toàn bộ schema ba vai trò (KH backend §1.3).
-- Từ file này, Prisma Migrate là nơi duy nhất sửa schema.
--
-- Ba phần:
--   A. (viết tay) extension, role, hàm hạ tầng — bảng cần chúng
--   B. (Prisma sinh) bảng, khoá, index — khớp schema.prisma
--   C. (viết tay) CHECK, index một phần, trigger, quyền, RLS, hàm security definer
--
-- Những gì của bản cũ KHÔNG mang sang, và vì sao:
--   - khoá ngoại sang auth.users: database không phụ thuộc schema của Supabase Auth
--   - has_active_sync() + policy ghi theo gói: chặn gói ở API khi đồng bộ (BE3)
--   - start_trial(): /v1/me/bootstrap tạo gói dùng thử trong cùng transaction
--   - resolve_identifier() trả email: thay bằng find_login_user() trả id (API đọc
--     email qua Auth Admin API)
--   - delete_own_account(), policy Storage: làm lại ở BE6, BE8
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── A. Nền ─────────────────────────────────────────────────────────────────

-- Supabase đặt extension trong schema `extensions`. Postgres ở máy dev dựng lại
-- đúng như vậy (prisma/dev/00_supabase_shim.sql).
set search_path to "$user", public, extensions;

create extension if not exists citext with schema extensions;
create extension if not exists postgis with schema extensions;

-- Hai role API dùng. Tạo NOLOGIN; mật khẩu đặt riêng bằng `npm run db:role-password`
-- — mật khẩu không bao giờ nằm trong migration.
--
--   api_service    — mọi request. KHÔNG có BYPASSRLS: quên lọc orgId vẫn bị RLS chặn.
--   api_privileged — chỉ webhook ngân hàng, AdminModule, xoá tài khoản (BE6).
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'api_service') then
    create role api_service nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'api_privileged') then
    create role api_privileged nologin noinherit bypassrls;
  end if;
end;
$$;

-- updated_at tự cập nhật. Trigger CHỈ làm việc hạ tầng — nghiệp vụ ở @mambo/core.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- 0905112233 · 0905 112 233 · +84 905 112 233 · 84905112233 → +84905112233.
-- Cùng luật với normalizePhone() của @mambo/core/identifier.
create or replace function public.normalize_phone(raw text)
returns text
language plpgsql
immutable
as $$
declare
  digits text;
begin
  if raw is null then
    return null;
  end if;

  digits := regexp_replace(raw, '[^0-9+]', '', 'g');
  digits := regexp_replace(digits, '^\+', '', 'g');

  if digits ~ '^84[0-9]{8,10}$' then
    return '+' || digits;
  elsif digits ~ '^0[0-9]{8,10}$' then
    return '+84' || substring(digits from 2);
  end if;

  return null;
end;
$$;

-- ─── B. Bảng (Prisma sinh) ──────────────────────────────────────────────────


-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "address" TEXT,
    "location" geography(Point, 4326),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "location" geography(Point, 4326),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "branch_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "trial_ends_at" TIMESTAMPTZ(6),
    "current_period_end" TIMESTAMPTZ(6),
    "branch_limit" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_features" (
    "organization_id" UUID NOT NULL,
    "feature" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_features_pkey" PRIMARY KEY ("organization_id","feature")
);

-- CreateTable
CREATE TABLE "profiles" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "username" CITEXT,
    "phone" TEXT,
    "recovery_email" CITEXT,
    "referral_code" CITEXT,
    "referred_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_links" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "owner_org_id" UUID NOT NULL,
    "partner_kind" TEXT NOT NULL,
    "partner_id" UUID NOT NULL,
    "linked_org_id" UUID,
    "invited_phone" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "seller_org_id" UUID,
    "seller_partner_id" UUID,
    "buyer_org_id" UUID NOT NULL,
    "buyer_partner_id" UUID,
    "created_by_org_id" UUID NOT NULL,
    "created_by" UUID NOT NULL,
    "product_id" UUID,
    "crop" TEXT,
    "est_quantity" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'kg',
    "offered_price" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'submitted',
    "pickup_at" TIMESTAMPTZ(6),
    "pickup_address" TEXT,
    "branch_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "from_status" TEXT,
    "to_status" TEXT NOT NULL,
    "actor_user_id" UUID,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "created_by" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "location" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buyers" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "created_by" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "location" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "buyers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "created_by" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'kg',
    "formula_type" TEXT NOT NULL,
    "is_suggested" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "crop" TEXT,
    "last_price_per_unit" DOUBLE PRECISION,
    "group" TEXT,
    "quality_grades" TEXT[],
    "track_inventory" BOOLEAN,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID,
    "order_id" UUID,
    "created_by" UUID NOT NULL,
    "date" TIMESTAMPTZ(6) NOT NULL,
    "kind" TEXT NOT NULL,
    "counterparty_id" UUID,
    "supplier_id" TEXT,
    "supplier_name" TEXT NOT NULL,
    "lines" JSONB NOT NULL,
    "credit_terms" JSONB,
    "adjustments" JSONB,
    "attachment_ids" TEXT[],
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "created_by" UUID NOT NULL,
    "date" TIMESTAMPTZ(6) NOT NULL,
    "amount" BIGINT NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drafts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID,
    "order_id" UUID,
    "created_by" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "kind" TEXT,
    "counterparty_id" UUID,
    "supplier_id" TEXT,
    "supplier_name" TEXT NOT NULL DEFAULT '',
    "lines" JSONB NOT NULL DEFAULT '[]',
    "amount_paid" BIGINT NOT NULL DEFAULT 0,
    "note" TEXT,
    "attachment_ids" TEXT[],
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_rules" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "created_by" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "product_id" UUID,
    "fixed_amount" BIGINT,
    "percent_of_total" DOUBLE PRECISION,
    "min_weight_kg" DOUBLE PRECISION,
    "applies_on_pickup" BOOLEAN,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "pricing_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notes" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "created_by" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_ops" (
    "op_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "seq" BIGINT NOT NULL,
    "kind" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "record_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_ops_pkey" PRIMARY KEY ("op_id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "user_id" UUID,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "read_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID,
    "org_type" TEXT,
    "anon_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "props" JSONB NOT NULL DEFAULT '{}',
    "app_version" TEXT,
    "platform" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID,
    "actor_user_id" UUID,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" TEXT,
    "before" JSONB,
    "after" JSONB,
    "request_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_transactions" (
    "bank_tx_id" TEXT NOT NULL,
    "organization_id" UUID,
    "payment_intent_id" UUID,
    "amount" BIGINT NOT NULL,
    "description" TEXT,
    "source" TEXT NOT NULL DEFAULT 'webhook',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_transactions_pkey" PRIMARY KEY ("bank_tx_id")
);

-- CreateTable
CREATE TABLE "payment_intents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "subscription_id" UUID,
    "created_by" UUID NOT NULL,
    "amount" BIGINT NOT NULL,
    "status" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_ref" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "payment_intents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_access_log" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID,
    "user_id" UUID,
    "action" TEXT NOT NULL,
    "operator" TEXT NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_access_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "branches_organization_id_idx" ON "branches"("organization_id");

-- CreateIndex
CREATE INDEX "memberships_organization_id_idx" ON "memberships"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_user_id_organization_id_key" ON "memberships"("user_id", "organization_id");

-- CreateIndex
CREATE INDEX "subscriptions_organization_id_idx" ON "subscriptions"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "profiles_username_key" ON "profiles"("username");

-- CreateIndex
CREATE UNIQUE INDEX "profiles_phone_key" ON "profiles"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "profiles_referral_code_key" ON "profiles"("referral_code");

-- CreateIndex
CREATE INDEX "profiles_referred_by_idx" ON "profiles"("referred_by");

-- CreateIndex
CREATE INDEX "partner_links_owner_org_id_idx" ON "partner_links"("owner_org_id");

-- CreateIndex
CREATE INDEX "partner_links_linked_org_id_idx" ON "partner_links"("linked_org_id");

-- CreateIndex
CREATE INDEX "orders_seller_org_id_status_idx" ON "orders"("seller_org_id", "status");

-- CreateIndex
CREATE INDEX "orders_buyer_org_id_status_idx" ON "orders"("buyer_org_id", "status");

-- CreateIndex
CREATE INDEX "order_events_order_id_created_at_idx" ON "order_events"("order_id", "created_at");

-- CreateIndex
CREATE INDEX "suppliers_organization_id_updated_at_idx" ON "suppliers"("organization_id", "updated_at");

-- CreateIndex
CREATE INDEX "buyers_organization_id_updated_at_idx" ON "buyers"("organization_id", "updated_at");

-- CreateIndex
CREATE INDEX "products_organization_id_updated_at_idx" ON "products"("organization_id", "updated_at");

-- CreateIndex
CREATE INDEX "transactions_organization_id_date_idx" ON "transactions"("organization_id", "date" DESC);

-- CreateIndex
CREATE INDEX "transactions_organization_id_updated_at_idx" ON "transactions"("organization_id", "updated_at");

-- CreateIndex
CREATE INDEX "transactions_organization_id_counterparty_id_idx" ON "transactions"("organization_id", "counterparty_id");

-- CreateIndex
CREATE INDEX "payments_transaction_id_idx" ON "payments"("transaction_id");

-- CreateIndex
CREATE INDEX "payments_organization_id_updated_at_idx" ON "payments"("organization_id", "updated_at");

-- CreateIndex
CREATE INDEX "drafts_organization_id_updated_at_idx" ON "drafts"("organization_id", "updated_at");

-- CreateIndex
CREATE INDEX "pricing_rules_organization_id_updated_at_idx" ON "pricing_rules"("organization_id", "updated_at");

-- CreateIndex
CREATE INDEX "notes_organization_id_updated_at_idx" ON "notes"("organization_id", "updated_at");

-- CreateIndex
CREATE INDEX "sync_ops_organization_id_created_at_idx" ON "sync_ops"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "notifications_organization_id_created_at_idx" ON "notifications"("organization_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "analytics_events_name_created_at_idx" ON "analytics_events"("name", "created_at");

-- CreateIndex
CREATE INDEX "audit_log_organization_id_created_at_idx" ON "audit_log"("organization_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "payment_intents_organization_id_created_at_idx" ON "payment_intents"("organization_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "admin_access_log_user_id_created_at_idx" ON "admin_access_log"("user_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_features" ADD CONSTRAINT "organization_features_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_links" ADD CONSTRAINT "partner_links_owner_org_id_fkey" FOREIGN KEY ("owner_org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_links" ADD CONSTRAINT "partner_links_linked_org_id_fkey" FOREIGN KEY ("linked_org_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_seller_org_id_fkey" FOREIGN KEY ("seller_org_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_buyer_org_id_fkey" FOREIGN KEY ("buyer_org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_created_by_org_id_fkey" FOREIGN KEY ("created_by_org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyers" ADD CONSTRAINT "buyers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_ops" ADD CONSTRAINT "sync_ops_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ─── C1. Giá trị hợp lệ ─────────────────────────────────────────────────────
-- Tập giá trị trùng với zod trong @mambo/contracts. Chặn ở database, không tin
-- riêng tầng ứng dụng.

alter table organizations add constraint organizations_type_check
  check (type in ('farmer', 'trader', 'enterprise'));
alter table memberships add constraint memberships_role_check
  check (role in ('owner', 'manager', 'staff'));
alter table memberships add constraint memberships_status_check
  check (status in ('invited', 'active', 'removed'));
alter table subscriptions add constraint subscriptions_status_check
  check (status in ('trialing', 'active', 'past_due', 'canceled'));
alter table subscriptions add constraint subscriptions_branch_limit_check
  check (branch_limit is null or branch_limit > 0);
alter table organization_features add constraint organization_features_feature_check
  check (feature in ('orders', 'links'));
alter table profiles add constraint profiles_phone_normalized
  check (phone is null or phone = public.normalize_phone(phone));

alter table partner_links add constraint partner_links_kind_check
  check (partner_kind in ('supplier', 'buyer'));
alter table partner_links add constraint partner_links_status_check
  check (status in ('pending', 'active', 'revoked'));
alter table partner_links add constraint partner_links_not_self
  check (linked_org_id is null or linked_org_id <> owner_org_id);
alter table orders add constraint orders_status_check
  check (status in ('submitted', 'accepted', 'scheduled', 'fulfilled', 'cancelled'));
alter table orders add constraint orders_quantity_check
  check (est_quantity > 0);
alter table orders add constraint orders_two_sides
  check (seller_org_id is not null or seller_partner_id is not null);

alter table transactions add constraint transactions_kind_check
  check (kind in ('purchase', 'sale'));
alter table payments add constraint payments_amount_check
  check (amount > 0);
alter table drafts add constraint drafts_status_check
  check (status in ('draft', 'waiting'));
alter table drafts add constraint drafts_kind_check
  check (kind is null or kind in ('purchase', 'sale'));
alter table products add constraint products_formula_check
  check (formula_type in ('standard', 'netAfterTare', 'rubberLatex', 'lossPercent'));
alter table products add constraint products_crop_check
  check (crop is null or crop in ('rubber', 'cashew', 'coffee', 'pepper'));
alter table pricing_rules add constraint pricing_rules_kind_check
  check (kind in ('logistics', 'volumeDiscount', 'manual'));
alter table sync_ops add constraint sync_ops_kind_check
  check (kind in ('insert', 'update', 'softDelete'));
alter table payment_intents add constraint payment_intents_amount_check
  check (amount > 0);
alter table payment_intents add constraint payment_intents_status_check
  check (status in ('pending', 'paid', 'failed', 'expired'));

-- ─── C2. Duy nhất có điều kiện ──────────────────────────────────────────────

-- Mỗi tổ chức một gói đang sống.
create unique index subscriptions_one_per_org
  on subscriptions (organization_id) where deleted_at is null;

-- Một dòng danh bạ chỉ nối với MỘT tổ chức tại một thời điểm.
create unique index partner_links_one_live
  on partner_links (owner_org_id, partner_kind, partner_id) where status <> 'revoked';

-- Hai ý định trả tiền đang chờ mà trùng mã thì webhook không biết cộng cho ai.
create unique index payment_intents_ref_pending
  on payment_intents (provider_ref) where status = 'pending' and deleted_at is null;

-- ─── C3. Trigger ────────────────────────────────────────────────────────────

do $$
declare
  t text;
begin
  foreach t in array array[
    'organizations', 'branches', 'memberships', 'subscriptions', 'profiles',
    'partner_links', 'orders',
    'suppliers', 'buyers', 'products', 'transactions', 'payments', 'drafts',
    'pricing_rules', 'notes', 'payment_intents'
  ] loop
    execute format(
      'create trigger %I_touch before update on public.%I
       for each row execute function public.touch_updated_at()', t, t);
  end loop;
end;
$$;

-- Mã giới thiệu (mang từ 0009 cũ). Mã do DATABASE đặt, không nhận từ client —
-- để client tự chọn là mở đường chiếm mã dễ đọc của người khác. Bảng chữ bỏ
-- 0/O/1/I/L vì mã được đọc qua điện thoại và chép tay ngoài chợ.
create or replace function public.new_referral_code()
returns text
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  candidate text;
begin
  loop
    candidate := '';
    for _ in 1..6 loop
      candidate := candidate || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.profiles p where p.referral_code = candidate);
  end loop;
  return candidate;
end;
$$;

-- security definer: api_service không có quyền gọi new_referral_code() trực tiếp,
-- và việc dò trùng mã phải nhìn được hồ sơ của mọi người.
create or replace function public.set_referral_code()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  new.referral_code := public.new_referral_code();
  new.referred_by := null;
  return new;
end;
$$;

create trigger profiles_referral_code
  before insert on profiles
  for each row execute function public.set_referral_code();

-- ─── C4. Ngữ cảnh phiên cho RLS ─────────────────────────────────────────────
-- API mở MỖI request một transaction và chạy
--   select set_config('app.user_id', $1, true), set_config('app.org_id', $2, true)
-- (`true` = chỉ trong transaction đó — an toàn với Transaction pooler).
-- Chưa đặt thì hai hàm trả NULL ⇒ mọi policy so sánh ra NULL ⇒ không thấy gì.

create or replace function public.app_user_id()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('app.user_id', true), '')::uuid;
$$;

create or replace function public.app_org_id()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('app.org_id', true), '')::uuid;
$$;

-- Người đang gọi có đang là thành viên active của `org` không. Chạy với quyền
-- người gọi — tự nó cũng đi qua RLS của memberships (thấy hàng của chính mình).
create or replace function public.app_is_member(org uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from public.memberships m
    where m.organization_id = org
      and m.user_id = public.app_user_id()
      and m.status = 'active'
  );
$$;

-- ─── C5. Quyền ──────────────────────────────────────────────────────────────
-- Mặc định ĐÓNG: bảng mới ở migration sau không ai đọc được cho tới khi được
-- cấp quyền ở chính migration đó.

-- Supabase cấp sẵn mọi quyền cho anon/authenticated trên bảng mới trong public.
-- App không đọc DB trực tiếp (Data API đã tắt) — thu hồi hết, cả mặc định về sau.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on all tables in schema public from anon, authenticated;
    revoke all on all sequences in schema public from anon, authenticated;
    revoke all on all functions in schema public from anon, authenticated;
    alter default privileges in schema public revoke all on tables from anon, authenticated;
    alter default privileges in schema public revoke all on sequences from anon, authenticated;
    alter default privileges in schema public revoke all on functions from anon, authenticated;
  end if;
end;
$$;

-- Hàm mặc định ai cũng gọi được (PUBLIC). Hàm security definer phải thu hồi.
-- (Hàm trigger vẫn chạy khi trigger bắn — Postgres không kiểm EXECUTE lúc đó.)
revoke all on function public.new_referral_code() from public;
revoke all on function public.set_referral_code() from public;

grant usage on schema public to api_service, api_privileged;
grant usage on schema extensions to api_service, api_privileged;

-- api_service: đọc, thêm, sửa. KHÔNG có DELETE ở bảng nào — xoá là xoá mềm.
grant select, insert, update on
  organizations, branches, memberships, subscriptions, organization_features, profiles,
  partner_links, orders,
  suppliers, buyers, products, transactions, drafts, pricing_rules, notes,
  sync_ops, notifications, payment_intents
to api_service;

-- Chỉ ghi thêm. Lần trả tiền: sửa được ĐÚNG cột deleted_at (huỷ) — không bao giờ
-- sửa số tiền. (updated_at do trigger đặt, không cần quyền trên cột.)
grant select, insert on payments, order_events, audit_log to api_service;
grant update (deleted_at) on payments to api_service;
grant insert on analytics_events to api_service;
-- bank_transactions, admin_access_log: api_service không có quyền gì.

grant select, insert, update, delete on all tables in schema public to api_privileged;

-- ─── C6. RLS ────────────────────────────────────────────────────────────────
-- Lớp bảo vệ THỨ HAI (lớp một là guard của NestJS). Bắt đúng lỗi "repository
-- quên lọc orgId": api_service không bypass RLS, nên truy vấn thiếu điều kiện
-- vẫn chỉ thấy dữ liệu của tổ chức trong app.org_id.

do $$
declare
  t text;
begin
  foreach t in array array[
    'organizations', 'branches', 'memberships', 'subscriptions', 'organization_features',
    'profiles', 'partner_links', 'orders', 'order_events',
    'suppliers', 'buyers', 'products', 'transactions', 'payments', 'drafts',
    'pricing_rules', 'notes', 'sync_ops', 'notifications', 'analytics_events',
    'audit_log', 'bank_transactions', 'payment_intents', 'admin_access_log'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end;
$$;

-- Sổ và dữ liệu riêng của một tổ chức: chỉ tổ chức trong app.org_id.
do $$
declare
  t text;
begin
  foreach t in array array[
    'suppliers', 'buyers', 'products', 'transactions', 'payments', 'drafts',
    'pricing_rules', 'notes', 'sync_ops', 'notifications', 'payment_intents'
  ] loop
    execute format(
      'create policy org_rows on public.%I for all to api_service
       using (organization_id = public.app_org_id())
       with check (organization_id = public.app_org_id())', t);
  end loop;
end;
$$;

-- Tổ chức, chi nhánh, gói, tính năng: ĐỌC được ở mọi tổ chức mình là thành viên
-- (GET /v1/me liệt kê tất cả); GHI chỉ ở tổ chức trong app.org_id.
create policy org_read on organizations for select to api_service
  using (id = public.app_org_id() or public.app_is_member(id));
create policy org_insert on organizations for insert to api_service
  with check (id = public.app_org_id());
create policy org_update on organizations for update to api_service
  using (id = public.app_org_id()) with check (id = public.app_org_id());

do $$
declare
  t text;
begin
  foreach t in array array['branches', 'subscriptions', 'organization_features'] loop
    execute format(
      'create policy member_read on public.%I for select to api_service
       using (organization_id = public.app_org_id() or public.app_is_member(organization_id))', t);
    execute format(
      'create policy org_insert on public.%I for insert to api_service
       with check (organization_id = public.app_org_id())', t);
    execute format(
      'create policy org_update on public.%I for update to api_service
       using (organization_id = public.app_org_id())
       with check (organization_id = public.app_org_id())', t);
  end loop;
end;
$$;

-- Membership: thấy của chính mình (để biết mình thuộc đâu) và của tổ chức đang làm việc.
create policy own_or_org_read on memberships for select to api_service
  using (user_id = public.app_user_id() or organization_id = public.app_org_id());
create policy org_insert on memberships for insert to api_service
  with check (organization_id = public.app_org_id());
create policy org_update on memberships for update to api_service
  using (organization_id = public.app_org_id())
  with check (organization_id = public.app_org_id());

-- Hồ sơ: chỉ của chính mình.
create policy own_profile on profiles for all to api_service
  using (id = public.app_user_id()) with check (id = public.app_user_id());

-- Kết nối: hai bên đều thấy; người được liên kết thấy ở mọi tổ chức mình thuộc
-- (đếm lời mời chờ trong /v1/me).
create policy link_read on partner_links for select to api_service
  using (owner_org_id = public.app_org_id()
         or linked_org_id = public.app_org_id()
         or public.app_is_member(linked_org_id));
create policy link_write on partner_links for insert to api_service
  with check (owner_org_id = public.app_org_id() or linked_org_id = public.app_org_id());
create policy link_update on partner_links for update to api_service
  using (owner_org_id = public.app_org_id() or linked_org_id = public.app_org_id())
  with check (owner_org_id = public.app_org_id() or linked_org_id = public.app_org_id());

-- Đơn: hai bên mua và bán.
create policy order_sides on orders for all to api_service
  using (seller_org_id = public.app_org_id() or buyer_org_id = public.app_org_id())
  with check (seller_org_id = public.app_org_id() or buyer_org_id = public.app_org_id());
create policy order_event_sides on order_events for all to api_service
  using (exists (select 1 from public.orders o where o.id = order_id))
  with check (exists (select 1 from public.orders o where o.id = order_id));

-- Nhật ký: đọc và ghi trong tổ chức đang làm việc.
create policy org_audit on audit_log for all to api_service
  using (organization_id = public.app_org_id())
  with check (organization_id is not distinct from public.app_org_id());

-- Đo lường: chỉ ghi, không đọc lại.
create policy own_events on analytics_events for insert to api_service
  with check (organization_id is null or organization_id = public.app_org_id());

-- bank_transactions, admin_access_log: bật RLS, không policy nào cho api_service.

-- ─── C7. Việc cần nhìn xuyên tổ chức — hàm security definer ─────────────────
-- Mỗi hàm làm ĐÚNG một việc hẹp, chỉ api_service gọi được, trả tối thiểu.

-- Đăng nhập một ô (tên tài khoản / SĐT / email khôi phục) → id người dùng.
-- Chưa đăng nhập thì chưa có app.user_id, nên không tra qua RLS được.
-- API đổi id thành email đăng nhập qua Auth Admin API, và LUÔN trả một email,
-- kể cả khi không tìm thấy — xem /v1/auth/resolve-identifier.
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
  if v_key ~ '^[0-9 .+()-]+$' then
    v_phone := public.normalize_phone(v_key);
  end if;

  select p.id into v_id
  from public.profiles p
  where p.deleted_at is null
    and (
      -- ::citext để so KHÔNG phân biệt hoa thường (citext = text sẽ so như text).
      p.username = v_key::citext
      or (v_phone is not null and p.phone = v_phone)
      or p.recovery_email = v_key::citext
    )
  limit 1;

  return v_id;
end;
$$;

-- Dò kết nối (KH §1.4 bước 3): tạo lời mời `pending` từ mọi sổ có đối tác mang
-- số điện thoại này tới tổ chức đang làm việc.
--
-- 🔴 Hàm KHÔNG tự kiểm được số đã xác thực OTP — API phải kiểm
-- phone_confirmed_at TRƯỚC khi gọi. Lời mời pending không cho xem gì; phải chính
-- bên được liên kết đồng ý (BE4).
--
-- Không tạo lại nếu dòng danh bạ đó đã từng nối với tổ chức này (kể cả đã huỷ):
-- vựa huỷ kết nối thì nông dân dò lại cũng không lách được.
create or replace function public.discover_links(p_phone text)
returns integer
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_org uuid := public.app_org_id();
  v_count integer;
begin
  if v_org is null then
    raise exception 'discover_links cần app.org_id';
  end if;
  if p_phone is null or public.normalize_phone(p_phone) is distinct from p_phone then
    raise exception 'discover_links cần số điện thoại dạng +84…';
  end if;

  insert into public.partner_links
    (owner_org_id, partner_kind, partner_id, linked_org_id, invited_phone, status)
  select c.organization_id, c.kind, c.id, v_org, p_phone, 'pending'
  from (
    select s.organization_id, 'supplier'::text as kind, s.id, s.phone
      from public.suppliers s where s.deleted_at is null
    union all
    select b.organization_id, 'buyer'::text, b.id, b.phone
      from public.buyers b where b.deleted_at is null
  ) c
  join public.organizations o on o.id = c.organization_id and o.deleted_at is null
  where c.organization_id <> v_org
    and public.normalize_phone(c.phone) = p_phone
    and not exists (
      select 1 from public.partner_links l
      where l.owner_org_id = c.organization_id
        and l.partner_kind = c.kind
        and l.partner_id = c.id
        and (l.status <> 'revoked' or l.linked_org_id = v_org)
    )
  on conflict do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.find_login_user(text) from public;
revoke all on function public.discover_links(text) from public;
grant execute on function public.find_login_user(text) to api_service;
grant execute on function public.discover_links(text) to api_service;
