#!/usr/bin/env node
/**
 * Máy chủ tĩnh cho trang thử đăng nhập — không cần thư viện nào.
 *
 *   npm run login-test            → http://localhost:5174
 *
 * Cổng 5174 vì nó nằm trong CORS_ORIGINS của API staging. Trang tải @mambo/sdk,
 * @mambo/contracts, @mambo/core và zod từ chính repo này (bản đã build) qua import map — tức là
 * thử đúng gói mà frontend sẽ cài.
 *
 * CHỈ phục vụ các thư mục trong ALLOWED dưới đây. Không phục vụ gốc repo: ở đó có
 * apps/api/.env, và từ BE2 file đó chứa bí mật.
 */

import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const PORT = Number(process.argv[2] ?? 5174);

/** Tiền tố URL → thư mục được phép đọc. */
const ALLOWED = {
  '/pkg/sdk/': join(ROOT, 'packages/sdk/dist'),
  '/pkg/contracts/': join(ROOT, 'packages/contracts/dist'),
  '/pkg/core/': join(ROOT, 'packages/core/dist'),
  '/pkg/zod/': join(ROOT, 'node_modules/zod'),
  '/': join(ROOT, 'tools/login-test'),
};

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json',
};

const resolveFile = (urlPath) => {
  for (const [prefix, dir] of Object.entries(ALLOWED)) {
    if (!urlPath.startsWith(prefix)) continue;
    const rel = urlPath.slice(prefix.length) || 'index.html';
    const file = normalize(join(dir, decodeURIComponent(rel)));
    // Chặn ../ thoát ra ngoài thư mục được phép.
    if (!file.startsWith(dir + sep) && file !== dir) return null;
    if (!TYPES[extname(file)]) return null;
    return existsSync(file) && statSync(file).isFile() ? file : null;
  }
  return null;
};

if (!existsSync(join(ALLOWED['/pkg/sdk/'], 'index.js'))) {
  console.error('Chưa build gói dùng chung. Chạy trước:  npm run build:packages');
  process.exit(1);
}

createServer((req, res) => {
  const urlPath = new URL(req.url ?? '/', 'http://localhost').pathname;
  const file = resolveFile(urlPath);
  if (!file) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Không có');
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[extname(file)], 'cache-control': 'no-store' });
  createReadStream(file).pipe(res);
}).listen(PORT, 'localhost', () => {
  console.warn(`Trang thử đăng nhập: http://localhost:${PORT}`);
});
