# =====================================================================
# NodeByte Server —— All-in-One 单容器镜像
# 内嵌：PostgreSQL + RustFS(S3 兼容对象存储) + WebSocket 信令 + Web(API/前台/后台/个人中心) + Nginx 统一入口
#
# 一键部署：
#   docker run -d --name nodebyte -p 8080:8080 -v nodebyte-data:/data \
#     -e ADMIN_PASSWORD='强管理密码' ghcr.io/cshdotcom/nodebyte-server:latest
# 数据全部落 /data（PG + 对象存储 + 密钥），备份即备份该卷。
# 环境变量清单见 .env.docker.example —— 所有端口、密钥、域名、配额、SMTP 均可配置。
# =====================================================================

# syntax=docker/dockerfile:1

# ---------------- 构建阶段：Next.js standalone ----------------
FROM node:20-bookworm-slim AS build
WORKDIR /build
COPY server/package.json server/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY server/ .
ENV NEXT_TELEMETRY_DISABLED=1 \
    DATABASE_URL=postgres://placeholder:placeholder@127.0.0.1:5432/placeholder \
    JWT_SECRET=build-time-placeholder-secret
RUN npm run build

# ---------------- 运行阶段：全服务合一 ----------------
FROM node:20-bookworm-slim AS runtime

ARG TARGETARCH

# 系统依赖：PostgreSQL（发行版仓库版）+ Nginx 入口 + Supervisor 进程管家
# 对象存储：RustFS 1.0（Apache 2.0，S3 兼容，MinIO API 替代；静态二进制双架构）
RUN apt-get update && apt-get install -y --no-install-recommends \
        postgresql postgresql-contrib nginx supervisor unzip curl ca-certificates tzdata \
    && case "${TARGETARCH}" in \
           amd64) RUSTFS_ARCH="x86_64" ;; \
           arm64) RUSTFS_ARCH="aarch64" ;; \
           *) echo "unsupported TARGETARCH=${TARGETARCH}" && exit 1 ;; \
       esac \
    && curl -fsSL "https://github.com/rustfs/rustfs/releases/download/1.0.0/rustfs-linux-${RUSTFS_ARCH}-musl-v1.0.0.zip" \
        -o /tmp/rustfs.zip \
    && unzip -o -j /tmp/rustfs.zip "rustfs" -d /usr/local/bin/ \
    && chmod 0755 /usr/local/bin/rustfs \
    && rm -rf /var/lib/apt/lists/* /tmp/rustfs.zip \
    && rm -f /etc/nginx/sites-enabled/default

# ws-service 与桶初始化工具的依赖（纯 JS 包，无原生编译，双架构通用）
WORKDIR /app
COPY server/ws-service/package.json /app/ws/package.json
RUN npm install --prefix /app/ws --omit=dev --no-audit --no-fund
COPY server/ws-service/index.mjs /app/ws/index.mjs

COPY docker/tools/package.json /app/tools/package.json
RUN npm install --prefix /app/tools --omit=dev --no-audit --no-fund
COPY docker/tools/ensure-buckets.mjs /app/tools/ensure-buckets.mjs

# Next.js standalone 产物（自含裁剪版 node_modules）
COPY --from=build /build/.next/standalone /app/web
COPY --from=build /build/.next/static /app/web/.next/static
COPY --from=build /build/public /app/web/public

# 数据库 DDL（首启/升级时应用）与引导脚本（幂等）
COPY --from=build /build/sql /app/sql
COPY --from=build /build/scripts /app/scripts

# 运行编排
COPY docker/supervisord.conf /etc/supervisor/supervisord.conf
COPY docker/nginx.conf /etc/nginx/conf.d/nodebyte.conf
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod 0755 /entrypoint.sh /usr/local/bin/rustfs \
    && ln -sf /usr/share/zoneinfo/Asia/Shanghai /etc/localtime || true

# 统一入口端口（PG/RustFS/WS/Web 仅监听 127.0.0.1，不对外）
EXPOSE 8080
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=5 \
    CMD curl -fsS http://127.0.0.1:8080/healthz || exit 1

ENTRYPOINT ["/entrypoint.sh"]
