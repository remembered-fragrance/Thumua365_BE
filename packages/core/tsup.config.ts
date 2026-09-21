import { defineConfig } from 'tsup';

/**
 * Mỗi file trong src/ là một điểm vào: frontend import `@mambo/core/calc` đúng
 * như đang import `@/core/calc`, chỉ đổi tiền tố. Kiểu `.d.ts` do `tsc` sinh
 * (tsconfig.build.json), tsup chỉ lo JS.
 */
export default defineConfig({
  entry: ['src/*.ts'],
  format: ['esm', 'cjs'],
  target: 'es2022',
  outDir: 'dist',
  splitting: true,
  clean: true,
  dts: false,
  sourcemap: true,
});
