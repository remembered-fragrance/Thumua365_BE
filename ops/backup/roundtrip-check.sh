#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# Thử trọn vòng sao lưu → phục hồi: backup.sh lấy dữ liệu từ Postgres của docker compose, rồi
# restore-check.sh phục hồi vào một cluster Postgres 17 MỚI TINH — chưa có role nào của ta, giống
# lúc phải dựng lại trên một máy / project khác. Phục hồi trong cùng cluster không chứng minh được
# điều đó (role là của cả cluster, pg_dump không mang theo).
#
#   npm run db:up && bash ops/backup/roundtrip-check.sh      (máy dev)
#   CI: job `db`, sau test:db
#
# Cần Docker. pg_dump 17, psql, openssl chạy trong image postgis — máy không cần cài.
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail
export MSYS_NO_PATHCONV=1 # Git Bash trên Windows: không đổi "/out" thành đường dẫn Windows
cd "$(dirname "$0")/../.."

IMAGE=postgis/postgis:17-3.5
PASS="roundtrip-check-only-$(date +%s)-0123456789abcdef"

DB_CONTAINER="$(docker compose ps -q db)"
if [ -z "$DB_CONTAINER" ]; then
  echo "Chưa bật Postgres của docker compose — chạy npm run db:up trước" >&2
  exit 1
fi
NET="$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}' "$DB_CONTAINER")"
VOL="thumua365-roundtrip-$$"
TARGET="thumua365-restore-$$"
cleanup() {
  docker rm -f "$TARGET" >/dev/null 2>&1 || true
  docker volume rm "$VOL" >/dev/null 2>&1 || true
}
trap cleanup EXIT
docker volume create "$VOL" >/dev/null

echo "→ sao lưu Postgres của docker compose"
docker run --rm -i --network "$NET" -v "$VOL:/out" \
  -e BACKUP_DATABASE_URL=postgresql://postgres:postgres@db:5432/thumua365 \
  -e BACKUP_PASSPHRASE="$PASS" -e BACKUP_OUT_DIR=/out \
  --entrypoint bash "$IMAGE" -s <ops/backup/backup.sh

STAMP="$(docker run --rm -v "$VOL:/out" --entrypoint sh "$IMAGE" -c 'ls /out' | sed -n 's/^thumua365-\(.*\)\.counts\.txt$/\1/p')"

echo "→ dựng cluster Postgres trống"
docker run -d --name "$TARGET" --network "$NET" -e POSTGRES_PASSWORD=postgres "$IMAGE" >/dev/null
# Qua TCP: lúc chạy script khởi tạo, Postgres tạm chỉ nghe socket (như healthcheck của docker compose).
for _ in $(seq 1 60); do
  docker exec "$TARGET" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1 && break
  sleep 1
done

echo "→ phục hồi vào cluster trống"
docker run --rm -i --network "$NET" -v "$VOL:/out" \
  -e BACKUP_PASSPHRASE="$PASS" -e RESTORE_ADMIN_URL="postgresql://postgres:postgres@$TARGET:5432/postgres" \
  --entrypoint bash "$IMAGE" -s -- /out "$STAMP" <ops/backup/restore-check.sh
