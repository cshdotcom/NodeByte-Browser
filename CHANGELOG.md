# Changelog / 更新记录

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 格式；
版本号遵循语义化版本（SemVer）。每个版本对应一个 git tag 与一个 GitHub Release。

所有显著变更记录于此。每个提交打一个 tag，Release Notes 中含该次提交的详细更新记录。

## [Unreleased]

## [1.1.0] - 2026-09-25

### Added（云端直编 + 产品本地化）
- **GitHub Actions 托管 Runner 云端直编**（`build-nodebyte-browser.yml` 全面重写，不再依赖自托管构建机）：
  - 三平台并行任务：Linux x64（`ubuntu-22.04`）、Windows x64（`windows-2022`）、Android arm64（`ubuntu-22.04` + `target_os=android`）
  - 编译流程：官方 depot_tools → `fetch --no-history chromium` **正式 stable 源码**（版本号动态取自 Google versionhistory API，失败回落保底版本）→ 应用 NodeByte 补丁集 → `autoninja` → 打包 standalone 成品
  - 托管限制专项优化：`jlumbroso/free-disk-space` 释放约 50GB 磁盘、零符号（`symbol_level=0`）、禁用 ThinLTO/PGO、单 job 355 分钟上限、保留 swap 供链接阶段使用
  - Windows 任务 `continue-on-error`：即使 Windows 编译超时，Linux/Android 产物照常发布
  - **tag 推送自动把成品上传到对应 GitHub Release**（`publish-release` 任务）
- `client/gn/args-hosted-{pc,win,android}.gn`：托管 Runner 专用 GN 参数（无官方优化，6 小时内可控）
- `client/scripts/package_linux.sh`：Linux standalone 便携包（tar.zst/gz，含 nodebyte 启动器与版本说明）
- 补丁应用 best-effort 模式：0100–0199 新增文件补丁强制应用；0200+ 核心 hook 补丁在托管基线（最新 stable）漂移时告警跳过、允许功能降级
- `sync_chromium.sh` 重写：动态获取官方最新 stable 版本、`TARGET_OS` 注入（Android 首次同步即含 SDK/NDK）、托管无 root 时走 sudo 安装依赖
- **产品名本地化**（`nodebyte_branding.{h,cc}`，并入补丁 0100）：软件自动识别安装设备语言——中文环境显示「NodeByte 浏览器」，其余显示「NodeByte Browser」；UI 展示点低侵入逐个切换

### Changed
- `build_pc.sh` / `build_android.sh` / `package_windows.sh` 支持 `ARGS_FILE` / `OUT_SUFFIX` / `DEPOT_TOOLS_DIR` 环境变量，托管与自托管共用一套脚本
- 仓库更名：`chromium-build` → **`NodeByte-Browser`**

## [1.0.0] - 2026-09-25

### Added（工程化收官）
- `.github/workflows/`：三大工作流落地
  - `server-ci.yml`：托管 Runner 完成 server 依赖安装、TypeScript 类型检查、`next build` standalone 构建、产物上传，`ws-service` 语法校验
  - `client-validate.yml`：托管 Runner 完成 shellcheck 脚本检查、补丁集与源码树一致性校验（gen_patches 再生成比对）、补丁格式校验
  - `build-nodebyte-browser.yml`：自托管 Runner（标签 `linux-build-box`）执行完整 Chromium 编译（PC + Android），支持 workflow_dispatch 手动触发
- `scripts/release.sh`：一键发布脚本（提交 / 打 tag / 推送 / 创建 Release）
- `docs/` 文档收官：build-client（自托管 Runner 全流程）、deploy-server、api-contract、policy-dictionary、roadmap
- README 全面完善：结构图、快速开始、状态码表、文档索引

## [0.9.0] - 2026-09-25

### Added（客户端构建工程）
- `client/patches/`：由 `scripts/gen_patches.sh` 从 `src-nodebyte/` 自动生成的补丁集
  - 新文件型补丁（稳定可应用）：branding/protocol、policy_extend、sync、cookie_sessions、drop、fingerprint、webui 控制器
  - Hook 型小补丁（标注基线「需核实」）：policy_registry 注册、沙箱启动参数、JS/WS 管控、离线游戏资源替换
- `client/gn/`：`args-dev.gn`（组件编译/关 LTO）、`args-release-pc.gn`、`args-release-android.gn`
- `client/scripts/`：`sync_chromium.sh`、`sync_chromium_android.sh`、`apply_patches.sh`（--3way 失败即退出并输出冲突文件）、`build_pc.sh`、`build_android.sh`、`gen_patches.sh`、`package_windows.sh`
- `client/installer/NodeByteBrowser.iss`：Inno Setup 安装脚本（双路径自定义、安装语言选择、注册表 UserData/SyncServer 标记、卸载不删用户数据）

## [0.8.0] - 2026-09-25

### Added（nodebyte:// WebUI 资源）
- `client/webui/login/`：NodeByte 登录页（JWT/TOTP 对接、业务状态码处理、中英双语）
- `client/webui/drop/`：Drop 侧边栏应用（消息、文件、标签页推送、Cookie 会话集切换、协作入口，策略置灰）
- `client/webui/settings/`：设置段示例（同步服务器地址、代理段敏感字段 UI 隐藏、mandatory 置灰逻辑）
- `client/webui/offline-game/`：自研离线小游戏「NodeByte Runner」（Canvas，横版躲避+道具+本地最高分，替代 dino）

## [0.7.0] - 2026-09-25

### Added（客户端低侵入源码树）
- `client/src-nodebyte/chrome/browser/nodebyte/`：
  - `nodebyte_constants`（产品名/协议/版本常量）、`nodebyte_protocol`（nodebyte:// 处理）
  - `policy_extend/`：`CloudOrgPolicyProvider`（从 `/api/client/policy` 拉取注入原生 PolicyService）+ 全量自定义策略键定义
  - `sync/`：自定义同步客户端（增量变更日志、AES-GCM 客户端加密、`.custom-browser-backup` 导出）
  - `cookie_sessions/`：多 Cookie 会话集存储（加密 SQLite、隔离分区注入/回写、HttpOnly 内核层读写）
  - `drop/`：Drop 侧边栏容器协调器（WebContents 承载 nodebyte://drop）
  - `fingerprint/`：指纹模板管理（HTTP 头/Navigator/WebGL/AudioContext 模拟配置）
  - `mojo/nodebyte.mojom`：Account/Sync/Drop/Policy/Collab 五大 Mojo 接口定义
- `client/src-nodebyte/chrome/browser/ui/webui/nodebyte/`：login/drop/settings WebUIController 骨架

## [0.6.0] - 2026-09-25

### Added（实时通道与部署）
- `server/ws-service/`：独立 WebSocket 信令服务（附录D 协议：hello 鉴权、device_status、command 下发、push_message、session_revoked、policy_update、协作信令转发）
- `server/sql/init.sql` 收尾：`user_security_log` 表、审计表防改删触发器、种子数据
- `server/Dockerfile` + `docker-compose.yml`：postgres/minio/ws/next 一键编排，MinIO 桶自动初始化
- `server/scripts/bootstrap.mjs`：管理员账号、默认用户组、默认策略集、system_setting 引导

## [0.5.0] - 2026-09-25

### Added（Web 前台与管理后台 UI）
- 前台：登录页（TOTP 可选）、自助注册（邮箱验证码，受 `enable_public_register` 开关控制）、忘记密码（方式 A/B）、2FA 绑定引导
- 网页个人中心 `/u`：资料与头像、云存储用量进度条、设备管理与远程吊销、安全日志、DROP 历史
- 管理后台 `/admin`：概览、用户管理（搜索/筛选/分页/批量操作二次确认）、用户组、策略集可视化编辑、文件管理（管理员二次密码鉴权）、扩展管理、协作会话、审计日志、系统设置
- 中英双语 i18n（cookie 持久化，默认中文），统一设计系统 CSS

## [0.4.0] - 2026-09-25

### Added（管理后台 API）
- 用户管理：创建（有效期 0=永久）/ 修改 / 启用禁用封禁 / 重置密码 / 强制重置 2FA / 吊销设备 / 级联删除（高危二次确认）
- 用户组与功能黑白名单：组配额、feature_policy 键值管理
- 策略集：mandatory/recommended/sensitive_fields 全量 CRUD
- 文件管理 + `admin_session` 二次鉴权（15 分钟、绑定 target_user_id、不能跨用户）
- 扩展管理：包下发 / ID 下发（cache_internal / external_store）/ 安装结果日志
- 审计日志查询（不可改删）、系统设置（enable_public_register / SMTP / 默认组与默认配额）

## [0.3.0] - 2026-09-25

### Added（客户端对接与业务 API）
- 认证：`POST /api/auth/login|logout`、自助注册（send-code/verify）、忘记密码 A/B、修改密码
- 2FA：TOTP（RFC-6238）setup/enable/disable，强制绑定策略返回 40301
- `GET /api/client/policy`：合并策略下发（用户独立 > 用户组 > 全局默认）+ quota + forceInstallExtensions + policyVersion
- 设备：状态上报（REST/WebSocket 双通道）、设备列表、吊销
- 同步：`/api/sync/[type]`（bookmarks/history/settings/cookie_sets/fingerprints/proxy/extensions/passwords/preferences），密文 blob 上传下载、增量版本、策略校验（CustomAllowSync/CustomSyncDisabledTypes → 40303）
- Drop：消息（tab_page/session_context/collab_invite）、文件（MinIO 预签名直传、配额校验 41301）、会话上下文分享/撤销
- 协作：会话创建（有效期 token）、邮箱批量邀请（不存在邮箱明确报错）、媒体权限申请/审批、踢人/销毁
- 个人中心：资料/头像（特殊元数据 file_type=avatar）/设备/安全日志

## [0.2.0] - 2026-09-25

### Added（服务端基座）
- `server/sql/init.sql`：PostgreSQL 核心表 DDL（users/user_group/user_group_member/user_group_feature_policy/policy_set/user_devices/system_setting/user_cloud_usage/sync_snapshot/user_file_meta/device_push_message/user_shared_session_store/collab_session/collab_participant/admin_session/admin_audit_log）
- `src/lib/status.ts`：业务状态码约定与统一 JSON 信封 `{code, message, data}`
- `src/lib/crypto.ts`：JWT HS256 签发校验、TOTP（RFC-6238）+ Base32、AES-256-GCM 加解密（零第三方依赖实现）
- `src/lib/db.ts`：pg 连接池与参数化查询助手
- `src/lib/policy.ts`：策略三级合并（用户 override > 用户组策略集 > 全局默认）
- `src/lib/quota.ts`：配额优先级（用户独立 > 组 > 全局）与用量校验（超限 41301）
- `src/lib/audit.ts`：管理员审计 + 用户安全日志写入
- `src/lib/minio.ts`：MinIO/S3 客户端与预签名 URL
- `src/lib/auth.ts`：请求鉴权链（JWT → 账号状态/有效期 → 2FA 绑定态 → 功能黑白名单）
- `package.json` / `tsconfig.json` / `next.config.mjs`（standalone 输出）/ `.env.example`

## [0.1.0] - 2026-09-25

### Added（仓库骨架）
- README / LICENSE（BSD-3-Clause）/ CHANGELOG / .gitignore
- `docs/architecture.md`：总体架构与业务主链路
- `docs/roadmap.md`：v0.1 → v1.5 迭代路线（客户端 + 服务端合并视图）

[Unreleased]: https://github.com/cshdotcom/chromium-build/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/cshdotcom/chromium-build/compare/v0.9.0...v1.0.0
[0.9.0]: https://github.com/cshdotcom/chromium-build/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/cshdotcom/chromium-build/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/cshdotcom/chromium-build/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/cshdotcom/chromium-build/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/cshdotcom/chromium-build/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/cshdotcom/chromium-build/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/cshdotcom/chromium-build/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/cshdotcom/chromium-build/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/cshdotcom/chromium-build/releases/tag/v0.1.0
