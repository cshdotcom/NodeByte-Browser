# 上游服务与可塑性机制（v1.4.2）

> 用户需求：「同步服务器地址改了的话，也要自动改变连接的服务器的接口」+
> 「检查还有哪些功能适合改成：先连到后端，再通过后台配置连接服务器」。

## 1. 可塑性：动态服务器绑定（全接口自动跟随）

### 1.1 原则

**任何客户端模块禁止写死服务器地址。** 所有 API 调用统一经
`NodeByteProtocol::ApiBase()` 取「当前生效的同步服务器地址」：

```
解析优先级：
  1) 策略指令 NodeByteSyncServerOverride（mandatory，撤销 = 清空回退）
  2) 用户设置 prefs（设置页「同步服务器地址」，受 CustomLockSyncServer 锁定）
  3) 编译默认 bsync.nodebyte.cn（nodebyte_constants.h kDefaultSyncServer）
```

### 1.2 变更传播（NotifySyncServerChanged）

设置页保存新地址（或策略指令下发/撤销）时，按序通知全部模块：

1. 同步客户端：清空 in-flight 请求 → 新地址重拉 `/api/client/policy`；
2. WebSocket 信令：断开旧连接 → `wss://<新地址>/ws` 重连（hello 重鉴权）；
3. Drop / 翻译 / TTS / 检查更新 / 扩展下载：内存 API 基地址缓存失效重建；
4. 登录态：JWT 按「账号+设备」签发，与新地址服务器共享数据库则免登录；
   不同实例则按未登录处理，跳转 `<新地址>/login`。

全程**无需重启浏览器**；旧地址不保留任何明文缓存。

### 1.3 覆盖的接口清单（全部动态跟随）

| 模块 | 路径 | 说明 |
|---|---|---|
| 策略/指令 | `/api/client/policy` | 定时 15min + WebSocket policy_update 即时 |
| 同步 | `/api/sync/*`、`/api/sync/imported` | 九类数据 + 导入下发区 |
| Drop | `/api/drop/*` | 消息/文件/标签页/会话分享 |
| 认证 | `/api/auth/*` | 登录/注册/2FA/忘记密码 |
| 文件 | `/api/drop/files`、配额 | 预签名直传/下载 |
| **翻译** | `/api/translate` | v1.4.1，15 种上游 |
| **TTS 朗读** | `/api/tts` | v1.4.2，3 种上游 |
| **检查更新** | `/api/client/update` | v1.4.2 新增 |
| **扩展下载** | `/api/client/ext-download` | v1.4.2 新增 |
| WebSocket | `/ws` | 信令/推送/协作 |

## 2. 「先连后端 → 后台配置 → 上游」模式全清单

用户核心诉求：**客户端不直连第三方，统一经 NodeByte 后端代理，上游在后台可视化配置**。

### 2.1 已实现

| # | 功能 | 客户端访问 | 后台配置 | 上游 |
|---|---|---|---|---|
| 1 | **翻译**（v1.4.1） | `POST /api/translate` | 后台「翻译配置」面板：15 种接口/权重/密钥/一键测试 | Google 免费端点、Edge 匿名、MyMemory、LibreTranslate、Lingva、DeepLX、DeepL、Azure、百度、有道、腾讯云（TC3 签名）、阿里云（SHA1 RPC）、小牛、Yandex、OpenAI 兼容 LLM |
| 2 | **TTS 朗读**（v1.4.2 ★原客户端直连 Edge 公有云 → 改后端代理） | `POST /api/tts` → 音频流 | 后台「上游服务 → TTS」：3 种上游/权重/音色/密钥/一键测试 | ① 自托管 Edge TTS HTTP 服务（免费无限，推荐）② Azure 语音 F0（50 万字/月）③ OpenAI 兼容 `/audio/speech`（含本地 openedai-speech） |
| 3 | **检查更新**（v1.4.2 ★原 Chromium Omaha/Google 更新源 → 改自家后端） | `GET /api/client/update?platform&arch&version` | 后台「上游服务 → 更新源」：版本清单/各平台下载地址/强制更新/上游 manifest 转发 | 手工维护清单 或 已有更新服务器的 manifest JSON |
| 4 | **扩展商店下载**（v1.4.2） | `GET /api/client/ext-download?store&extId` | 后台「上游服务 → 扩展代理」：启用代理 + Edge/Chrome 镜像模板 | 官方商店 或 内网/国内镜像（`{extId}` 占位） |
| 5 | 电子书分享/同步存储/Drop/协作/导入 | 自家后端 | 服务端本身 | 无第三方（对象存储内嵌 RustFS） |

### 2.2 设计收益

- **密钥不出服务器**：浏览器只见脱敏 provider 清单，抓包拿不到任何上游密钥；
- **内网可用**：不出公网的组织内网，由服务器统一出口或走内网镜像；
- **可切换**：某上游被墙/停服/收费，后台改配置立即切换，无需重新发版浏览器；
- **可审计**：命中日志、管理员操作全部落审计表；
- **可降级**：多上游按权重自动 failover。

### 2.3 未来可纳入同模式（roadmap）

| 候选 | 现状 | 改造方向 |
|---|---|---|
| Safe Browsing 安全浏览 | Chromium 直连 Google | 后台配置自建 Safe Browsing 镜像或关闭（策略键预留） |
| 拼写检查服务 | Chromium 直连 Google | 后端代理或本地词典 |
| 崩溃报告 | Chromium 直连 Google crash | 后端收集（`/api/client/crash`）或关闭 |
| Variations/Finch 试验 | Chromium 直连 Google | 编译期禁用（已计划） |
| 内容拦截规则列表 | 暂无 | 后台配置规则订阅 URL，客户端经 `/api/client/filters` 拉取 |
| 天气/资讯等主页卡片 | 暂无 | 后台配置数据源 |

## 3. TTS 接口详情

### 3.1 GET `/api/tts`
返回可用音色列表 + 默认音色 + 单次上限（不含上游信息）：
```json
{ "code": 0, "data": { "voices": ["zh-CN-XiaoxiaoNeural", "…"], "defaultVoice": "zh-CN-XiaoxiaoNeural", "defaultFormat": "mp3", "maxChars": 3000 } }
```

### 3.2 POST `/api/tts`
```json
{ "text": "要朗读的文本", "voice": "zh-CN-XiaoxiaoNeural", "speed": 1.0, "format": "mp3" }
```
→ 音频二进制（`audio/mpeg | audio/ogg | audio/wav`）。登录用户；策略
`NodeByteTtsEnabled=false` 时 40303；超限 400。长文由客户端按句分段循环调用。

### 3.3 TTS 上游矩阵

| 类型 | 凭据 | 免费额度 | 部署 |
|---|---|---|---|
| `edge_tts_server`（默认启用） | 无 | 自托管无限 | `docker run -p 3000:3000` 任意 edge-tts HTTP 服务（POST /tts `{text,voice,format}` → audio） |
| `azure_speech` | key + region | F0 50 万字/月 | 云端开通即可 |
| `openai_speech` | key + model | 本地 openedai-speech 免费 | OpenAI 兼容 `/audio/speech` |

### 3.4 管理端
- `GET/PUT /api/admin/tts-config`（密钥回显脱敏，留空保存 = 保留）
- `POST /api/admin/tts-test`（合成 "你好，NodeByte 浏览器。" → 字节数 + 延迟）
- 后台「上游服务」面板三卡片：TTS / 更新源 / 扩展代理

## 4. 更新检查详情

`GET /api/client/update?platform=win|linux|android&arch=x64|arm64&version=<当前版>`

- 后台**手工清单模式**：填 latestVersion + 各平台下载 URL + 强制标志 + 说明 → 服务端语义化版本比较后返回 `{updateAvailable, latestVersion, downloadUrl, mandatory, notes}`；
- 后台**上游 manifest 转发模式**：填 upstreamManifestUrl → 服务端每次拉取转发（适合已有更新服务器，客户端零改造）；
- 策略 `NodeByteUpdateCheckEnabled=false` → 客户端隐藏「检查更新」入口。

## 5. 扩展商店代理详情

`GET /api/client/ext-download?store=edge|chromeweb&extId=<32位ID>`

- 后台启用「经服务端代理」→ 返回解析后的下载 URL（镜像模板 `{extId}` 占位或官方直连），客户端据此下载；
- 未启用代理 → 客户端回退直连官方商店（Edge → Chrome 顺序不变）；
- 策略 `NodeByteExtProxyDownload=false` → 强制回退直连。

## 6. 自测与 CI

`server/scripts/upstream-selftest.mjs`（30 项零依赖断言）已加入：
- CNB `.cnb.yml` lite-validate（不烧核时）
- GitHub server-ci
- 内容覆盖：TTS 三上游适配器、Azure SSML、路由完整性、密钥 merge、后台面板、策略键、可塑性常量。
