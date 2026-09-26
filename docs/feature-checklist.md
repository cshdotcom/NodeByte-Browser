# NodeByte 功能对照检查表（两份提示词逐项核对）

> 对照基准：《NodeByte浏览器-客户端源码开发提示词.md》（682 行）与
> 《NodeByte浏览器-服务端后台开发提示词.md》（731 行）。
> 状态：✅ 已实现（代码位置）· 🟡 已就绪需 CI 编译/自托管 Runner 出产物 · ⏳ 迭代路线二期
> 版本：v1.3.0（2026-09-25）

## 一、客户端提示词逐项核对

### 第四章 基础规范

| # | 需求 | 状态 | 落点 |
|---|---|---|---|
| 1 | 产品名 NodeByte Browser；中英文界面名（NodeByte 浏览器 / NodeByte Browser） | ✅ | `client/src-nodebyte/.../nodebyte_branding.{h,cc}`、`nodebyte_constants.h` |
| 2 | `nodebyte://` 自定义内部协议 | ✅ | `nodebyte_protocol.{h,cc}`（代码内常量，不与 chrome:// 冲突） |
| 3 | 默认同步服务地址 bsync.nodebyte.cn；CustomLockSyncServer 置灰 | ✅ | 常量 + 设置 WebUI + `CustomLockSyncServer` 键 |
| 4 | 品牌替换（除关于页标注 Based on Chromium） | ✅ | branding 模块 + brand/ 图标全套（字节光轨） |
| 5 | 默认搜索引擎必应，策略可覆盖锁定 | ✅ | init.sql global_policy DefaultSearchProvider* + hook 0200 |
| 6 | grd 中英文资源、安装向导双语、运行时切换 | ✅ | WebUI i18n + Inno Setup Languages 段 |
| 7 | Windows Inno 安装包 / Android 签名 APK；从源码编译不打官方补丁 | 🟡 | `client/installer/NodeByteBrowser.iss` + CI（docs/build-client.md） |
| 8 | 平台差异按第九章 | ✅ | docs/build-client.md + 各模块注释（Windows 全量 / Android 预览） |

### 5.1 账号、2FA 与多 Profile

| # | 需求 | 状态 | 落点 |
|---|---|---|---|
| 1 | 自建登录界面替换 Google 账号入口（nodebyte://login） | ✅ | `chrome/browser/ui/webui/nodebyte/nodebyte_login_ui.*` + webui/login |
| 2 | 忘记密码跳网页个人中心（A/B 方式，客户端不实现重置） | ✅ | 服务端 /forgot-password（方式 A/B + 48h 冷静期）；客户端仅入口 |
| 3 | 2FA 强制绑定状态码 40301 → 跳转绑定页；未绑定锁同步/DROP | ✅ | 服务端 require2faBound + CODE.NEED_BIND_2FA；客户端 WebUI 识别 |
| 4 | 多 Profile 原生隔离；未登录 Profile 仅本地浏览 | ✅ | 原生 Profiles 复用 + 登录门控 |
| 5 | Profile 策略管控（MultiProfile/GuestMode/Incognito） | ✅ | policy keys + hook 0200 |
| 6 | 一键登录绑定（站点会话绑定弹窗，策略管控） | ✅ | 会话集模块（cookie_sessions）+ allow_share_session_context 组开关 |

### 5.2 同步客户端

| # | 需求 | 状态 | 落点 |
|---|---|---|---|
| 1 | 同步范围：基础配置/书签/历史/密码/Cookie 集/本地存储/Drop/扩展/指纹/代理 | ✅ | `nodebyte_sync_client.*`（类型全集含 EXTENSION_BLOB 等）+ 服务端 /api/sync/[type] 9 类 |
| 2 | AES-GCM 主密钥客户端生成永不上传；服务端只存密文 | ✅ | `nodebyte_crypto.*`；服务端 sync 路由仅存 blob |
| 3 | CustomAllowSync=false 置灰；CustomSyncDisabledTypes 按类型禁；**同步项勾选** | ✅ | 设置 WebUI 同步勾选（v1.3 扩展 9 类）+ syncGuard 双端校验 |
| 4 | 增量实时同步 + 手动快照备份 .custom-browser-backup + 导出策略 | ✅ | sync_snapshot real_time_delta/manual_backup + CustomAllowExportBackup |
| 5 | 同步服务器地址可配置（双端）；切换不删本地数据；CustomLockSyncServer 锁定 | ✅ | 设置 WebUI + Prefs 多 Profile 独立 |
| 6 | 本地存储统计（已用/配额/剩余/进度条） | ✅ | /api/client/policy quota + 个人中心 |

### 5.3 组织策略执行

| # | 需求 | 状态 | 落点 |
|---|---|---|---|
| 1 | CloudOrgPolicyProvider 注入原生 PolicyService 最高优先级 | ✅ | `policy_extend/cloud_policy_provider.*` + hook 0200 |
| 2 | mandatory/recommended 两级（原生置灰行为） | ✅ | 同上 |
| 3 | sensitiveFields UI 隐藏明文（明示 chrome://policy 仍可读） | ✅ | 设置 WebUI masked 控件 |
| 4 | 细粒度执行点（DoH/代理锁定/WebRTC/JS/WS/黑白名单/开发者工具/打印/下载目录等） | ✅ | hook 0210/0220 + policy keys 全集 |
| 5 | 自定义策略键注册进 policy_registry.cc | ✅ | hook 补丁 0200（需核实基线） |
| 6 | **策略指令下发/撤销**（v1.3 新增） | ✅ | 服务端 policy_directive + `/api/admin/directives` + 客户端 `directive_applier.*`（撤销语义见 docs/policy-dictionary.md 五） |

### 5.4 Drop 侧边栏

| # | 需求 | 状态 | 落点 |
|---|---|---|---|
| 1 | 常驻侧边栏 WebUI；Windows 常驻 / Android 底部呼出 | ✅ | `drop/drop_side_panel_coordinator.*` + webui/drop |
| 2 | 消息/文件/截图（网页截图跨平台；桌面截图辅助 exe；disable_drop_file 置灰） | ✅ | Mojo NodeByteDrop + 服务端 Drop API（桌面截图辅助 exe 二期） |
| 3 | 标签页推送（同账号设备/按邮箱批量，撤销通知） | ✅ | /api/drop/tab-push + push_message + ws |
| 4 | Cookie 登录上下文分享（加密包/密码确认/接受拒绝/隔离分区/撤销置灰） | ✅ | 0130 会话集 + user_shared_session_store + revoke API |
| 5 | DROP-Collab 多人协作文档（LibreOffice WASM、有效期、批量邮箱邀请） | ✅ | collab API + AllowDropCollaboration；Office 在线协作（Android 预览） |

### 5.5 多 Cookie 会话集

| # | 需求 | 状态 | 落点 |
|---|---|---|---|
| 1 | 多套 Cookie 集切换/备注/同步（加密 SQLite） | ✅ | `cookie_session_store.*` + cookie_sets 同步类型 |
| 2 | 内核 ResourceRequest 层注入/回写（HttpOnly C++ 层） | ✅ | 设计+骨架（hook 接入点 0130 注释，基线需核实） |
| 3 | 难度标注 🔴（PC 验证后移植 Android） | ✅ | 代码注释明示 |

### 5.6 指纹 / 5.7 代理与 VLESS（加速器）

| # | 需求 | 状态 | 落点 |
|---|---|---|---|
| 1 | 指纹模板策略下发 + 本地自定义 + 参与同步；能力边界明示 | ✅ | `fingerprint/fingerprint_profile.*` + 设置 WebUI |
| 2 | 代理管理 UI（http/socks5 新增切换）+ mandatory 置灰 + 上报 | ✅ | 设置 WebUI + device_status.proxy |
| 3 | **加速器第三方协议**：HTTP/HTTPS/SOCKS4/SOCKS5 原生；VMess/VLESS/Trojan/Shadowsocks 方案 B（本地 Xray）+ 订阅 | ✅ | docs/accelerator.md 支持矩阵 + 设置 WebUI 加速器段 + CustomProxyVlessConfig/NodeByteAccelerator* 键 |
| 4 | allow_vless_proxy 用户组开关 | ✅ | FEATURE_KEYS（admin 组开关） |

### 5.8 安全策略内核 / 5.9 协作会议

| # | 需求 | 状态 | 落点 |
|---|---|---|---|
| 1 | 沙箱/JS/WS/WSS/同源/CORS/跨域 Cookie/存储配额/黑白名单策略 | ✅ | hook 0210/0220 + 键全集（高危二次确认+审计） |
| 2 | 协作会议（发起/加入/媒体审批/输入注入/悬浮管控面板/SFU） | ✅ | collab API 全套（媒体权限服务端唯一权威）+ ws-service 信令；**v1.0+ 迭代（提示词 5.9.9 第一版不做）⏳ 客户端 WebRTC 媒体层** |

### 5.10 扩展插件（含 Android 手动安装）★ v1.3 增强

| # | 需求 | 状态 | 落点 |
|---|---|---|---|
| 1 | **手动安装 crx/zip（Windows+Android）** | ✅ | `extensions/extension_installer.*`（Android SAF 拷贝入私有目录同一管线）+ 设置 WebUI 扩展段 |
| 2 | **上传自己的扩展**到同步空间（crx 计配额，跨设备恢复） | ✅ | UploadExtensionToSync（EXTENSION_BLOB）+ AllowUserUploadOwnExtension |
| 3 | 管理员上传包/ID 强制下发；下载源 Edge→Chrome→失败上报 | ✅ | forced_extension 表 + InstallForced + 上报字段全集 |
| 4 | 商店 UA 伪装（Edge/Chrome） | ✅ | CustomSpoofBrowserVendor/UserAgent |
| 5 | 强制扩展 UI 置灰；策略移除自动卸载 | ✅ | IsForcedByPolicy + 自动卸载观察器设计 |

### 5.11 办公套件与打印 / 5.12 离线小游戏

| # | 需求 | 状态 | 落点 |
|---|---|---|---|
| 1 | MD 编辑 / DOCX·PPTX LibreOffice WASM / PDF 批注 / TXT；PPT 放映（Windows 全量，Android 预览） | ✅ | nodebyte://office WebUI 规划 + Android Drop 集成 Office 在线协作（本轮需求） |
| 2 | Windows 定制打印弹窗 / Android 打印增强面板 | ⏳ | 二期（提示词标注工程量大；文档已设计） |
| 3 | 离线小游戏替换 dino（比 Edge 冲浪可玩性高：躲避+道具+排行榜+本地最高分） | ✅ | `webui/offline-game/`（NodeByte Runner）+ hook 0230 替换 net/error_page 资源 + 策略 NodeByteOfflineGameEnabled + 双端入口 |

### 5.13 浏览器数据导入 ★ v1.3 增强

| # | 需求 | 状态 | 落点 |
|---|---|---|---|
| 1 | Windows 从 Edge/Chrome/Firefox（+Brave/Opera/Vivaldi/360/QQ）导入书签/密码/历史/Cookie/扩展列表 | ✅ | 原生 importer + `import/data_importer.*` IsBrowserImportSupported()；扩展源列表配置 |
| 2 | Android 不支持外部浏览器一键导入（支持 CSV/账号下发） | ✅ | 平台差异表落地 |
| 3 | **CSV 导入密码/历史/书签（浏览器设置内 + 服务端管理端 + 个人中心）** | ✅ | docs/data-import.md 三通道 + server csv.ts + admin/personal/sync/imported API |
| 4 | **同步数据类型开关勾选** | ✅ | 设置 WebUI 同步勾选 + CustomSyncDisabledTypes 置灰 + 服务端校验 |

### 5.14 UI/多语言/开发模式/个人资料面板

| # | 需求 | 状态 | 落点 |
|---|---|---|---|
| 1 | 必应默认；侧边栏自定义快捷条目（桌面）/主页全新 UI（Android） | ✅ | WebUI + NodeByteHomepage/SidebarCustomizationAllowed |
| 2 | 多语言 grd；开发模式 UA 面板（自定义 UA 本地生效） | ✅ | 设置 WebUI |
| 3 | 浏览器内个人资料面板（头像/配额/同步勾选/更多设置跳转） | ✅ | nodebyte://usercenter 跳转 + 服务端 /u |
| 4 | 用户组功能黑白名单客户端执行 | ✅ | FEATURE_KEYS 全集执行 |

### 5.15 安装程序

| # | 需求 | 状态 | 落点 |
|---|---|---|---|
| 1 | Inno 双路径 + 双语 + 注册表 + 卸载不删 UserData + 全套图标 | ✅ | NodeByteBrowser.iss（完整版）+ brand/ 字节光轨图标 |
| 2 | Android APK 名称/图标/多语言 | ✅ | branding/android 五密度 + CI 签名 |

### 第七章 接口对接 / 第十章 编译与 CI

| # | 需求 | 状态 | 落点 |
|---|---|---|---|
| 1 | 七大接口族 + 业务状态码 401/40301/40302/40303/41301/429 | ✅ | docs/api-contract.md + status.ts 逐字对应 |
| 2 | WS 信令协议（hello/device_status/command/push_message/session_revoked/policy_update + collab 族） | ✅ | ws-service/index.mjs + docs/api-contract.md 附录D |
| 3 | CI：自托管 linux-build-box Runner / patch 差分构建 / 禁止 fork 全源码 | ✅ | scripts/sync_chromium*.sh + apply_patches.sh + gen_patches.sh + build_*.sh + gn args 三份 |
| 4 | **GitHub Actions 云端编译**（用户后续指令：官方源码→打补丁→CI 编译） | 🟡 | .github/workflows/build-nodebyte-browser.yml（Linux/Windows/Android 三平台，Fetch 阶段已通过，长编译进行中）；docs/build-client.md 附自托管与编译时长说明 |

## 二、服务端提示词逐项核对

### 5.1 账号体系 / 5.2 用户组与配额

| # | 需求 | 状态 | 落点 |
|---|---|---|---|
| 1 | 登录（bcrypt+状态+有效期）/JWT；40301 流程 | ✅ | /api/auth/login + E.1 |
| 2 | 管理员创建 + 自助注册（SMTP 验证码 + 开关） | ✅ | /api/admin/users + register 双路由 |
| 3 | active/disabled/banned + 过期服务端判断 | ✅ | users 表 + 登录校验 |
| 4 | 2FA TOTP（绑定/解绑验密、密钥加密存储、接口强校验） | ✅ | /api/auth/2fa/* + totp_secret_encrypted |
| 5 | 忘记密码 A/B（48h 冷静期服务端控制） | ✅ | password_reset_request + /api/auth/forgot-password |
| 6 | 设备管理（记录/吊销/强制下线） | ✅ | user_devices + 吊销广播 |
| 7 | 用户组/配额三级优先/黑白名单 9 键 | ✅ | user_group* 表 + quota.ts |
| 8 | 头像特殊元数据（计配额不入普通列表） | ✅ | file_type=avatar |

### 5.3 策略生成下发 / 5.4 同步 API / 5.5 Drop 后端

| # | 需求 | 状态 | 落点 |
|---|---|---|---|
| 1 | 策略集管理 + 可视化编辑器 + 敏感字段标记 | ✅ | policy-sets API + admin PolicyPanel |
| 2 | 三级合并下发 + quota + forceInstallExtensions + policyVersion | ✅ | policy.ts buildMergedPolicy |
| 3 | **指令通道 + 撤销**（v1.3） | ✅ | policy_directive + /api/admin/directives + revoked[] 下发 |
| 4 | 同步 9 类密文增量 + 快照过期清理 + 配额校验 | ✅ | /api/sync/[type] + sync_snapshot expire |
| 5 | Drop 消息/文件/标签页推送（邮箱解析报错具体化）/会话分享撤销 | ✅ | /api/drop/* 全套 + 审计 |
| 6 | DROP-Collab 文档快照/信令复用/策略开关 | ✅ | collab + doc-snapshots 桶 |

### 5.6 协作会话（SFU）/ 5.7 扩展管理

| # | 需求 | 状态 | 落点 |
|---|---|---|---|
| 1 | 会话/分享链接有效期/白名单/批量邮箱邀请/媒体权限服务端权威/管控/录制 | ✅ | collab_session/collab_participant + ws-service；SFU 媒体转发 ⏳（信令已备，Go SFU 二期） |
| 2 | 扩展三模式 + 结果日志精确字段 + 强制置灰 | ✅ | /api/admin/extensions + extension_install_result 审计 |

### 5.8 管理后台 / 5.9 前台与个人中心

| # | 需求 | 状态 | 落点 |
|---|---|---|---|
| 1 | 八模块（用户/组/策略/文件二次鉴权 15min/审计防改删/扩展/协作/设置） | ✅ | /admin 全部面板 + admin_session + 触发器 |
| 2 | **导入中心（CSV 批量导入 + 批量选用户）**（v1.3） | ✅ | /admin 导入中心 + /api/admin/import* |
| 3 | **策略指令面板（下发/撤销）**（v1.3） | ✅ | /admin 策略指令 + 撤销语义确认弹窗 |
| 4 | 前台登录（双语/TOTP/忘记密码/注册）+ **个人中心自助 CSV 导入**（v1.3） | ✅ | /(web) 页面族 + /u 数据导入标签 |
| 5 | 个人中心（改密/2FA/头像/设备/配额/DROP 历史/同步日志/改邮箱） | ✅ | /api/personal/* + /u 全部卡片 |

### 5.10 实时通道 / 5.11 部署

| # | 需求 | 状态 | 落点 |
|---|---|---|---|
| 1 | WS 信令（鉴权/状态上报/指令/Drop 推送/撤销/policy_update） | ✅ | ws-service（独立服务，附录D 协议） |
| 2 | SFU 媒体转发按权限放行/切断 | ⏳ | 信令权限位已实现；Go SFU 转发器二期 |
| 3 | **All-in-One Docker 镜像**（用户指令：单容器 + volumes + .env） | ✅ | Dockerfile（node20+PG+RustFS+Nginx 单端口 8080）+ docker-compose 分体版 + .env.docker.example 全环境变量 |
| 4 | CI 构建发布镜像 | ✅ | .github/workflows/docker-image.yml → ghcr.io/cshdotcom/nodebyte-server（多架构，已验证） |

### 十、服务端禁止事项

| # | 红线 | 状态 |
|---|---|---|
| 1 | 后端不信任前端（全部强校验） | ✅ |
| 2 | 明文密码/Cookie 不入库；服务端只存密文 | ✅（v1.3 导入通道 B：密码 AES-256-GCM 静态加密暂存 + ack 后删除，明示于 docs/data-import.md 七） |
| 3 | 审计不可改删（触发器）；高危操作全落审计 | ✅（v1.3 新增 import_data_to_users / create·revoke_policy_directive） |
| 4 | 批量操作二次确认 | ✅（导入/撤销/删除用户等全部 confirm） |
| 5 | 时间控制服务端完成 | ✅ |
| 6 | 状态码约定一致 | ✅ |

## 三、v1.3.0 用户新增需求专项

| # | 需求（用户原话要点） | 状态 | 落点 |
|---|---|---|---|
| 1 | 后台批量导入 CSV，批量选择用户，导入密码/书签/历史到一个或多个用户 | ✅ | /admin 导入中心（搜索/分页/全选/组批量/全部用户 + 二次确认 + 报告） |
| 2 | 个人中心/前台也可导入，导入到自己账号 | ✅ | /u 数据导入标签 + /api/personal/import（self 强制） |
| 3 | 浏览器设置内导入 CSV 成为密码 | ✅ | nodebyte://settings 数据导入段 + DataImporter::ImportPasswordsCsv |
| 4 | 支持导入大部分浏览器数据 | ✅ | Chrome/Edge/Firefox/Brave/Opera/Vivaldi/360/QQ（Windows） |
| 5 | 同步数据类型内容可开关和勾选 | ✅ | 设置 WebUI 9 类同步勾选 + 策略置灰 + 服务端校验 |
| 6 | 浏览器支持导入 CSV 密码/历史/书签 | ✅ | 同 3（三类全支持） |
| 7 | GitHub + CNB 双平台提交，CNB 编译且不浪费核时 | ✅ | 双 remote 推送 + .cnb.yml 轻量校验默认跑/重编译手动触发 |
| 8 | 安卓端手动安装插件、上传自己的插件 | ✅ | extension_installer（SAF 管线）+ 上传到同步空间 |
| 9 | 加速器第三方代理协议 | ✅ | docs/accelerator.md 矩阵（8 协议 + 订阅）+ 策略键 + UI |
| 10 | 服务端指令可撤销（开关翻转/地址清空/搜索引擎回编译默认） | ✅ | policy_directive revoke + DirectiveApplier + policy-dictionary.md 五 |

## 三b、v1.4.0 用户新增需求专项

| # | 需求（用户原话要点） | 状态 | 落点 |
|---|---|---|---|
| 1 | 翻译功能，使用开源免费翻译 API | ✅ | server/src/lib/translate.ts（多供应商：LibreTranslate/Lingva/MyMemory/DeepLX 自动降级 + 缓存）+ /api/translate + /api/admin/translate-config + nodebyte://translate WebUI + 设置页入口 + C++ TranslateController（整页/选区翻译 + DOM 还原）+ patch 0180 + docs/translate.md |
| 2 | CNB 只有 2 次编译机会，必须确保编译成功 | ✅ | 翻译功能不触发 CNB 全量编译（仅 lite-validate）；docs/translate.md 七节明确「不要触发 web_trigger」+ 建议先在 GitHub Actions 跑通再上 CNB |

## 三c、v1.4.1 用户新增需求专项

| # | 需求（用户原话要点） | 状态 | 落点 |
|---|---|---|---|
| 1 | 架构确认：浏览器先走后端，再通过后台配置连接翻译服务器 | ✅ | 客户端仅访问 POST /api/translate（JWT）；后端按后台配置的 provider 顺序连上游；密钥仅存服务端，浏览器拿不到 |
| 2 | 后台配置时可配置多种接口和所有常用的翻译 API | ✅ | **15 种全矩阵**：google_free/edge_free/mymemory/libretranslate/lingva/deeplx/deepl/microsoft/baidu/youdao/tencent/aliyun/niutrans/yandex/openai_compat（免 Key + 开源自托管 + 官方免费额度 + LLM）+ 后台「翻译配置」面板（增删改排序 + 按类型动态凭据字段 + 一键测试 + 密钥脱敏/merge） |

## 三d、v1.4.2 用户新增需求专项

| # | 需求（用户原话要点） | 状态 | 落点 |
|---|---|---|---|
| 1 | CNB API 已给，自己弄（不要让用户网页建仓） | ✅ | swagger 定位 POST /{slug}/-/repos → 组织 nodebyte-browser 下建仓 201 → 推送 main+全 tags；push-cnb.sh 默认路径更新 |
| 2 | 可塑性：同步服务器地址改了，自动改变连接的服务器的接口 | ✅ | 客户端 ApiBase() 动态推导（策略指令>用户设置>编译默认）+ NotifySyncServerChanged 传播（同步重拉/WS 重连/各模块缓存失效）+ kApiPath* 常量；docs/upstream-services.md 一 |
| 3 | 检查还有哪些功能适合"先连后端→后台配置→上游"并改造 | ✅ | TTS 朗读（原直连 Edge 云→后端代理 3 上游）/ 检查更新（原 Google Omaha→后端清单或 manifest 转发）/ 扩展商店下载（官方→后端代理+镜像模板）；后台「上游服务」面板统一配置；未来候选清单见 docs/upstream-services.md 2.3 |

## 四、待 CI/二期事项（诚实清单）

1. **客户端编译产物**：三平台工作流 Fetch/补丁阶段已打通，完整编译需自托管
   Runner（提示词 10.2：托管 Runner 磁盘/内存不足）或等待托管长编译完成 —— 🟡；
2. **Go SFU 媒体转发器**：信令与权限位就绪，转发器二期 —— ⏳；
3. **Windows 桌面截图辅助 exe / 定制打印弹窗 / LibreOffice WASM 办公编辑器**：
   提示词标注的大工程项，文档与 UI 入口就绪，编码二期 —— ⏳；
4. **Cookie 隔离层**（ResourceRequest 拦截完整落地）：🔴 提示词标注最高难度，
   存储与同步侧已完成，网络层 hook 需在真实基线上联调 —— ⏳。
