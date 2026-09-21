import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import * as Sentry from '@sentry/node';
import { createRemoteJWKSet } from 'jose';
import { WinstonModule } from 'nest-winston';
import { AppModule } from './app.module';
import { PrismaMemberships } from './auth/prisma-memberships';
import { SupabaseAdminHttp } from './auth/supabase-admin';
import { SupabaseUsersHttp } from './auth/supabase-users';
import { configureApp } from './bootstrap';
import { loadEnv } from './config/env';
import { Database } from './db/database';
import { buildLogger } from './logger';

const main = async (): Promise<void> => {
  // Máy dev: đọc apps/api/.env nếu có. Container không có file này — biến đến từ Render.
  if (existsSync('.env')) process.loadEnvFile('.env');
  const env = loadEnv();
  const logger = buildLogger(env);

  if (env.SENTRY_DSN) {
    Sentry.init({ dsn: env.SENTRY_DSN, environment: env.APP_ENV, release: env.RENDER_GIT_COMMIT });
  }

  // Kết nối lười: chưa chạm Postgres cho tới truy vấn đầu tiên — /v1/health không cần DB.
  const db = new Database(env.DATABASE_URL);

  const app = await NestFactory.create(
    AppModule.forRoot(env, {
      jwks: createRemoteJWKSet(new URL(`${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`)),
      supabaseUsers: new SupabaseUsersHttp(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY),
      supabaseAdmin: new SupabaseAdminHttp(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY),
      memberships: new PrismaMemberships(db),
      db,
      logger,
    }),
    { bodyParser: false, logger: WinstonModule.createLogger({ instance: logger }) },
  );
  configureApp(app, env, logger);

  await app.listen(env.PORT, '0.0.0.0');
  logger.info('listening', { port: env.PORT });
};

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
