#!/usr/bin/env node
/**
 * Rà lộ bí mật trong các tệp git đang theo dõi (KH backend BE10: "git grep không lộ khoá;
 * service_role chỉ có trong env API"). CI đỏ nếu có vi phạm. Chạy: `npm run security:check`.
 *
 * Chỉ báo vị trí (tệp:dòng) và loại — KHÔNG in chuỗi bí mật ra log.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);

/** Tệp không bao giờ được commit. */
const FORBIDDEN_FILES = [/(^|\/)\.env$/, /(^|\/)\.env\.(?!example$)[^/]+$/, /\.(pem|p12|pfx|key)$/i, /(^|\/)id_(rsa|ed25519)$/];

/** Chuỗi kết nối có mật khẩu: cho phép đúng các mật khẩu dev / chỗ điền đã biết. */
const ALLOWED_DB_PASSWORDS = new Set(['postgres', 'api_service_dev', 'api_privileged_dev', 'unused', 'p', 'pass', 'password', 'PASSWORD', 'mat-khau']);

const RULES = [
  { name: 'khoá secret Supabase', re: /sb_secret_[A-Za-z0-9_-]{16,}/ },
  { name: 'JWT service_role', re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]*InNlcnZpY2Vfcm9sZSI[A-Za-z0-9_-]*\./ },
  { name: 'khoá AWS / R2', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'khoá riêng', re: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  {
    name: 'chuỗi kết nối Postgres có mật khẩu thật',
    re: /postgres(?:ql)?:\/\/[^:\s/'"`]+:([^@\s'"`]+)@/g,
    allow: (m) => ALLOWED_DB_PASSWORDS.has(m[1] ?? '') || /^[<[{$]/.test(m[1] ?? ''),
  },
];

/** Frontend (chạy trên máy người dùng) không được nhắc tới khoá bí mật. */
const WEB_FORBIDDEN = /SUPABASE_SECRET_KEY|SERVICE_ROLE_KEY|PRIVILEGED_DATABASE_URL|BANK_WEBHOOK_SECRET/;

const problems = [];
for (const file of files) {
  if (FORBIDDEN_FILES.some((re) => re.test(file))) problems.push(`${file}: tệp bí mật không được commit`);
  if (/\.(png|jpe?g|webp|ico|woff2?|tgz|lock)$/i.test(file) || file.endsWith('package-lock.json')) continue;
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    for (const rule of RULES) {
      const re = new RegExp(rule.re.source, 'g');
      for (const m of line.matchAll(re)) {
        if (rule.allow?.(m)) continue;
        problems.push(`${file}:${i + 1}: ${rule.name}`);
      }
    }
    if (file.startsWith('apps/web/src/') && WEB_FORBIDDEN.test(line)) {
      problems.push(`${file}:${i + 1}: frontend nhắc tới khoá bí mật`);
    }
  });
}

if (problems.length > 0) {
  console.error(`✗ ${problems.length} chỗ có thể lộ bí mật:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  process.exit(1);
}
process.stdout.write(`✓ không thấy bí mật trong ${files.length} tệp đang theo dõi\n`);
