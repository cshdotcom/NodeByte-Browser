# NodeByte Browser（NodeByte-Browser）

> NodeByte Browser 一体化构建仓库：**Chromium 二次开发客户端**（补丁式构建）+ **NodeByte Server 服务端后台**（Next.js）。
> 本仓库遵循「低侵入 Chromium 架构」与「补丁差分构建策略」：仓库**不存放 Chromium 源码**，只存放补丁、GN 参数、构建脚本与完整服务端工程，由 GitHub Actions 完成编译与验证。

## 仓库结构

```
NodeByte-Browser/
├── client/                    # NodeByte Browser 客户端（Chromium 二次开发）
│   ├── src-nodebyte/          # 自研业务源码（低侵入，全部新文件，C++/Mojo）
│   ├── webui/                 # nodebyte:// 内置页面（登录 / Drop 侧边栏 / 设置 / 离线小游戏）
│   ├── patches/               # 由 gen_patches.sh 生成的补丁集（按序号应用）
│   ├── gn/                    # GN 构建参数（开发版 / PC 发布版 / Android 发布版）
│   ├── scripts/               # sync / patch / build / package 全流程脚本
│   ├── branding/              # 品牌：Android 启动器图标 / 主图标
│   └── installer/             # Windows Inno Setup 安装脚本（含品牌 .ico）
├── server/                    # NodeByte Server（Next.js standalone 后台）
│   ├── src/app/api/           # 全部 REST API（认证/策略/同步/Drop/协作/管理）
│   ├── src/lib/               # 核心库（JWT/TOTP/AES-GCM、策略合并、配额、审计、S3 兼容存储）
│   ├── src/app/(web)          # 前台登录 + 网页个人中心
│   ├── src/app/admin          # 管理员后台
│   ├── ws-service/            # WebSocket 信令服务（独立部署，附录D 协议）
│   ├── sql/                   # PostgreSQL 初始化 DDL（附录B，可直接执行）
│   └── Dockerfile / docker-compose.yml
├── docker/                    # All-in-One 单容器镜像编排（entrypoint/supervisord/nginx/建桶）
├── brand/                     # 品牌图标「字节光轨」母版与设计说明
├── docs/                      # 架构、编译、部署、策略字典、接口契约、路线图
└── .github/workflows/         # 服务端 CI / Docker 镜像发布 / 客户端校验 / 云端直编
```

## 两大组成部分

### 1. 客户端（`client/`）— Chromium 补丁式构建

- **铁律：低侵入**。自研业务 C++ 全部放独立目录 `//chrome/browser/nodebyte/`，业务 UI 走 `nodebyte://` WebUI + WASM，C++ 只做薄 Mojo 桥接；对 Chromium 核心文件的少量 hook 以独立小补丁交付并标注基线。
- **构建策略：不 fork 不上传源码**。CI（自托管 Runner，标签 `linux-build-box`）拉取官方源码 → `gclient sync` → 应用 `patches/*.patch` → `ninja` 编译。
  - Windows：`chrome.exe` → Inno Setup 安装包（双路径自定义 + 注册表标记 + 卸载保留用户数据）
  - Android：签名 APK（arm64）
- 产品名恒为 **NodeByte Browser**，自定义协议 `nodebyte://`，默认同步服务器 `bsync.nodebyte.cn`，默认搜索引擎必应。

> 编译门槛说明：完整 Chromium 源码数十 GB，GitHub 官方托管 Runner 磁盘（约 14GB）与内存（7–8GB）无法承载完整编译，**完整编译必须使用自托管 Runner**（见 [docs/build-client.md](docs/build-client.md)）；托管 Runner 承担服务端 CI 与客户端补丁/脚本校验。

### 2. 服务端（`server/`）— NodeByte Server（Next.js standalone）

- 账号体系：JWT + bcrypt + TOTP 2FA（RFC-6238）+ 忘记密码（方式 A/B、48h 冷静期）+ 设备管理
- 组织能力：用户组、云配额、策略集（mandatory/recommended/sensitiveFields）、`GET /api/client/policy` 合并下发
- 业务闭环：加密同步 API、Drop（消息/文件/标签页推送/Cookie 会话上下文分享与撤销）、协作会话、扩展强制下发
- 安全基线：**后端不信任前端**、明文密码/Cookie 绝不入库、审计日志不可改删、管理员查看用户文件二次密码鉴权（15 分钟会话）
- 部署：Next.js standalone + PostgreSQL + RustFS(S3 兼容) + 独立 WebSocket 信令服务（`docker compose up` 一键拉起）

业务状态码（客户端/服务端一致约定）：

| 状态码 | 含义 |
|---|---|
| 401 | 未登录 / 令牌过期 |
| 40301 | 需绑定 2FA |
| 40302 | 账号禁用 / 封禁 / 过期 |
| 40303 | 无功能权限 |
| 41301 | 存储配额超限 |
| 429 | 限流 |

## 快速开始

### 方式一：All-in-One 单容器一键部署（推荐）

全部服务（PostgreSQL + 对象存储 + WebSocket 信令 + Web 前台/后台/个人中心/登录页）嵌在**一个镜像**内，唯一入口 `:8080`，数据落 `/data` 卷：

```bash
# 零配置起步（所有密钥留空则首启自动生成强随机值并持久化）
docker run -d --name nodebyte -p 8080:8080 \
  -v nodebyte-data:/data \
  -e ADMIN_PASSWORD='请改强密码' \
  ghcr.io/cshdotcom/nodebyte-server:latest

# 打开 http://localhost:8080 → 登录页（管理员 admin@nodebyte.cn）
```

完整配置（端口/密钥/域名/配额/SMTP/远程直传域名等）见 [.env.docker.example](.env.docker.example)：

```bash
cp .env.docker.example .env   # 按需修改
docker run -d --name nodebyte --env-file .env -p 8080:8080 \
  -v nodebyte-data:/data ghcr.io/cshdotcom/nodebyte-server:latest
```

- 镜像双架构：`linux/amd64` + `linux/arm64`
- 升级：拉新镜像重启即可（数据库 schema 指纹变化自动迁移，数据卷不动）
- 备份：`docker run --rm -v nodebyte-data:/data -v $PWD:/bak alpine tar czf /bak/nodebyte-data.tgz /data`

### 方式二：docker compose 分体部署

```bash
cd server
cp .env.example .env            # 按需修改
docker compose up -d            # PostgreSQL + RustFS + WS 信令 + NodeByte Server
# 初始化：建库表 + 管理员账号（见 docs/deploy-server.md）
```

### 客户端编译（自托管 Runner）

```bash
# 在构建机（Ubuntu 24.04，≥16核/32GB内存/250GB 空闲 NVMe）注册 runner，标签 linux-build-box
# 之后在 GitHub Actions 手动触发 "Build-NodeByte-Browser" 工作流
```

详细步骤：[docs/build-client.md](docs/build-client.md)

## 文档索引

| 文档 | 内容 |
|---|---|
| [docs/architecture.md](docs/architecture.md) | 总体架构、业务主链路、低侵入原则、状态码约定 |
| [docs/feature-checklist.md](docs/feature-checklist.md) | **两份开发提示词逐项对照检查表**（v1.3） |
| [docs/data-import.md](docs/data-import.md) | 数据导入体系：CSV 批量导入（管理端/个人中心/浏览器）、浏览器导入、同步项勾选（v1.3） |
| [docs/accelerator.md](docs/accelerator.md) | 加速器与第三方代理协议矩阵：HTTP/HTTPS/SOCKS4/5 + VMess/VLESS/Trojan/SS + 订阅（v1.3） |
| [docs/translate.md](docs/translate.md) | **翻译功能：15 种常用翻译 API 全矩阵 + 后台可视化配置 + 一键测试**（v1.4） |
| [docs/upstream-services.md](docs/upstream-services.md) | **上游服务与可塑性：TTS/更新源/扩展代理后端化 + 同步服务器全接口自动跟随**（v1.4.2） |
| [docs/build-client.md](docs/build-client.md) | 自托管 Runner 搭建与 Chromium 编译全流程 |
| [docs/build-cnb.md](docs/build-cnb.md) | CNB 云原生构建（双平台策略：轻量校验默认跑/重编译手动触发）（v1.3） |
| [docs/deploy-server.md](docs/deploy-server.md) | 服务端部署（All-in-One/compose、环境变量、S3 桶、反代） |
| [docs/policy-dictionary.md](docs/policy-dictionary.md) | 全部策略键与客户端执行点对照（含策略指令下发/撤销语义） |
| [docs/api-contract.md](docs/api-contract.md) | 接口契约与 WebSocket 信令协议 |
| [docs/roadmap.md](docs/roadmap.md) | v0.1 → v1.5 迭代路线 |

## 版本与发布

- 每次提交对应一个 tag（`v0.1.0` 起），tag 与 Release 一一对应；Release 附更新记录（更新内容见 [CHANGELOG.md](CHANGELOG.md) 与 Release Notes）。
- 发布操作：`scripts/release.sh <version>`（提交、打 tag、推送、创建 Release 一条龙）。

## 许可证

客户端补丁基于 Chromium 开源项目，遵循 BSD-3-Clause（见 [LICENSE](LICENSE)）；自研业务代码同样以 BSD-3-Clause 发布。NodeByte Browser 与 Chromium 开源项目无隶属关系。
