import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * Test tích hợp với Postgres THẬT (`npm run test:db`) — RLS, quyền, hàm SQL, và API
 * chạy trên database. Mặc định trỏ Postgres ở máy (`npm run db:up`); CI đặt
 * TEST_DATABASE_ADMIN_URL / TEST_DATABASE_SERVICE_URL.
 *
 * Các file dùng chung một database ⇒ chạy tuần tự.
 */
export default defineConfig({
  plugins: [
    swc.vite({
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['tests/db/**/*.test.ts'],
    globalSetup: ['tests/db/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
