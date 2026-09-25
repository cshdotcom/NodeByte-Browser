#!/bin/bash
# =====================================================================
# NodeByte All-in-One 入口：初始化数据卷 → 启动内嵌服务
# 幂等：可安全随容器重启无限次执行
# =====================================================================
set -euo pipefail

DATA_DIR="${DATA_DIR:-/data}"
PG_DATA="$DATA_DIR/postgres"
MINIO_DATA="$DATA_DIR/minio"
SECRETS="$DATA_DIR/secrets"
SCHEMA_MARK="$DATA_DIR/.schema_applied"
PG_BIN="$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)"
PG_USER="${PG_USER:-nodebyte}"
PG_DB="${PG_DB:-nodebyte}"
export TZ="${TZ:-Asia/Shanghai}"

log() { echo "[nodebyte-entrypoint] $*"; }

mkdir -p "$PG_DATA" "$MINIO_DATA" "$SECRETS" /run/postgresql
chown -R postgres:postgres "$PG_DATA" /run/postgresql

# ---------------- 密钥：未提供则自动生成并持久化到 /data/secrets ----------------
rand_secret() { head -c 32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 40; }

# 用法: ensure_secret ENV_NAME FILE  —— env 已给且非占位值则以 env 为准，否则读/生成文件
ensure_secret() {
  local name="$1" file="$2" val="${!1:-}"
  if [ -n "$val" ] && ! [[ "$val" == change-me* ]]; then
    printf '%s' "$val" > "$file"
  elif [ ! -s "$file" ]; then
    rand_secret > "$file"
  fi
  export "$1=$(cat "$file")"
}

ensure_secret JWT_SECRET                "$SECRETS/jwt_secret"
ensure_secret INTERNAL_SHARED_SECRET    "$SECRETS/internal_secret"
ensure_secret DATABASE_PASSWORD         "$SECRETS/db_password"
ensure_secret MINIO_ROOT_PASSWORD       "$SECRETS/rustfs_password"
export S3_ROOT_USER="${MINIO_ROOT_USER:-${MINIO_ACCESS_KEY:-nodebyte}}"
export S3_ROOT_PASSWORD="${MINIO_ROOT_PASSWORD:-${MINIO_SECRET_KEY:-}}"

export DATABASE_URL="${DATABASE_URL:-postgres://${PG_USER}:${DATABASE_PASSWORD}@127.0.0.1:5432/${PG_DB}}"
export JWT_SECRET="${JWT_SECRET}"                     # 供 supervisord 子进程继承
export INTERNAL_SHARED_SECRET="${INTERNAL_SHARED_SECRET}"
export WS_PORT="${WS_PORT:-8081}"
export WS_SERVICE_URL="${WS_SERVICE_URL:-http://127.0.0.1:8081}"
# 内嵌 RustFS（S3 兼容）进程端凭据/地址
export RUSTFS_ACCESS_KEY="${S3_ROOT_USER}"
export RUSTFS_SECRET_KEY="${S3_ROOT_PASSWORD}"
export RUSTFS_ADDRESS="127.0.0.1:9000"
# 应用端（Next.js / ensure-buckets 走 minio SDK）凭据与地址
export MINIO_ENDPOINT="${MINIO_ENDPOINT:-127.0.0.1}"
export MINIO_PORT="${MINIO_PORT:-9000}"
export MINIO_USE_SSL="${MINIO_USE_SSL:-false}"
export MINIO_ACCESS_KEY="${S3_ROOT_USER}"
export MINIO_SECRET_KEY="${S3_ROOT_PASSWORD}"
export PORT=3000          # Next.js 内部端口固定 3000（对外端口由 docker -p / 反代决定）
export HOSTNAME="127.0.0.1"
export NODE_ENV="production"
export ADMIN_EMAIL="${ADMIN_EMAIL:-admin@nodebyte.cn}"
export ADMIN_PASSWORD="${ADMIN_PASSWORD:-admin12345}"

# ---------------- 内嵌 PostgreSQL：首启 initdb ----------------
if [ ! -s "$PG_DATA/PG_VERSION" ]; then
  log "首次启动：初始化 PostgreSQL 数据目录 ..."
  su postgres -s /bin/bash -c \
    "$PG_BIN/initdb -D '$PG_DATA' -E UTF8 --auth-local=trust --auth-host=md5" > /dev/null
  log "PostgreSQL 初始化完成"
fi

pg_start() {
  su postgres -s /bin/bash -c \
    "$PG_BIN/pg_ctl -D '$PG_DATA' -o '-c listen_addresses=127.0.0.1 -p 5432' -w -t 60 start" > /dev/null
  for _ in $(seq 1 30); do
    "$PG_BIN/pg_isready" -h 127.0.0.1 -p 5432 -U postgres > /dev/null 2>&1 && return 0
    sleep 1
  done
  log "PostgreSQL 启动超时"; return 1
}
pg_stop() {
  su postgres -s /bin/bash -c "$PG_BIN/pg_ctl -D '$PG_DATA' -m fast stop" > /dev/null 2>&1 || true
}

pg_start
PSQL="$PG_BIN/psql -h 127.0.0.1 -p 5432 -U postgres -v ON_ERROR_STOP=1"

# 建业务用户与库（幂等；密码经 psql 变量安全转义）
if ! $PSQL -tAc "SELECT 1 FROM pg_roles WHERE rolname='${PG_USER}'" | grep -q 1; then
  log "创建数据库用户 ${PG_USER}"
  $PSQL -v pwd="$DATABASE_PASSWORD" -c "CREATE USER ${PG_USER} WITH PASSWORD :'pwd'" > /dev/null
else
  # 密码与 env 对齐（用户改密后重启自动同步）
  $PSQL -v pwd="$DATABASE_PASSWORD" -c "ALTER USER ${PG_USER} WITH PASSWORD :'pwd'" > /dev/null
fi
if ! $PSQL -tAc "SELECT 1 FROM pg_database WHERE datname='${PG_DB}'" | grep -q 1; then
  log "创建数据库 ${PG_DB}"
  $PSQL -c "CREATE DATABASE ${PG_DB} OWNER ${PG_USER}" > /dev/null
fi

# 应用 DDL（schema 指纹变化时自动重跑；init.sql 全幂等）
SCHEMA_SHA="$(sha256sum /app/sql/init.sql | cut -d' ' -f1)"
if [ ! -s "$SCHEMA_MARK" ] || [ "$(<"$SCHEMA_MARK")" != "$SCHEMA_SHA" ]; then
  log "应用数据库 schema（init.sql）..."
  $PSQL -d "$PG_DB" -f /app/sql/init.sql > /dev/null
  echo "$SCHEMA_SHA" > "$SCHEMA_MARK"
  log "schema 就绪"
fi
chown postgres:postgres "$SCHEMA_MARK" 2>/dev/null || true

# 管理员引导（脚本幂等；ADMIN_PASSWORD 首启生效）
node /app/scripts/bootstrap.mjs || log "bootstrap 失败（稍后可手动重试）"

pg_stop
log "数据初始化完毕，交棒 supervisor ..."

exec supervisord -n -c /etc/supervisor/supervisord.conf
