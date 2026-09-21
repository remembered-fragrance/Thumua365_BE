import { defineConfig } from 'tsup';

/** Kiểu `.d.ts` do `tsc` sinh (tsconfig.build.json), tsup chỉ lo JS. */
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  target: 'es2022',
  outDir: 'dist',
  clean: true,
  dts: false,
  sourcemap: true,
  external: ['zod'],
});
