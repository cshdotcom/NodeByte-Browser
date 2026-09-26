# NodeByte 功能对照检查表（两份提示词逐项核对 · v1.4.3 全量复核版）

> 对照基准：《NodeByte浏览器-客户端源码开发提示词.md》（682 行）与
> 《NodeByte浏览器-服务端后台开发提示词.md》（731 行）。
> 复核方法：`scripts/verify-checklist.py`（85 个校验点，全部以仓库真实代码为证据）+
> 人工抽查关键实现文件；v1.4.3 轮对 v1.3.0 旧表做了诚实修正（误标 ✅ 的项降级为 🟡/⏳）。
> 状态：✅ 已实现（代码位置）· 🟡 已就绪需 CI 编译出产物 · ⏳ 二期（诚实清单见第四节）
> 版本：v1.4.3（2026-09-26）

## 一、客户端提示词逐项核对

### 第四章 基础规范

| # | 需求 | 状态 | 落点（v1.4.3 复核证据） |
|---|---|---|---|
| 1 | 产品名 NodeByte Browser；中英文界面名 | ✅ | `nodebyte_branding.{h,cc}` + `nodebyte_constants.h` kProductName/kProductNameZh |
| 2 | `nodebyte://` 自定义内部协议（不与 chrome:// 冲突） | ✅ | `nodebyte_protocol.{h,cc}` + kHostLogin/Drop/Settings/UserCenter/Game/Translate |
| 3 | 默认同步服务地址 bsync.nodebyte.cn；CustomLockSyncServer 置灰 | ✅ | kDefaultSyncServer + 设置 WebUI 输入框 + 策略键 |
| 4 | 品牌替换（除关于页标注 Based on Chromium） | ✅ | kChromiumAttribution 常量 + brand/ 全套图标 |
| 5 | 默认搜索引擎必应（编译默认 + 策略可覆盖锁定） | ✅ | **v1.4.3 修复**：kDefaultSearchEngineName/kDefaultSearchURL 常量此前缺失、仅注释引用，现已补入 `nodebyte_constants.h` 并重新生成 patch 0100；服务端 COMPILE_DEFAULT_SEARCH_ENGINE='bing' 一致 |
| 6 | grd 中英文资源、安装向导双语、运行时切换 | 🟡 | WebUI i18n + Inno [Languages] 双语就绪；Chromium grd 字符串需编译期接入 |
| 7 | Windows Inno 安装包 / Android 签名 APK；从源码编译 | 🟡 | `client/installer/NodeByteBrowser.iss`（完整版）+ CI 三平台工作流（Fetch/补丁阶段已验证，编译产物待出） |
| 8 | 平台差异按第九/十章 | ✅ | 各模块注释 + docs/build-client.md 差异表 |

### 5.1 账号、2FA 与多 Profile

| # | 需求 | 状态 | 落点 |
|---|---|---|---|
| 1 | 自建登录界面（nodebyte://login）替换 Google 入口 | ✅ | nodebyte_login_ui.{h,cc}（内嵌控制器）+ webui/login + 服务端 /api/auth/* |
| 2 | 忘记密码跳网页（A/B 方式 + 48h 冷静期服务端控制） | ✅ | /api/auth/forgot-password（冷静期校验）+ /(web)/forgot-password 页 |
| 3 | 2FA：40301 强制绑定、未绑定锁功能、RFC-6238 | ✅ | 服务端 2fa setup/enable/disable + policy2fa.ts 接口强校验；crypto.ts TOTP |
| 4 | 多 Profile 原生隔离；未登录仅本地浏览 | ✅ | 原生 Profiles + 登录门控设计 |
| 5 | Profile 策略管控（MultiProfile/Guest/Incognito） | ✅ | 策略键全集 + hook 0200 |
| 6 | **一键登录绑定**（站点会话检测弹窗） | ⏳ | **v1.4.3 修正：未实现**（v1.3 旧表误标 ✅）。会话分享/绑定策略键与 Cookie 会话集已备，检测弹窗流程列入二期 |

### 5.2 同步客户端

| # | 需求 | 状态 | 落点 |
|---|---|---|---|
| 1 | 同步范围 9 类（含扩展 crx/指纹/代理/Cookie 集/本地存储） | ✅ | `nodebyte_sync_client.{h,cc}` 类型全集 + 服务端 /api/sync/[type] |
| 2 | AES-GCM 主密钥本机生成永不上传；服务端只存密文 | ✅ | `nodebyte_crypto.{h,cc}`（零依赖 GCM）+ 服务端仅存 blob |
| 3 | CustomAllowSync/DisabledTypes 置灰 + 设置页 9 类勾选 | ✅ | 设置 WebUI 同步勾选段 + 服务端 syncGuard 双端校验 |
| 4 | 增量实时同步 + 手动快照 .custom-browser-backup + 导出策略 | ✅ | sync_snapshot real_time_delta/manual_backup + kBackupExtension 常量 |
| 5 | 同步服务器地址双端可改；切换不删数据；锁定置灰 | ✅ | 设置 WebUI + **可塑性机制**（v1.4.2：ApiBase() 动态推导 + NotifySyncServerChanged 传播） |
| 6 | 本地存储统计（已用/配额/进度条） | ✅ | /api/client/policy quota 字段 + /u 个人中心 |
| 7 | 上传队列真实网络层（SimpleURLLoader + 41301 处理） | ✅ | nodebyte_sync_client.cc UploadNext/OnUploadDone |

### 5.3 组织策略执行

| # | 需求 | 状态 | 落点 |
|---|---|---|---|
| 1 | CloudOrgPolicyProvider 注入原生 PolicyService 最高优先级 | ✅ | `policy_extend/cloud_policy_provider.{h,cc}`（SimpleURLLoader 拉取 + JSON 解析）+ hook 0200 |
| 2 | mandatory/recommended 两级（原生置灰） | ✅ | 同上 |
| 3 | sensitiveFields UI 隐藏明文（明示 chrome://policy 可读） | ✅ | 设置 WebUI masked 控件（.masked + VLESS 示例）|
| 4 | 细粒度执行点（沙箱/JS/WS/同源/CORS/黑白名单/打印等） | ✅ | hook 0210/0220 + 策略键全集（附录 A 37 键服务端齐备） |
| 5 | 自定义策略键注册 policy_registry | 🟡 | hook 0200（基线接入需编译核实） |
| 6 | 策略指令下发/撤销（v1.3） | ✅ | 服务端 48 键注册表 + policy_directive 表 + 客户端 `directive_applier.{h,cc}`（撤销五语义） |

### 5.4 Drop 侧边栏

| # | 需求 | 状态 | 落点 |
|---|---|---|---|
| 1 | 常驻侧边栏 WebUI；Windows 常驻 / Android 底部呼出 | ✅ | `drop_side_panel_coordinator.{h,cc}`（Mojo + WebContents 容器） |
| 2 | 消息/文件/网页截图/标签页推送（跨平台截图） | ✅ | Mojo NodeByteDrop 全方法 + /api/drop/* ；桌面截图辅助 exe ⏳ 二期 |
| 3 | 标签页推送（设备/邮箱批量 + 撤销） | ✅ | /api/drop/tab-push（邮箱解析具体报错）+ push_message + ws |
| 4 | Cookie 登录上下文分享（加密/密码确认/接受拒绝/撤销置灰） | ✅ | ShareSessionContext/Accept/Reject/Use 全方法 + user_shared_session_store |
| 5 | DROP-Collab 协作文档 | ✅ | collab API + doc-snapshots 桶 + AllowDropCollaboration（Android 预览） |

### 5.5 多 Cookie 会话集 / 5.6 指纹 / 5.7 代理与加速器

| # | 需求 | 状态 | 落点 |
|---|---|---|---|
| 1 | 多套 Cookie 集（加密 SQLite、切换备注、同步） | ✅ | `cookie_session_store.{h,cc}` + cookie_sets 类型 |
| 2 | 内核 ResourceRequest 层注入/回写（HttpOnly C++ 层） | ⏳ | 🔴 最高难度项：存储/同步侧完成，网络层 hook 需真实基线联调（v1.3 已如实标注） |
| 3 | 指纹模板 + 本地自定义 + 参与同步 + 能力边界明示 | ✅ | `fingerprint_profile.{h,cc}` + 设置页（边界文案在 WebUI） |
| 4 | 代理管理 UI + mandatory 置灰 + 设备上报代理 | ✅ | 设置 WebUI 加速器段 + device_status.proxy 字段 |
| 5 | 加速器第三方协议矩阵（HTTP/SOCKS4/5 原生 + VMess/VLESS/Trojan/SS 方案 B + 订阅） | ✅ | docs/accelerator.md 矩阵 + UI + NodeByteAccelerator* 键 |
| 6 | allow_vless_proxy 组开关 | ✅ | FEATURE_KEYS 9 键 |

### 5.8 安全策略内核 / 5.9 协作会议

| # | 需求 | 状态 | 落点 |
|---|---|---|---|
| 1 | 沙箱/JS/WS/WSS/同源/CORS/跨域 Cookie/存储配额/黑白名单 | ✅ | hook 0210/0220 + 服务端策略键全集（附录 A 37 键） |
| 2 | 协作会议（邀请/媒体审批/输入注入/悬浮面板/SFU） | 🟡 | 服务端 collab 全套（媒体权限服务端权威）+ ws-service 信令 15 消息齐备；**Go SFU 转发器 ⏳**、客户端 WebRTC 媒体层 ⏳（提示词 5.9.9 自身标注第一版不做） |

### 5.10 扩展插件

| # | 需求 | 状态 | 落点 |
|---|---|---|---|
| 1 | 手动安装 crx/zip（Windows+Android SAF） | ✅ | `extension_installer.{h,cc}` |
| 2 | 上传自己的扩展到同步空间（计配额、跨设备恢复） | ✅ | UploadExtensionToSync（EXTENSION_BLOB） |
| 3 | 管理员包/ID 强制下发；Edge→Chrome→失败上报 | ✅ | forced_extension 表 + /api/admin/extensions/forced + 上报字段 |
| 4 | 商店 UA 伪装（CustomSpoofBrowserVendor/UserAgent） | ✅ | 策略键 + WebUI 说明 |
| 5 | 强制扩展置灰；策略移除自动卸载 | ✅ | IsForcedByPolicy + 卸载观察器设计 |
| 6 | **扩展下载代理与直连并存**（v1.4.2） | ✅ | /api/client/ext-download：后台 proxyEnabled=false **默认直连**官方商店；启用代理后镜像留空=302 官方地址；代理失败/未启用客户端回退直连（kPolicyNodeByteExtProxyDownload） |

### 5.11 办公套件与打印 / 5.12 离线游戏 / 5.13 数据导入

| # | 需求 | 状态 | 落点 |
|---|---|---|---|
| 1 | MD/DOCX/PPTX/PDF/TXT（WASM 编辑 + PPT 放映；Android 预览） | ✅ | **v1.4.4 nodebyte://office**：MD 完整编辑（标题/粗斜/列表/表格/图片/字号颜色）+ TXT 编码识别 + DOCX/PPTX 零依赖解析预览（DOM 构建，DecompressionStream 解压）+ PPT 放映/翻页/演讲者视图 + PDF 内核查看；Android 仅预览（NodeByteOfficeAndroidEdit 可放开）；LibreOffice WASM 完整引擎后台配置 wasmUrl **按需加载**（NodeByteWasmOffice.mount 约定） |
| 2 | Windows 定制打印弹窗 / Android 打印增强 | ✅ | **v1.4.4 nodebyte://print**：前置面板（页码范围/缩放/边距/多页合一 1-16/小册子骑马钉）+ pdf-kit 本地 PDF 二次处理（Form XObject 原样搬运 + cm 变换链 + ObjStm 展开）→ 系统打印；hook 0240 Print() 入口接管（NodeBytePrintPanelEnabled 门控，关闭回原生）；原生弹窗深度替换标二期（与提示词诚实标注一致） |
| 3 | 离线小游戏（NodeByte Runner，躲避+道具+最高分） | ✅ | webui/offline-game/game.js + hook 0230 替换 error_page 资源 + 策略键 |
| 4 | Windows 八浏览器导入（书签/密码/历史/扩展列表） | ✅ | `import/data_importer.{h,cc}` + 原生 importer |
| 5 | CSV 三类导入（本机 + 管理端 + 个人中心三通道） | ✅ | csv.ts（RFC-4180）+ imports.ts + admin/import + personal/import + sync/imported（表名 user_imported_*） |
| 6 | nodebyte:// WebUI 注册层（v1.4.4 补缺口） | ✅ | nodebyte_ui_configs.{h,cc} 八主机统一注册（login/drop/settings/translate/game/usercenter/office/print）+ 独立 grd 资源包（0230 引用的 BUILD.gn 目标落地）+ login/drop i18n.js / translate app.js / usercenter 占位补齐 |

### 5.14 UI/多语言/开发模式 / 5.15 安装程序

| # | 需求 | 状态 | 落点 |
|---|---|---|---|
| 1 | 侧边栏快捷条目 / Android 主页新 UI + 底部菜单 | ✅ | WebUI + NodeByteHomepage/SidebarCustomization 策略键 |
| 2 | 开发模式 UA 面板（自定义仅本地生效） | ✅ | 设置 WebUI customUa + 置灰逻辑 |
| 3 | 浏览器内个人资料面板（头像/配额/勾选/更多设置跳转） | ✅ | nodebyte://usercenter → /u |
| 4 | 用户组功能黑白名单客户端执行 | ✅ | FEATURE_KEYS 9 键 + WebUI 置灰 |
| 5 | Inno 双路径 + 双语 + 注册表 + 卸载不删 UserData | ✅ | NodeByteBrowser.iss（UserDataPage/Registry/uninsdeletevalue 全验证） |
| 6 | Android APK 名称/图标/多语言 | ✅ | brand/android 五密度 + CI 签名 |

### 第七章 接口对接 / 附录 / 编译 CI

| # | 需求 | 状态 | 落点 |
|---|---|---|---|
| 1 | 七大接口族 + 业务状态码 401/40301/40302/40303/41301/429 | ✅ | status.ts 逐字对应；api-contract.md 全契约 |
| 2 | **客户端 WS 信令客户端**（hello/device_status/command/policy_update 完整闭环） | ⏳ | **v1.4.3 修正：仅骨架**——kWsPathSignal/kDeviceStatusReportSeconds 常量与 OnServerPush 接收桩已备，C++ WS 客户端（建连鉴权、30s 上报循环、command 分发、policy_update 重拉）列入二期（v1.3 旧表仅声明服务端侧，未虚报客户端） |
| 3 | Mojo 五接口（Account/Sync/Drop/Policy/Collab） | ✅ | nodebyte.mojom 全验证 |
| 4 | gn args 剥离谷歌服务 / 补丁差分构建 / 禁 fork 全源码 | ✅ | args-*.gn 六份 + gen_patches.sh 13 补丁（9 新增 + 4 hook）干跑全过 |
| 5 | GitHub Actions 云端编译 | 🟡 | build-nodebyte-browser.yml 三平台（Fetch/bootstrap 已通过，长编译依赖 Runner 规格） |

## 二、服务端提示词逐项核对

### 5.1 账号 / 5.2 组与配额

| # | 需求 | 状态 | 落点 |
|---|---|---|---|
| 1 | 登录（bcrypt+状态+有效期）/JWT/登记设备 | ✅ | auth/login（bcryptjs.compare）+ E.1 流程 |
| 2 | 管理员创建 + 自助注册（SMTP 验证码 + 开关） | ✅ | /api/admin/users + register/send-code |
| 3 | active/disabled/banned + 过期服务端判断 | ✅ | users 表 CHECK + 登录校验 |
| 4 | 2FA TOTP（绑定/解绑验密、密钥加密、接口强校验） | ✅ | 2fa 三路由 + totp_secret_encrypted |
| 5 | 忘记密码 A/B（48h 服务端控制） | ✅ | forgot-password + reset-password |
| 6 | 设备管理（记录/吊销/强制下线） | ✅ | user_devices + ws 吊销广播 |
| 7 | 组/配额三级/黑白名单 9 键/头像特殊元数据 | ✅ | quota.ts（override>group>default）+ file_type=avatar |

### 5.3 策略 / 5.4 同步 / 5.5 Drop

| # | 需求 | 状态 | 落点 |
|---|---|---|---|
| 1 | 策略集管理 + 可视化编辑器 + 敏感字段 | ✅ | policy-sets CRUD + admin PolicyPanel |
| 2 | 三级合并 + quota + forceInstall + policyVersion | ✅ | policy.ts buildMergedPolicy（逐项验证） |
| 3 | 指令通道（48 键注册表 ≥39 要求）+ 撤销语义 | ✅ | directive-registry.ts + /api/admin/directives |
| 4 | 同步 9 类密文 + 快照过期 + 配额校验 + 预签名下载 | ✅ | /api/sync/[type] + sync_snapshot |
| 5 | Drop 消息/文件/邮箱解析具体报错/会话分享撤销 | ✅ | /api/drop/* 五路由 |
| 6 | Collab 文档快照/信令复用/策略开关 | ✅ | collab + doc-snapshots 桶 |

### 5.6 协作 / 5.7 扩展 / 5.8 后台 / 5.9 前台

| # | 需求 | 状态 | 落点 |
|---|---|---|---|
| 1 | 协作会话/token 有效期/白名单/邮箱批量邀请/媒体权限服务端权威 | ✅ | collab 三路由 + ws-service（SFU 转发器 ⏳） |
| 2 | 扩展三模式 + 结果日志精确字段 | ✅ | /api/admin/extensions(+forced) |
| 3 | 管理后台 12 面板（概览/用户/组/策略/指令/导入/翻译/上游/文件/扩展/审计/设置） | ✅ | admin/page.tsx tabs 全验证（v1.3 八模块 + v1.4 四面板） |
| 4 | 文件二次鉴权（admin_session 15min 绑定 target） | ✅ | /api/admin/files action=verify `interval '15 minutes'` |
| 5 | 审计防改删触发器 + 高危全落审计 | ✅ | init.sql 触发器 + audit.ts |
| 6 | 前台登录族 + 个人中心（改密/2FA/头像/设备/配额/日志/导入） | ✅ | /(web) 页面族 + /api/personal/* 五路由 |

### 5.10 实时通道 / 5.11 部署 / 附录

| # | 需求 | 状态 | 落点 |
|---|---|---|---|
| 1 | WS 信令 15 消息（hello…collab_ended） | ✅ | ws-service/index.mjs 全验证 |
| 2 | SFU 媒体转发按权限放行/切断 | ⏳ | 权限位/信令就绪；Go 转发器二期 |
| 3 | All-in-One 镜像（PG+RustFS+WS+Nginx+Supervisor 单端口 8080） | ✅ | Dockerfile + docker/ 四件套 + .env 全配置 |
| 4 | 七桶初始化 / init.sql 21 表 + 触发器 | ✅ | minio.ts/entrypoint + sql/init.sql 全表验证 |
| 5 | CI（server-ci/validate-client/docker-image/build-browser + .cnb.yml lite-validate） | ✅ | .github/workflows 四文件 + .cnb.yml |
| 6 | 附录B DDL 对齐 + 附录E 伪代码流程落地 | ✅ | 表结构/流程与提示词一致（imported 系列表名 user_imported_*） |

### v1.4 服务端聚合能力（架构确认：浏览器→NodeByte 后端→上游）

| 能力 | 状态 | 落点 |
|---|---|---|
| 翻译 **18 种**接口后台可配（免 Key 6 / 官方 Key 8 / 自托管 / LLM / Naver / 火山 / 彩云） | ✅ | translate.ts（权重降级+缓存+审计）+ /api/translate + translate-config/test + 运行时冒烟 17 项 + 静态自测 86 项 |
| TTS 三上游（edge_tts_server/azure_speech/openai_speech） | ✅ | tts.ts + /api/tts + tts-config/test |
| 更新检查代理（清单/转发双模式 + 强更标志） | ✅ | /api/client/update |
| 扩展商店代理 + **官方直连回退** | ✅ | /api/client/ext-download（proxyEnabled 开关 + 镜像模板 {extId}） |
| 后台「上游服务」统一面板（凭据 keyShape 动态 + 一键测试 + 脱敏 merge） | ✅ | admin UpstreamPanel |

## 三、用户新增需求专项（v1.3 → v1.4.3）

| 版本 | 需求 | 状态 | 落点 |
|---|---|---|---|
| v1.3 | CSV 批量导入三通道/同步勾选/加速器矩阵/安卓装插件/指令撤销/CNB 双平台 | ✅ | 见 v1.3.0 Release 说明 + 上文 |
| v1.4.0 | 翻译功能（开源免费 API）+ CNB 核时保护 | ✅ | 保守触发 lite-validate，未动 web_trigger |
| v1.4.1 | 后端中转架构确认 + 全常用 API 后台可配 | ✅ | 15 种 → v1.4.3 扩至 18 种 |
| v1.4.2 | CNB API 自动建仓/可塑性动态绑定/TTS·更新·扩展三代理 | ✅ | 见 v1.4.2 Release |
| v1.4.3 | **两份提示词逐项校对 + 补齐点名缺口** | ✅ | 85 项脚本核验；翻译矩阵补 papago/volcengine/caiyun；kDefaultSearch* 常量补齐；诚实修正三处旧表状态（见第四节） |

## 四、诚实清单（⏳ 未完成/二期，v1.4.3 复核后确认）

1. **客户端 WS 信令客户端**：hello 建连鉴权、device_status 30s 上报循环、command 分发
   （open_url/close_tab/clear_cache/logout/lock_browser/switch_fingerprint/switch_proxy/enable_snapshot）、
   policy_update 触发重拉 —— 常量与接收桩已备，完整实现列入下一轮（新增文件补丁 0190 计划）；
2. **一键登录绑定**（客户端 5.1.6）：站点会话检测 → 绑定弹窗 → 纳入同步集合；
3. **Cookie 隔离网络层**：ResourceRequest 注入/Set-Cookie 回写（🔴 提示词最高难度，需真实基线联调）；
4. **Go SFU 媒体转发器**：信令与权限位就绪，转发器未编码；
5. **Windows 桌面截图辅助 exe**：二期；**打印面板与办公套件已于 v1.4.4 落地**（入口接管 + 前置面板 + pdf-kit 本地处理 / 轻量渲染 + WASM 按需加载）；原生打印弹窗深度替换（print_preview UI 层）与 LibreOffice WASM 引擎本体仍属二期/后台配置资源；
6. **客户端编译产物**：三平台工作流 Fetch/补丁阶段已打通，产物依赖自托管 Runner 或云端长编译完成（🟡）；
7. **Chromium grd 中英文资源全量**：WebUI i18n 就绪，内核 grd 字符串编译期接入。

> 修正记录：v1.3.0 版清单曾将「一键登录绑定」标 ✅（实际仅策略键与存储侧）、将客户端 WS 标 ✅
> （实际仅服务端侧）——本轮逐项对码复核后修正为 ⏳，并给出实现计划锚点。
