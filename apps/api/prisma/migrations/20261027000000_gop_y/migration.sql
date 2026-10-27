-- ═══════════════════════════════════════════════════════════════════════════
-- Góp ý + chấm sao trong app (0.25.0) — POST /v1/feedback
--
-- Chỉ thêm bảng mới: app bản cũ không biết bảng này, không ảnh hưởng gì.
-- Như analytics_events: api_service chỉ INSERT (không đọc lại), không khoá ngoại.
-- Quản trị đọc bằng api_privileged / Supabase dashboard.
-- ═══════════════════════════════════════════════════════════════════════════

-- CreateTable
CREATE TABLE "feedback" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "app_version" TEXT,
    "platform" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_pkey" PRIMARY KEY ("id")
);

-- Cùng giới hạn với FeedbackInput của contracts — lớp hai, phòng khi ai ghi thẳng database.
alter table feedback add constraint feedback_rating_check check (rating between 1 and 5);
alter table feedback add constraint feedback_comment_check check (char_length(comment) <= 1000);
alter table feedback add constraint feedback_platform_check check (platform in ('web', 'pwa', 'twa'));

grant insert on feedback to api_service;
grant select, insert, update, delete on feedback to api_privileged;

-- Chỉ ghi, đúng người và tổ chức của phiên — không đọc lại.
alter table feedback enable row level security;
create policy own_feedback on public.feedback for insert to api_service
  with check (organization_id = public.app_org_id() and user_id = public.app_user_id());
