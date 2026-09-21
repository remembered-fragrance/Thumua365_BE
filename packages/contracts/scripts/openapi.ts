/**
 * Ghi packages/contracts/openapi.json. CI chạy lại lệnh này rồi `git diff --exit-code`:
 * đổi hợp đồng mà quên sinh lại file là CI đỏ.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { buildOpenApi } from '../src/openapi.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
const out = new URL('../openapi.json', import.meta.url);
writeFileSync(out, `${JSON.stringify(buildOpenApi(pkg.version), null, 2)}\n`);
