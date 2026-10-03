#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# Sao lưu Postgres (KH backend BE10) — lớp backup DUY NHẤT khi production còn ở gói Free của
# Supabase: điều kiện bắt buộc trước khi có người dùng thật (MEMORY, "Hạ tầng Supabase").
#
#   public.dump — toàn bộ schema public (sổ, đơn, gói, nhật ký…): cấu trúc + dữ liệu
#   auth.dump   — CHỈ dữ liệu auth.users + auth.identities (tài khoản đăng nhập), để khôi phục được
#                 việc đăng nhập; schema auth do Supabase quản, không dump cấu trúc
#
# Cả hai mã hoá AES-256 (khoá từ BACKUP_PASSPHRASE) TRƯỚC khi rời máy chạy, rồi lên kho S3-compatible
# của nhà cung cấp KHÁC Supabase (Cloudflare R2, Backblaze B2…). Giữ 30 ngày.
#
# Biến:
#   BACKUP_DATABASE_URL   chuỗi kết nối role postgres (Session pooler 5432 hoặc direct) — bắt buộc
#   BACKUP_PASSPHRASE     ≥ 32 ký tự, CẤT RIÊNG (mất là backup vô dụng) — bắt buộc
#   BACKUP_S3_BUCKET, BACKUP_S3_ENDPOINT, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY — lên kho
#   BACKUP_OUT_DIR        thay cho kho: ghi ra thư mục này (thử ở máy dev)
#   BACKUP_KEEP_DAYS      mặc định 30
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

: "${BACKUP_DATABASE_URL:?thiếu BACKUP_DATABASE_URL}"
: "${BACKUP_PASSPHRASE:?thiếu BACKUP_PASSPHRASE}"
if [ "${#BACKUP_PASSPHRASE}" -lt 32 ]; then
  echo "BACKUP_PASSPHRASE phải dài ít nhất 32 ký tự" >&2
  exit 1
fi
KEEP_DAYS="${BACKUP_KEEP_DAYS:-30}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

encrypt() { openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_PASSPHRASE -out "$1"; }

echo "→ dump public"
pg_dump --format=custom --compress=9 --no-owner --no-privileges --schema=public "$BACKUP_DATABASE_URL" \
  | encrypt "$WORK/thumua365-$STAMP.public.dump.enc"

# Máy dev / CI (Postgres thường) không có schema auth — bỏ qua phần này thay vì hỏng cả backup.
if psql "$BACKUP_DATABASE_URL" -tAc "select to_regclass('auth.users') is not null" | grep -q t; then
  echo "→ dump auth.users, auth.identities (chỉ dữ liệu)"
  pg_dump --format=custom --compress=9 --data-only --no-owner --no-privileges \
    --table=auth.users --table=auth.identities "$BACKUP_DATABASE_URL" \
    | encrypt "$WORK/thumua365-$STAMP.auth.dump.enc"
else
  echo "→ không có schema auth (không phải Supabase) — bỏ qua"
fi

# Một tệp kiểm: số dòng các bảng chính lúc dump — phục hồi xong so lại (restore-check.sh).
psql "$BACKUP_DATABASE_URL" -tA -F' ' -c "
  select 'organizations', count(*) from public.organizations union all
  select 'transactions',  count(*) from public.transactions  union all
  select 'payments',      count(*) from public.payments      union all
  select 'orders',        count(*) from public.orders        union all
  select 'bank_transactions', count(*) from public.bank_transactions" > "$WORK/thumua365-$STAMP.counts.txt"
cat "$WORK/thumua365-$STAMP.counts.txt"

if [ -n "${BACKUP_OUT_DIR:-}" ]; then
  mkdir -p "$BACKUP_OUT_DIR"
  cp "$WORK"/thumua365-"$STAMP".* "$BACKUP_OUT_DIR"/
  echo "✓ ghi vào $BACKUP_OUT_DIR"
  exit 0
fi

: "${BACKUP_S3_BUCKET:?thiếu BACKUP_S3_BUCKET (hoặc đặt BACKUP_OUT_DIR)}"
: "${BACKUP_S3_ENDPOINT:?thiếu BACKUP_S3_ENDPOINT}"
S3=(aws s3 --endpoint-url "$BACKUP_S3_ENDPOINT")
for f in "$WORK"/thumua365-"$STAMP".*; do
  "${S3[@]}" cp "$f" "s3://$BACKUP_S3_BUCKET/daily/$(basename "$f")" --only-show-errors
done
echo "✓ lên s3://$BACKUP_S3_BUCKET/daily/"

# Giữ KEEP_DAYS ngày — tên tệp mang ngày giờ UTC, so theo chuỗi là đủ.
CUTOFF="$(date -u -d "-$KEEP_DAYS days" +%Y%m%dT%H%M%SZ)"
"${S3[@]}" ls "s3://$BACKUP_S3_BUCKET/daily/" | awk '{print $4}' | while read -r name; do
  stamp="$(echo "$name" | sed -n 's/^thumua365-\([0-9TZ]*\)\..*/\1/p')"
  if [ -n "$stamp" ] && [[ "$stamp" < "$CUTOFF" ]]; then
    "${S3[@]}" rm "s3://$BACKUP_S3_BUCKET/daily/$name" --only-show-errors
    echo "  xoá bản cũ $name"
  fi
done
