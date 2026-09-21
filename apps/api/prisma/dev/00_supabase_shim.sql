-- Dựng lại trên Postgres ở máy dev / CI những gì project Supabase CÓ SẴN trước
-- migration đầu tiên. Không chạy trên Supabase — ở đó mọi thứ dưới đây đã có.
--
-- Mục đích: migration chạy ở đây phải gặp đúng hoàn cảnh như trên staging —
-- kể cả những thứ nguy hiểm (quyền mặc định cho anon/authenticated), để test
-- chứng minh được migration đã gỡ chúng.

-- Supabase đặt extension trong schema riêng, và search_path có schema đó.
create schema if not exists extensions;
alter database thumua365 set search_path to "$user", public, extensions;

-- Role của Data API. Dự án đã tắt Data API, nhưng role vẫn tồn tại.
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

-- Supabase mặc định CẤP HẾT quyền trên bảng mới trong public cho ba role trên.
-- Migration phải thu hồi — test tích hợp kiểm việc đó.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

-- Hai role API dùng. Trên Supabase, migration tạo chúng ở dạng NOLOGIN rồi đặt
-- mật khẩu bằng `npm run db:role-password`. Ở đây tạo sẵn với mật khẩu dev —
-- migration thấy đã có thì bỏ qua.
create role api_service login password 'api_service_dev' noinherit;
create role api_privileged login password 'api_privileged_dev' noinherit bypassrls;
