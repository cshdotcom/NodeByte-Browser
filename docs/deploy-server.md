# NodeByte Server 部署指南

> 目标：`bsync.nodebyte.cn` 公网可访问；业务接口按登录态 + 2FA 绑定态鉴权（服务端提示词 4.1）。

## 1. 一键部署（Docker Compose）

```bash
cd server
cp .env.example .env
# 必改：JWT_SECRET（强随机 ≥32 字符）、MINIO_ACCESS_KEY/SECRET_KEY、ADMIN_PASSWORD
docker compose up -d
docker compose exec server node scripts/bootstrap.mjs     # 初始化默认组 + 管理员
open http://localhost:3000
```

包含：PostgreSQL（init.sql 自动执行）+ MinIO（七桶自动初始化）+ WS 信令服务 + Next.js standalone。

## 2. 环境变量（服务端提示词 C.2.2）

| 变量 | 说明 |
|---|---|
| `DATABASE_URL` | PostgreSQL 连接串 |
| `JWT_SECRET` | JWT(HS256) 与 AES-GCM 密钥派生源，生产必换 |
| `INTERNAL_SHARED_SECRET` | Next.js → ws-service 推送事件鉴权 |
| `MINIO_ENDPOINT/PORT/USE_SSL/ACCESS_KEY/SECRET_KEY` | 对象存储 |
| `PUBLIC_BASE_URL` | 预签名 URL 生成基址 |
| `SMTP_HOST/PORT/USER/PASS/FROM` | 自助注册验证码 / 忘记密码方式 B |
| `DEFAULT_SYNC_DOMAIN` | bsync.nodebyte.cn |
| `ADMIN_EMAIL / ADMIN_PASSWORD` | bootstrap 初始管理员 |

## 3. 数据库

- 初始化：`sql/init.sql`（附录B 全量表 + 扩展表 + 审计防改删触发器 + 策略种子），compose 已自动执行。
- 迁移：版本升级时用增量 SQL（`admin_audit_log` 永远禁止 UPDATE/DELETE，数据库层触发器强制）。

## 4. MinIO 桶规划（提示词 5.11.3）

`drop-files` / `screenshots` / `sync-blobs` / `extension-pool` / `doc-snapshots` / `recordings` / `avatars`
全部私有桶，下载一律走预签名 URL；`is_encrypted_client_side=true` 的对象服务端不可解密。

## 5. 反向代理（Nginx/Caddy）

```nginx
server {
  server_name bsync.nodebyte.cn;
  listen 443 ssl http2;

  # Next.js 主服务
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Real-IP $remote_addr;
  }

  # WebSocket 信令（wss://）—— 独立服务，与主服务共用域名或子域
  location /ws {
    proxy_pass http://127.0.0.1:8081;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;
  }

  # 限流：登录 / 验证码接口（提示词 C.2.6）
  location /api/auth/login { limit_req zone=login burst=10 nodelay; proxy_pass http://127.0.0.1:3000; }
}
```

## 6. WS 信令与 SFU

- `ws-service`（8081）承载附录D 协议；`/internal/emit`（8181）供 Next.js 推事件。
- 生产大规模长连接建议以 Go 重写（协议契约不变，docs/api-contract.md）。
- SFU（多人会议媒体中转）v1.1+ 独立部署；按 `collab_participant` 库状态放行/切断轨道。

## 7. 上线检查单

- [ ] JWT_SECRET / MINIO 密钥 / 管理员密码已换强随机值
- [ ] HTTPS（证书）与 wss:// 就绪；登录/验证码接口限流
- [ ] `enable_public_register=false`（默认关闭，开启需 SMTP 就绪）
- [ ] 七个 MinIO 桶已创建且为私有
- [ ] 审计日志 append-only 生效（尝试 UPDATE/DELETE 应被数据库拒绝）
- [ ] 管理员二次鉴权 15 分钟过期行为验证
