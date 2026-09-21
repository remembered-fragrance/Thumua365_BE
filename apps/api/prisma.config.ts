/**
 * Cấu hình Prisma CLI (migrate, generate) — KHÔNG dùng lúc API chạy.
 *
 * Migration chạy bằng role `postgres` qua `DIRECT_URL` (Session pooler, cổng 5432).
 * API chạy bằng role `api_service` qua `DATABASE_URL` — xem src/db/prisma.service.ts.
 *
 * Chỉ đọc apps/api/.env khi DIRECT_URL CHƯA được đặt sẵn: script trỏ vào Postgres
 * ở máy (db-local, test tích hợp) đặt biến trước, và .env (đang trỏ staging) không
 * được lấn quyền nó.
 */

import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

if (!process.env.DIRECT_URL && existsSync('.env')) process.loadEnvFile('.env');

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env.DIRECT_URL ?? '' },
});
