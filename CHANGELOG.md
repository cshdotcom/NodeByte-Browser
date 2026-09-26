# Changelog / 更新记录

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 格式；
版本号遵循语义化版本（SemVer）。每个版本对应一个 git tag 与一个 GitHub Release。

所有显著变更记录于此。每个提交打一个 tag，Release Notes 中含该次提交的详细更新记录。

## [Unreleased]

## [1.4.3] - 2026-09-26

### Added（两份提示词逐项校对轮：补齐翻译矩阵缺口 + 编译默认搜索引擎常量）

- **逐项校对结论**：对《客户端源码开发提示词》（682 行）与《服务端后台开发提示词》（731 行）
  共 85 个校验点用脚本逐条对照代码证据重新核验（docs/feature-checklist.md 全面重写）。
- **翻译矩阵 15 → 18 种**（补齐首轮点名但未收录的三家）：
  - `papago`：Naver Developers，X-Naver-Client-ID/Secret 双头，每日 1 万字符免费；
  - `volcengine`：火山引擎翻译（字节跳动），Volcengine V4 HMAC-SHA256 签名链零依赖实现，
    x-content-sha256/x-date 参与签名，每月 200 万字符免费（以官方为准）；
  - `caiyun`：彩云小译，X-Authorization token，trans_type（auto2zh/en2zh…），免费版每月 100 万字符。
- **运行时冒烟**：`server/scripts/translate-runtime-smoke.mjs`（stub fetch，17 项）——
  真实执行三家适配器，验证请求构造、签名链（Authorization/Credential/_signedHeaders/摘要）与语言映射路径；
  静态自测扩至 86 项；真实网络抽查 google_free 121ms 通。
- **客户端常量补齐**：`nodebyte_constants.h` 新增 `kDefaultSearchEngineName = "Bing"` 与
  `kDefaultSearchURL`（编译默认必应；此前仅指令注册表与注释引用，常量缺失）；patch 0100 重新生成干跑通过。
- **校对记录的诚实修正**（feature-checklist v1.4.2 版）：客户端 WS 信令客户端（hello/device_status/
  command/policy_update 完整实现）、一键登录绑定（提示词 5.1.6）为骨架/未完成状态，从 ✅ 修正为 ⏳ 并列入二期。
- 文档同步：docs/translate.md、docs/api-contract.md、README.md 计数与矩阵更新；
  管理端下拉由 API 元信息自动扩展，客户端 WebUI（设置页/翻译面板）同步 18 种。


## [1.4.2] - 2026-09-26

### Added（可塑性动态服务器绑定 + TTS/更新/扩展代理三项后端代理改造 + CNB 自动建仓）

- **可塑性（用户核心需求：同步服务器地址改了 → 所有接口自动跟随）**：
  - 客户端铁律：任何模块禁止写死服务器地址，全部经 `NodeByteProtocol::ApiBase()` 动态取「当前生效地址」
  - 解析优先级：策略指令 NodeByteSyncServerOverride > 用户设置 > 编译默认
  - 变更传播 `NotifySyncServerChanged`：同步重拉策略 → WebSocket 重连 → Drop/翻译/TTS/更新/扩展各模块基地址缓存失效重建，无需重启浏览器
  - 覆盖接口：策略/同步/Drop/认证/文件/翻译/TTS/检查更新/扩展下载/WebSocket 全清单（docs/upstream-services.md 1.3）
- **TTS 朗读改为后端代理**（原方案客户端直连 Edge 公有云 → 改造）：
  - `server/src/lib/tts.ts` 三上游：`edge_tts_server`（自托管免费无限，默认启用）/ `azure_speech`（F0 50 万字/月，SSML）/ `openai_speech`（OpenAI 兼容，含本地）
  - `POST /api/tts` 返回音频流（mp3/ogg/wav）；登录 + 策略 NodeByteTtsEnabled + 单次上限 NodeByteTtsMaxChars（3000）
  - `GET/PUT /api/admin/tts-config` + `POST /api/admin/tts-test`（一键合成测试）
  - 音色/元信息 `GET /api/tts`；设置页新增「朗读」段（音色选择 + 试听按钮）
- **浏览器更新检查改为后端代理**（原 Chromium Omaha/Google 更新源 → 改造）：
  - `GET /api/client/update?platform&arch&version`：后台手工版本清单 或 上游 manifest JSON 转发双模式
  - 语义化版本比较；支持强制更新标志、各平台下载地址（win-x64/android-arm64/linux-x64…）
  - 策略 NodeByteUpdateCheckEnabled
- **扩展商店代理下载**：
  - `GET /api/client/ext-download?store=edge|chromeweb&extId`：后台启用代理 + Edge/Chrome 镜像模板（{extId} 占位），未启用回退直连
  - 策略 NodeByteExtProxyDownload
- **后台「上游服务」面板**（新标签页）：TTS / 更新源 / 扩展代理三卡片（增删改排序 + 凭据按类型动态渲染 + 一键测试 + 密钥脱敏/merge）
- **策略键新增（纳入指令下发/撤销）**：NodeByteTtsEnabled / NodeByteTtsMaxChars / NodeByteUpdateCheckEnabled / NodeByteExtProxyDownload
- **客户端常量**：kApiPath* 全接口路径常量 + ApiBase 动态推导注释铁律 + TTS/更新/扩展策略键（patch 0100 重新生成）
- **CNB 自动建仓**（用户指令：API 已给，自己弄）：
  - 拉取 api.cnb.cool swagger 定位 `POST /{slug}/-/repos` → 在用户组织 `nodebyte-browser` 下创建 `NodeByte-Browser`（201）
  - push-cnb.sh 默认路径更新为 `nodebyte-browser/NodeByte-Browser`；已推送 main + 全部 tags（v0.1.0~v1.4.1）
- **CI**：upstream-selftest.mjs（30 项）加入 CNB lite-validate 与 GitHub server-ci；本地预检 tsc/standalone/三自测（100+ 项）/9 补丁干跑全过

## [1.4.1] - 2026-09-26

### Added（翻译 API 全矩阵 15 种 + 后台可视化配置 + 一键测试）

- **翻译接口扩充到 15 种常用 API**（server/src/lib/translate.ts 重构为适配器注册表）：
  - **免 Key 默认梯队**（开箱即用）：`google_free`（Google 免费端点 client=gtx，**实测可用**）→
    `edge_free`（Edge 匿名 JWT，与新版 Edge 同款）→ `mymemory`（5000 词/天，**实测可用**）
  - **开源自托管**：`libretranslate`（公共实例已收紧，Docker 自托管无限）、`lingva`（公共实例被 CF 盾，自托管可用）、`deeplx`
  - **官方免费额度**（后台填 Key 即用）：`deepl`（50 万字/月）、`microsoft`（Azure 200 万字/月）、
    `baidu`（MD5 签名）、`youdao`（SHA-256 v3 签名）、`tencent`（**TC3-HMAC-SHA256 签名链**，500 万字/月）、
    `aliyun`（HMAC-SHA1 RPC 签名，100 万字/月）、`niutrans`（100 万字/月）、`yandex`
  - **LLM 翻译**：`openai_compat`（ChatGPT/DeepSeek/Ollama/vLLM，任意 OpenAI 兼容端点，本地模型免 Key）
  - 全部**零第三方依赖**（MD5/SHA-256/TC3/SHA1 签名均 node:crypto 手写）；per-provider 语言代码映射（zh-CN/zh/ZH/zh-CHS/zh-Hans 自动转换）
  - **默认梯队实测排序**：2026-09 实测 google_free（1s）与 mymemory（0.8s）可用；argosopentech 公共实例已关停、libretranslate.de 跳转需 Key → libretranslate/lingva 默认停用，自托管后启用
- **后台管理端「翻译配置」面板**（/admin 新标签页）：
  - 总开关 / 默认目标语言 / 缓存 TTL / 翻译审计
  - 接口列表：类型下拉（15 种）+ 端点覆盖 + 凭据字段**按类型动态渲染**（API Key / APPID+密钥 / Key+区域 / Key+模型）+ 权重 + 启用
  - ↑↓ 排序（weight 优先级）、添加/删除接口
  - **一键测试**：`POST /api/admin/translate-test` → ✓/✗ + 延迟 ms + 译文样例（未保存配置也可测）
  - **密钥保护**：回显脱敏 `••••••••`，留空保存 = 保留原密钥（服务端 merge 按 provider+appId 匹配继承）
  - 修改写管理员审计；密钥仅存服务端，浏览器端只见脱敏清单
- 客户端 WebUI 同步更新：nodebyte://translate 顶栏与设置页翻译段列出 15 种接口说明
- translate-selftest 扩充到 **70 项**（15 类型注册/15 适配器/语言映射/4 种签名算法/路由完整性/后台面板）

### 架构确认（用户原话：「浏览器里面的内容可以先走后端，再通过后台配置再连接到服务器」）
- 客户端只访问 `POST /api/translate`（登录态 JWT）
- 后端按「后台翻译配置」的接口顺序连接上游；上游地址与密钥永不下发浏览器
- 一条接口失败自动降级下一条；缓存命中直接返回不烧上游配额

## [1.4.0] - 2026-09-26

### Added（开源免费翻译 API + CNB 编译机会保护）

- **翻译功能**（用户需求：开源免费翻译 API，docs/translate.md）：
  - **多供应商聚合 + 自动降级**：服务端 `server/src/lib/translate.ts` 按 weight 依次尝试 **LibreTranslate → Lingva → MyMemory → DeepLX**，首个 200 OK 即返回；全部失败抛 AggregateError（含每供应商错误明细）
  - **零依赖 API Key**：默认全部走公共实例（libretranslate.de / lingva.ml / api.mymemory.translated.net 等），自托管时管理员在 `/api/admin/translate-config` 配置 `providers[]`（含 endpoint/apiKey/weight）
  - **服务端缓存**：in-process Map 缓存（key=sha256(text)+lang 对，TTL 默认 168h=7 天），命中即返回 cached=true，避免烧公共实例配额
  - **接口**：`GET /api/translate`（语言列表 + 当前 providers，脱敏不含 apiKey）；`POST /api/translate`（text/source/target/format）；`GET/PUT /api/admin/translate-config`（管理员配置）
  - **客户端 C++**：`chrome/browser/nodebyte/translate/translate_controller.{h,cc}` —— 整页翻译（收集文本节点 → 分批 ≤ NodeByteTranslateMaxChars 字符 → 串行调 /api/translate → 注入 JS 原地替换 DOM 保留样式 → 工具栏「已翻译✓/还原」按钮）+ 选区翻译（右键菜单 → 单次请求 → 气泡展示）+ `RestorePage()` 还原原文；patch 0180 生成并干跑验证干净应用
  - **WebUI**：`nodebyte://translate` 独立翻译面板（源/目标下拉 + 文本框 + 复制/朗读/交换/清空）；`nodebyte://settings` 新增「翻译」段（provider 选择 / 目标语言 / 「打开翻译面板」/「翻译当前页」按钮）
  - **策略键**：`NodeByteTranslateEnabled`（默认 true）/ `NodeByteTranslateAllowAnonymous`（默认 false）/ `NodeByteTranslateMaxChars`（默认 5000），全部纳入指令下发/撤销通道（撤销 → 恢复默认/清空）
  - **SQL**：system_setting 新增 `translate_config` 种子；审计 `user_security_log.event_type='translate_text'`（默认关，可由管理员 auditLog 开关启用）
- **CNB 编译机会保护**（用户提醒：只有 2 次编译机会）：
  - docs/translate.md 七节明确「翻译功能不触发 CNB 全量编译」—— 仅 lite-validate（Shell 语法/补丁干跑/tsc/standalone 构建/CSV 自测），全部确定性通过
  - 建议流程：先在 GitHub Actions 跑通 → 再上 CNB；不要轻易触发 `web_trigger: nodebyte-chromium-build`
  - 仅当确需 Chromium 产物时才用 CNB 核时；本次提交后默认 push 不消耗核时

## [1.3.2] - 2026-09-25

### Fixed（客户端资产校验工作流修复）
- **补丁集模式归一**：生成环境权限位差异导致 0100–0150 补丁内嵌 `new file mode 100755`，
  干净环境重新生成则为 `100644`，CI「补丁一致性比对」失败 —— 全量重新生成（100644）并提交，
  0160/0170（extensions/import）同步校正
- client-validate.yml 加固：比对前 `git config core.fileMode false`，免疫文件权限位噪音
- 结论：补丁集与 src-nodebyte 源码树重新收敛，Validate-Client-Assets 恢复通过

## [1.3.1] - 2026-09-25

### Added
- `scripts/push-cnb.sh`：CNB 一键推送脚本（自动配置 remote + 推送 main/tags，含构建入口提示）
- docs/build-cnb.md 补充 CNB 新账号建仓实测说明（个人空间无 API 建仓端点 / 根组织年度额度限制 / push 不自动建仓 → 网页端首次建仓一次即可）

## [1.3.0] - 2026-09-25

### Added（数据批量导入体系 + 策略指令撤销 + 加速器协议矩阵 + CNB 双平台）

- **CSV 批量导入体系**（三通道，docs/data-import.md）：
  - **管理端导入中心**（/admin 新模块）：上传 CSV → 服务端解析预览（列映射自动识别、有效行统计、告警清单、密码脱敏预览）→ **批量选择用户**（搜索/分页多选、翻页累计勾选、按组批量、一键全部用户）→ 合并/覆盖模式 → 二次确认 → 执行报告；全流程落审计（import_data_to_users）
  - **个人中心/前台自助导入**（/u 新「数据导入」标签）：只能导入到**自己**账号（服务端强制 target=self，不信任前端），导入计入个人云配额
  - **浏览器设置内导入**（nodebyte://settings 数据导入段）：CSV 密码/书签/历史直接写入本机加密存储（PasswordStore/BookmarkModel 文件夹层级/History 去重合并），按同步项勾选状态增量上传
  - **格式兼容**：Chrome/Edge（name,url,username,password）、Firefox、Bitwarden（login_uri,login_username,login_password）导出格式与中英文列别名自动识别；RFC-4180 解析（引号转义/字段内逗号换行/BOM/CRLF），服务端 csv.ts 与客户端 data_importer.cc 同源规则；20MB/10 万行护栏 + 零依赖自测（server/scripts/csv-selftest.mjs）
  - **账号下发通道**：`GET /api/sync/imported` 拉取待下发数据 → 客户端转端到端加密 → `POST ack` 删除服务端副本（密码服务端仅静态加密暂存，收敛为「零明文、零副本」）
  - 新增表：import_batch / user_imported_passwords / user_imported_bookmarks / user_imported_history
- **策略指令（下发/可撤销）**（docs/policy-dictionary.md 五）：
  - 新表 policy_directive + `/api/admin/directives`（create/revoke/list，作用域 global/group/user，高危开关二次确认）
  - `/api/client/policy` 响应新增 `directives[]`（生效指令，优先级最高）与 `revoked[]`（近 30 天撤销），指令变更纳入 policyVersion 指纹
  - **撤销语义**（按用户需求逐字实现）：撤销后客户端**删除该指令的本地强制配置** —— 开关恢复默认值（强制开→回到关；强制关→回到开）、地址/文本/数字/JSON **清空**、搜索引擎恢复**编译时默认搜索引擎（必应）**；客户端 `directive_applier.cc` 幂等执行 + 指令被物理删除时自动收敛
  - 服务端注册表 directive-registry.ts（39 键 + 默认值 + 高危标记）与客户端 SwitchDefaultForKey 对齐；后台「策略指令」面板（状态筛选/创建/撤销语义确认弹窗）
- **加速器第三方代理协议支持矩阵**（docs/accelerator.md）：
  - 原生：HTTP / HTTPS / SOCKS4 / SOCKS5（net/proxy_resolution）；第三方：VMess / VLESS / Trojan / Shadowsocks（方案 B 本地 Xray，inbound socks5 → 协议出站）+ 订阅 URL 自动更新
  - 策略键：NodeByteAcceleratorEnabled / NodeByteAcceleratorProtocols / NodeByteAllowCustomProxy；UI 协议选择与敏感字段掩码；平台差异（Windows 本地二进制 / Android 应用内组件）
- **安卓端手动安装插件 + 上传自己的插件**：
  - 新增 `chrome/browser/nodebyte/extensions/extension_installer.{h,cc}`：crx/zip 本地安装（Windows 直装；Android 经 SAF 拷贝入私有目录走同一管线）、同步恢复静默重装、强制下发（Edge→Chrome 商店回退 + 失败上报全字段）、UploadExtensionToSync（EXTENSION_BLOB 计配额）、强制扩展 UI 置灰判断
  - 策略键 AllowUserSelfInstallExtension / AllowUserUploadOwnExtension
- **客户端导入引擎**：新增 `chrome/browser/nodebyte/import/data_importer.{h,cc}`（CSV 三类解析/写入本机加密存储/账号下发通道/浏览器导入支持判断），补丁组 0160/0170 生成并验证干净应用
- **CNB 双平台构建**：
  - `.cnb.yml`：push 默认仅跑轻量校验（Shell 语法 + 补丁干跑 + 服务端 tsc/standalone 构建 + CSV 自测，确定性通过）；Chromium 全量编译用 web_trigger 手动触发且带 ci_precheck.sh 硬件预检（磁盘/内存/核数不足立即失败）——确保不浪费免费核时
  - `client/scripts/ci_precheck.sh` / `ci_build_all.sh`；docs/build-cnb.md 平台指南
- 文档：docs/data-import.md、docs/accelerator.md、docs/feature-checklist.md（两份提示词逐项对照表）、docs/build-cnb.md；policy-dictionary/api-contract 同步更新

### Changed
- 设置 WebUI（nodebyte://settings）扩展四段：数据导入、同步项勾选（9 类 + 策略置灰）、加速器协议、扩展插件管理
- policy-defaults.ts 新增加速器/导入相关键；audit 新增 import_data_to_users / create_policy_directive / revoke_policy_directive
- /api/client/policy 的 MergedPolicy 类型扩展（directives/revoked）

## [1.2.1] - 2026-09-25

### Fixed（对象存储切换 RustFS —— 首个可用的 All-in-One 镜像）
- **内嵌对象存储由 MinIO 官方二进制切换为 RustFS 1.0.0**（Apache 2.0，S3 兼容，MinIO API 直接替代）：
  - 原因：MinIO 已于 2025 年停止社区二进制分发（`dl.min.io` 全线返回 410 Gone），官方镜像与下载源均不可用于新部署
  - RustFS 为纯 HTTP/S3 单进程（无 gRPC 集群拓扑），musl 静态二进制 `x86_64` + `aarch64` 双架构开箱即用
  - **应用端零改动**：`minio` SDK 客户端直连 RustFS；已实测验证七桶创建、SigV4 预签名 PUT/GET、listBuckets 全链路 200
  - 凭据统一走 `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD`（entrypoint 自动映射为 RustFS 进程端与应用端两套变量）
- `server/docker-compose.yml` 分体部署同步切换：`minio` 容器 → `rustfs/rustfs:latest`（双架构），`s3-init` 内置等待重试（不依赖镜像内健康检查工具）
- README / docs/deploy-server.md 措辞同步更新（S3 桶规划、架构图、部署说明）

## [1.2.0] - 2026-09-25

### Added（All-in-One 服务端镜像 + 全新品牌图标）
- **服务端 All-in-One 单容器镜像**（`Dockerfile` + `docker/` 编排四件套）：
  - 一个镜像内嵌全部服务：**PostgreSQL + MinIO 对象存储 + WebSocket 信令 + Next.js Web（前台/后台/个人中心/登录页）+ Nginx 统一入口**，`docker run` 一条命令直接部署
  - 进程管家 supervisord 按优先级托管六进程，日志全部透出 `docker logs`
  - 数据层挂载：`/data` 卷承载 PG 数据 / MinIO 对象 / 自动生成的密钥，备份该卷即备份全部状态；`VOLUME` 声明 + 升级/回滚不丢数据
  - **首启全自动初始化**（幂等，重启/升级安全重跑）：initdb → 建用户/库 → 应用 DDL（schema 指纹变化自动重跑）→ 七业务桶创建 → 管理员账号引导
  - **密钥零配置**：`JWT_SECRET` / `DATABASE_PASSWORD` / `MINIO_ROOT_PASSWORD` / `INTERNAL_SHARED_SECRET` 留空时自动生成 40 位强随机值并持久化到 `/data/secrets/`
  - 单端口统一入口 `:8080`（Nginx）：Web/API `/`、WebSocket 信令 `/ws`（升级头透传）、**七个 S3 桶名直出反代**（预签名直传/直下保留 Host 头，SigV4 校验兼容，Drop 大文件流式转发、`client_max_body_size 2048m`）、`/healthz` 健康检查
  - 全量 `.env` 配置：`.env.docker.example` 覆盖端口、密钥、域名、配额、SMTP、远程直传域名等，`docker run --env-file` 直接用
  - 双架构镜像：`linux/amd64` + `linux/arm64`
- **Docker 镜像发布流水线**（`.github/workflows/docker-image.yml`）：Buildx 多架构构建，推送到 `ghcr.io/cshdotcom/nodebyte-server`；`main` 分支 → `main` 标签，tag `v1.2.0` → `1.2.0`/`1.2`/`latest`，PR 仅构建验证
- **全新原创品牌图标「字节光轨 The Signal Trail」**（`brand/`）：
  - 概念：极光色光轨（青 `#22D3EE` → 蓝 `#4F7DFF` → 紫 `#A855F7`）一笔画出字母 **N**，三个转折点是发光的**节点（Node）**，收笔处一颗**字节光点**拖着尾迹飞离轨道，右上一段淡轨道弧呼应互联网络
  - 矢量母版 `icon-master.svg` + 全尺寸位图 16→512px + `favicon.ico`（16/32/48 合成）+ 横版字标 `logo-horizontal.svg`，逐级简化保证小尺寸可辨识（16px 仍清晰）
  - 全量接入：Web 端 favicon/PWA/OG 图（`server/public/`）、登录页品牌位（内联 SVG）、Windows 安装器图标（`client/installer/branding/nodebyte.ico`）、Android 启动器五密度（`client/branding/android/`）
  - `brand/README.md` 记录设计理念与再生成脚本

### Changed
- 登录页品牌位：`NB` 文字占位替换为「字节光轨」图标，容器底色与母版一致
- `server/src/app/layout.tsx`：补全 favicon / apple-touch-icon / OpenGraph 图标元数据
- README：部署章节重写（方式一 All-in-One 一键部署 / 方式二 compose 分体）、仓库结构图更新

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
