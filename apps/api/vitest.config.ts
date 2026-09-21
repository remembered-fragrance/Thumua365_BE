import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * NestJS cần metadata kiểu của decorator để tiêm phụ thuộc. esbuild (mặc định của
 * vitest) không sinh metadata đó, nên test đi qua SWC.
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
    include: ['tests/**/*.test.ts'],
    // Cần Postgres — chạy riêng bằng `npm run test:db`.
    exclude: ['tests/db/**', 'node_modules/**'],
  },
});
