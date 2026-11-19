#!/usr/bin/env bash
#
# 备份脚本（在服务器上由 cron 每日执行）
#
# 备份两样东西：
#   ① PostgreSQL 全库（跑在 Docker 容器 comic-postgres 里，pg_dump 走 docker exec）
#   ② public/uploads（未迁到 R2 的历史文件；R2 上的对象由 R2 自身冗余，不在此备份）
#
# 数据库与上传文件备份各保留最新 2 份，旧备份自动删除。
#
# 用法（cron 见 deploy/README.md）：
#   bash /software/ai-comic-drama/app/deploy/backup.sh
#
# 可用环境变量覆盖：BACKUP_DIR / RETENTION_COUNT / PG_CONTAINER / APP_DIR

set -euo pipefail

APP_DIR="${APP_DIR:-/software/ai-comic-drama/app}"
BACKUP_DIR="${BACKUP_DIR:-/backup}"
RETENTION_COUNT="${RETENTION_COUNT:-2}"
PG_CONTAINER="${PG_CONTAINER:-comic-postgres}"
STAMP="$(date +%F)"

log() { printf '[backup %s] %s\n' "$(date +'%F %T')" "$*"; }
fail() { printf '[backup %s] ERROR: %s\n' "$(date +'%F %T')" "$*" >&2; exit 1; }

[[ "$RETENTION_COUNT" =~ ^[1-9][0-9]*$ ]] || fail "RETENTION_COUNT 必须为正整数"

mkdir -p "$BACKUP_DIR"

# --- 从 .env.local 的 DATABASE_URL 解析库名与用户名 ---
# 形如 postgresql://user:pass@host:5432/dbname?schema=public
if [ -z "${PGUSER:-}" ] || [ -z "${PGDATABASE:-}" ]; then
  ENV_FILE="${ENV_FILE:-${APP_DIR}/.env.local}"
  [ -f "$ENV_FILE" ] || fail "找不到 ${ENV_FILE}，无法解析 DATABASE_URL（可改用 PGUSER/PGDATABASE 环境变量）"
  DB_URL="$(grep -E '^DATABASE_URL=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"'"'"'')"
  [ -n "$DB_URL" ] || fail "${ENV_FILE} 中没有 DATABASE_URL"
  # 去掉协议头与 query，再切出 user / dbname
  STRIPPED="${DB_URL#*://}"
  CREDS="${STRIPPED%%@*}"
  HOSTPART="${STRIPPED#*@}"
  PGUSER="${PGUSER:-${CREDS%%:*}}"
  DBPART="${HOSTPART#*/}"
  PGDATABASE="${PGDATABASE:-${DBPART%%\?*}}"
fi

[ -n "$PGUSER" ] || fail "解析不出数据库用户名"
[ -n "$PGDATABASE" ] || fail "解析不出数据库名"

# --- ① 数据库 ---
DB_FILE="${BACKUP_DIR}/db-${STAMP}.sql.gz"
log "导出数据库 ${PGDATABASE}（用户 ${PGUSER}）→ ${DB_FILE}"
# 先写临时文件，成功后再改名：中途失败不会留下半截的「当日备份」
docker exec "$PG_CONTAINER" pg_dump -U "$PGUSER" "$PGDATABASE" \
  | gzip > "${DB_FILE}.tmp"
mv "${DB_FILE}.tmp" "$DB_FILE"
log "数据库备份完成（$(du -h "$DB_FILE" | cut -f1)）"

# --- ② 上传目录 ---
UPLOADS_DIR="${APP_DIR}/public/uploads"
if [ -d "$UPLOADS_DIR" ]; then
  UP_FILE="${BACKUP_DIR}/uploads-${STAMP}.tar.gz"
  log "打包 ${UPLOADS_DIR} → ${UP_FILE}"
  tar -czf "${UP_FILE}.tmp" -C "${APP_DIR}/public" uploads
  mv "${UP_FILE}.tmp" "$UP_FILE"
  log "上传目录备份完成（$(du -h "$UP_FILE" | cut -f1)）"
else
  log "跳过上传目录备份：${UPLOADS_DIR} 不存在"
fi

# --- ③ 按类别保留最新备份；日期格式可直接按文件名排序 ---
log "数据库与上传文件备份各保留最新 ${RETENTION_COUNT} 份"
for pattern in 'db-????-??-??.sql.gz' 'uploads-????-??-??.tar.gz'; do
  mapfile -t old_files < <(
    find "$BACKUP_DIR" -maxdepth 1 -type f -name "$pattern" -printf '%f\n' \
      | LC_ALL=C sort -r | tail -n "+$((RETENTION_COUNT + 1))"
  )
  for file in "${old_files[@]}"; do
    log "删除旧备份：${file}"
    rm -- "${BACKUP_DIR}/${file}"
  done
done

log "全部完成"
