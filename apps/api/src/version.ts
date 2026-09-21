import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Phiên bản API, đọc từ apps/api/package.json (cùng chỗ ở máy dev, CI và image Docker). */
export const API_VERSION: string = (
  JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as { version: string }
).version;
