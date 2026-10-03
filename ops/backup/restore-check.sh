#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# Thử phục hồi một bản backup vào một database TRỐNG rồi so số dòng với lúc dump (KH BE10: "thử phục
# hồi một lần và ghi lại các bước"). Backup chưa từng phục hồi thử thì chưa phải là backup.
#
#   ./restore-check.sh <thư mục chứa tệp> <STAMP>     vd: ./restore-check.sh ./out 20261003T190000Z
#
# Biến:
#   BACKUP_PASSPHRASE   như lúc backup
#   RESTORE_ADMIN_URL   kết nối role postgres tới một Postgres 17 (máy dev: docker compose)
#   RESTORE_DB          tên database tạo mới để phục hồi vào (mặc định thumua365_restore) — bị XOÁ trước
# Bản trên kho S3: tải về trước (`aws s3 cp s3://<bucket>/daily/thumua365-<STAMP>.* ./out/`).
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

DIR="${1:?thư mục chứa tệp backup}"
STAMP="${2:?STAMP của bản backup, vd 20261003T190000Z}"
: "${BACKUP_PASSPHRASE:?thiếu BACKUP_PASSPHRASE}"
: "${RESTORE_ADMIN_URL:?thiếu RESTORE_ADMIN_URL}"
DB="${RESTORE_DB:-thumua365_restore}"
if [ "$DB" = "thumua365" ] || [ "$DB" = "postgres" ]; then
  echo "Không phục hồi đè lên database $DB" >&2
  exit 1
fi

decrypt() { openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE -in "$1"; }

echo "→ tạo database trống $DB"
psql "$RESTORE_ADMIN_URL" -v ON_ERROR_STOP=1 -qc "drop database if exists $DB" -c "create database $DB"
TARGET="$(echo "$RESTORE_ADMIN_URL" | sed -E "s#/[^/?]+(\?|$)#/$DB\1#")"

# Hàm, trigger của schema public gọi tới extensions (citext, postgis) như trên Supabase.
psql "$TARGET" -v ON_ERROR_STOP=1 -qc "create schema if not exists extensions" \
  -c "create extension if not exists citext with schema extensions" \
  -c "create extension if not exists postgis with schema extensions" \
  -c "alter database $DB set search_path to \"\$user\", public, extensions"

echo "→ phục hồi public"
psql "$TARGET" -qc "drop schema if exists public cascade"
decrypt "$DIR/thumua365-$STAMP.public.dump.enc" | pg_restore --no-owner --no-privileges --exit-on-error -d "$TARGET"

echo "→ so số dòng với lúc dump"
EXPECTED="$DIR/thumua365-$STAMP.counts.txt"
ACTUAL="$(mktemp)"
psql "$TARGET" -tA -F' ' -c "
  select 'organizations', count(*) from public.organizations union all
  select 'transactions',  count(*) from public.transactions  union all
  select 'payments',      count(*) from public.payments      union all
  select 'orders',        count(*) from public.orders        union all
  select 'bank_transactions', count(*) from public.bank_transactions" > "$ACTUAL"
if diff -u "$EXPECTED" "$ACTUAL"; then
  cat "$ACTUAL"
  echo "✓ phục hồi khớp số dòng — ghi ngày thử và người thử vào MEMORY"
else
  echo "✗ LỆCH số dòng" >&2
  exit 1
fi
