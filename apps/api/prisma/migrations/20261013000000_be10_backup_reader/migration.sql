-- BE10 — role CHỈ ĐỌC cho sao lưu (ops/PRODUCTION.md §4).
--
-- Chuỗi kết nối sao lưu nằm trong GitHub secrets, mà pg_dump chỉ cần đọc ⇒ không dùng role postgres.
-- BYPASSRLS vì pg_dump tắt row_security và báo lỗi nếu RLS lọc mất dòng nào. NOLOGIN ở đây; mật khẩu:
--   npm run db:role-password -w @mambo/api -- --role backup_reader
-- Chỉ GRANT SELECT — không INSERT / UPDATE / DELETE / TRUNCATE, không sở hữu gì.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'backup_reader') then
    create role backup_reader nologin noinherit bypassrls;
  end if;
end;
$$;

grant usage on schema public to backup_reader;
grant select on all tables in schema public to backup_reader;
grant select on all sequences in schema public to backup_reader;
-- Bảng / sequence do migration sau tạo cũng đọc được, khỏi phải nhớ grant lại.
alter default privileges in schema public grant select on tables to backup_reader;
alter default privileges in schema public grant select on sequences to backup_reader;

-- auth.users + auth.identities: chỉ có trên Supabase. Không đủ quyền grant thì migration KHÔNG được
-- hỏng (chặn cả deploy) — báo notice; backup.sh khi đó cần chạy phần auth bằng role khác (ghi MEMORY).
do $$
begin
  if to_regclass('auth.users') is not null then
    grant usage on schema auth to backup_reader;
    grant select on auth.users, auth.identities to backup_reader;
  end if;
exception when insufficient_privilege then
  raise notice 'backup_reader: không grant được SELECT trên auth.users / auth.identities';
end;
$$;
