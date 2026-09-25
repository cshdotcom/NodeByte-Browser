# NodeByte Server

NodeByte Browser 的服务端后台（Next.js App Router / standalone 输出）+ WebSocket 信令服务。

## 功能总览

| 模块 | 说明 |
|---|---|
| 账号体系 | JWT(HS256) + bcrypt + TOTP 2FA(RFC-6238) + 忘记密码 A/B（48h 服务端冷静期）+ 设备管理/吊销 |
| 组织能力 | 用户组、功能黑白名单（9 键）、云配额（用户>组>全局）、策略集（mandatory/recommended/sensitiveFields） |
| 策略下发 | `GET /api/client/policy` 三级合并，含 quota 与 forceInstallExtensions |
| 同步 | 九类数据密文 blob 增量同步（`/api/sync/[type]`），服务端永不解密 |
| Drop | 消息/文件（MinIO 预签名直传+配额 41301）/标签页推送/Cookie 会话上下文分享与撤销 |
| 协作 | 有效期 token 会话、邮箱批量邀请、媒体权限申请/审批（服务端唯一权威）、管控（静音/踢人/销毁） |
| 扩展 | 包下发 / ID 下发（cache_internal/external_store）/ 安装结果日志 |
| 安全 | 后端不信任前端、审计 append-only（DB 触发器禁止改删）、管理员二次鉴权（15 分钟/绑目标/不跨用户） |

## 快速开始

```bash
cp .env.example .env          # 修改 JWT_SECRET / MINIO 密钥 / ADMIN_PASSWORD
docker compose up -d          # Postgres + MinIO + 桶初始化 + WS 信令 + Server
docker compose exec server node scripts/bootstrap.mjs   # 初始化管理员
open http://localhost:3000
```

本地开发：

```bash
npm install
npm run dev                   # 需要 DATABASE_URL 指向已初始化的 Postgres（sql/init.sql）
```

## 目录结构

```
server/
├── src/lib/            # status/db/crypto/policy/policy2fa/quota/audit/minio/auth/push/client
├── src/app/api/        # auth · client · sync · drop · collab · personal · admin
├── src/app/(web)/      # 登录/注册/忘记密码/2FA/个人中心
├── src/app/admin/      # 管理后台
├── src/i18n/           # zh/en 双语
├── ws-service/         # 独立 WebSocket 信令服务（附录D 协议，可平滑替换 Go 实现）
├── sql/init.sql        # PostgreSQL DDL（附录B + 扩展表 + 审计防改删触发器）
├── scripts/bootstrap.mjs
├── Dockerfile / docker-compose.yml
```

## 安全基线（铁律）

1. 后端不信任前端：鉴权、2FA 绑定态、账号有效期、配额、策略开关、媒体权限全部服务端强校验。
2. 明文密码/Cookie 绝不入库；同步数据为客户端 AES-GCM 密文，服务端只存 MinIO 对象 + 元数据。
3. `admin_audit_log` 由数据库触发器禁止 UPDATE/DELETE。
4. 管理员查看用户私有文件必须二次密码鉴权（admin_session 15 分钟、绑定 target_user_id、不能跨用户）。
5. 业务状态码 401/40301/40302/40303/41301/429 与客户端一致。

详细部署文档：[docs/deploy-server.md](../docs/deploy-server.md)
