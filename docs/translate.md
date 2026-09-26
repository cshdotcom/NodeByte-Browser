# 翻译功能（v1.4.0 / v1.4.1 扩展）

> 用户需求：「再加一个翻译功能看看有没有什么开源免费的翻译 API」+「后台可配置多种接口和所有常用的翻译 API」。
> v1.4.1 起：**18 种常用翻译 API 全矩阵**，后台可视化配置（增删改排序 + 密钥 + 一键测试）。

## 1. 架构（用户确认）

```
浏览器/客户端（nodebyte://translate / 整页翻译 / 右键翻译）
        │ ① 登录态 JWT + POST /api/translate
        ▼
NodeByte 服务端（唯一出口）
        │ ② 策略检查（NodeByteTranslateEnabled）→ 缓存查询（sha256+lang）
        │ ③ 按「后台翻译配置」的 providers 顺序（weight 升序、仅 enabled）
        │    逐个尝试，首个成功即返回；失败自动降级下一个
        ▼
翻译上游 ×18（后台配置的接口；地址与密钥仅存服务端，客户端拿不到）
        │ ④ 写缓存（TTL 默认 168h）→ 返回
```

- 客户端**永远不直连**翻译上游 —— 只知道 `/api/translate`；
- 上游地址/API Key/APPID 仅存服务端 `system_setting`（数据库），不下发浏览器；
- 后台可配**多条接口**并存，排序即优先级，一条挂了自动切下一条；
- 服务端缓存减少上游配额消耗（TTL 可配，默认 7 天）。

## 2. 翻译 API 全矩阵（18 种）

### 无需 Key（默认梯队，实测可用性排序）

| 类型 | 名称 | 协议/来源 | 免费额度 | 默认 | 实测（2026-09） |
|---|---|---|---|---|---|
| `google_free` | Google 翻译免费端点 | 非官方 `translate.googleapis.com`（client=gtx） | 免费匿名 | ✅ 启用 | ✅ **实测可用**（1s） |
| `edge_free` | Edge 免费翻译 | `edge.microsoft.com/translate/auth` 匿名 JWT + `api-edge.cognitive.microsofttranslator.com` | 免费匿名 | ✅ 启用 | 端点文档化，随部署网络而定 |
| `mymemory` | MyMemory | `api.mymemory.translated.net` | 5000 词/天 | ✅ 启用 | ✅ **实测可用**（0.8s） |
| `libretranslate` | LibreTranslate | AGPL-3.0 | 公共实例现已需 Key；**Docker 自托管无限** | ⬜ 默认停用 | 公共实例收紧（argosopentech 已关停、libretranslate.de 跳转需 Key） |
| `lingva` | Lingva Translate | GPL-3.0，Google 代理 | 免费公共 | ⬜ 默认停用 | 公共实例被 CF 盾拦截（403），自托管可用 |
| `deeplx` | DeepLX | MIT，DeepL 代理 | 自托管无限 | ⬜ 默认停用 | 需自行 Docker 部署 |

### 需 Key（官方免费额度，后台填入即可用）

| 类型 | 名称 | 免费额度 | 凭据形状 | 签名实现（零依赖） |
|---|---|---|---|---|
| `deepl` | DeepL API Free | 50 万字/月 | apiKey | Bearer 头 |
| `microsoft` | Azure Translator F0 | 200 万字/月 | apiKey + region | 订阅密钥头 |
| `baidu` | 百度翻译开放平台 | 标准版 5 万字/月（可认证提额） | appId + key | **MD5(appid+q+salt+key)** |
| `youdao` | 有道智云 | 新用户体验金 | appKey + appSecret | **SHA-256(appKey+input+salt+curtime+secret)** |
| `tencent` | 腾讯云 TMT | 500 万字/月 | secretId + secretKey | **TC3-HMAC-SHA256 签名链** |
| `aliyun` | 阿里云机器翻译 | 100 万字/月（通用版） | AccessKeyId + Secret | **HMAC-SHA1 RPC 签名** |
| `niutrans` | 小牛翻译 | 100 万字/月 | apiKey | REST 直传 |
| `yandex` | Yandex Translate | 注册赠 100 万字 | apiKey | Api-Key 头 |
| `openai_compat` | OpenAI 兼容 LLM（ChatGPT/DeepSeek/Ollama/vLLM） | DeepSeek 约 1 元/百万 token；本地 Ollama 免费 | apiKey + model | Bearer 头 |
| `papago` | Naver | Client-ID + Secret | 每日 1 万字符免费 | 韩/英/日/中最优 |
| `volcengine` | 火山引擎 | AccessKey + SecretKey（HMAC4-SHA256 V4 签名） | 每月 200 万字符免费（以官方为准） | 字节跳动质量佳 |
| `caiyun` | 彩云小译 | Token（X-Authorization） | 免费版每月 100 万字符 | 中英日，支持整段译文 |

> 各家语言代码不同（zh-CN / zh / ZH / zh-CHS / zh-Hans），已按 provider 内置映射表（`LANG_MAPS`）自动转换。

### 为什么还有 Google 非官方端点？
- `translate.googleapis.com/translate_a/single?client=gtx` 是 Google 翻译网页版自己的免费接口，
  无需 Key、质量最好、实测可用；作为默认首选能保证「开箱即用零配置」；
- 用户如担心稳定性，可在后台把它降权或停用，改用自有 Key 的官方接口。

## 2b. 后台管理端「翻译配置」面板（v1.4.1 新增）

入口：管理后台 → **翻译配置** 标签页。能力：

- **总开关**：一键开启/关闭全站翻译（与策略 `NodeByteTranslateEnabled` 独立，双层管控）；
- **默认目标语言 / 缓存 TTL / 翻译审计**开关；
- **接口列表**：每条 = 类型下拉（18 种）+ 端点覆盖 + 凭据字段（按类型动态渲染：API Key / APPID+密钥 / Key+区域 / Key+模型）+ 权重 + 启用开关；
- **排序**：↑↓ 调整权重顺序（保存时生效）；
- **一键测试**：调用 `POST /api/admin/translate-test`，把 "Hello, world! This is a test." 翻成 zh-CN，
  返回 ✓/✗、延迟 ms、译文样例 —— 未保存的配置也能测；
- **密钥保护**：保存后回显脱敏（`••••••••`），留空保存 = 保留原密钥（服务端 merge 逻辑）；
- 全部修改写管理员审计（`modify_system_setting`）。

## 3. 请求/响应

### 3.1 GET `/api/translate`
返回支持语言列表 + 当前可用 provider 列表（脱敏：不含 apiKey）+ 默认目标语言。

```json
{
  "code": 0,
  "data": {
    "languages": [
      { "code": "auto", "name": "自动检测" },
      { "code": "zh-CN", "name": "简体中文" },
      ...
    ],
    "defaultTarget": "zh-CN",
    "providers": [
      { "provider": "libretranslate", "endpoint": "https://translate.argosopentech.com", "weight": 10 },
      ...
    ]
  }
}
```

### 3.2 POST `/api/translate`
```json
{
  "text": "Hello, world!",
  "source": "auto",
  "target": "zh-CN",
  "format": "text"
}
```
返回：
```json
{
  "code": 0,
  "data": {
    "translatedText": "你好，世界！",
    "detectedSource": "en",
    "provider": "google_free",
    "endpoint": "https://translate.googleapis.com",
    "cached": false
  }
}
```

### 3.3 管理员配置：GET/PUT `/api/admin/translate-config`
```json
{
  "enabled": true,
  "providers": [
    { "provider": "google_free", "weight": 10, "enabled": true },
    { "provider": "edge_free", "weight": 20, "enabled": true },
    { "provider": "mymemory", "weight": 30, "enabled": true },
    { "provider": "deepl", "apiKey": "xxxxxxxx-xxxx-...:fx", "weight": 40, "enabled": true },
    { "provider": "baidu", "appId": "202601xxxxxx", "apiKey": "百度密钥", "weight": 50, "enabled": true },
    { "provider": "tencent", "appId": "AKIDxxxxxx", "apiKey": "secretKey", "weight": 60, "enabled": true },
    { "provider": "openai_compat", "endpoint": "https://api.deepseek.com/v1", "apiKey": "sk-...", "model": "deepseek-chat", "weight": 70, "enabled": false }
  ],
  "cacheTtlHours": 168,
  "auditLog": false,
  "defaultTarget": "zh-CN"
}
```

- `providers` 留空数组 → 用 DEFAULT_PROVIDERS（google_free/edge_free/mymemory 启用）；
- 每条支持字段：`provider / endpoint / apiKey / appId / region / model / weight / enabled`；
- 保存后密钥回显脱敏，留空提交 = 保留原密钥（服务端 merge）；
- **连通性测试**：`POST /api/admin/translate-test`（body 单条 provider 配置）→ `{ ok, detail, sample, latencyMs }`；
- 自托管 LibreTranslate：`docker run -p 5000:5000 libretranslate/libretranslate`
- 自托管 DeepLX：`docker run -p 1188:1188 ghcr.io/owen0oii/deeplx`
- 自托管 Lingva：`docker run -p 8080:3000 thedaviddelta/lingva-translate`
- 本地 LLM（免 Key）：`docker run -p 11434:11434 ollama/ollama`，endpoint 填 `http://127.0.0.1:11434/v1`，model 填 `llama3`

## 4. 客户端能力（C++ TranslateController）

文件：`client/src-nodebyte/chrome/browser/nodebyte/translate/translate_controller.{h,cc}`

### 整页翻译
- 用户点击工具栏「翻译此页」按钮；
- `TranslateController::TranslatePage(target_lang, callback)`：
  1. 注入 JS `collectTextNodes.js` 收集可见文本节点（带 `data-nb-id` 锚定）；
  2. 合并文本按 `NodeByteTranslateMaxChars`（默认 5000）分批；
  3. 串行调用 `NodeByteProtocol::TranslateBatches()` → 服务端 `/api/translate`；
  4. 收到结果后注入 `replace.js` 原地替换文本节点（保留 DOM 与样式）；
  5. 工具栏显示「已翻译 ✓ / 还原」按钮，点击 `RestorePage()` 还原原文。

### 选区翻译
- 右键菜单「翻译选中文字」→ `TranslateSelection(text, target_lang, callback)`；
- 单次请求，结果以气泡/侧边栏展示。

### 独立翻译面板
- `nodebyte://translate` 提供独立翻译面板（源/目标语言下拉 + 文本框 + 朗读/复制/交换按钮）；
- 同样调用 `/api/translate`，适合用户主动粘贴翻译。

## 5. 策略键

| 键 | 类型 | 默认 | 行为 |
|---|---|---|---|
| `NodeByteTranslateEnabled` | bool | true | false 时所有翻译入口隐藏、API 返回 40303 |
| `NodeByteTranslateAllowAnonymous` | bool | false | false 时未登录用户 POST /api/translate 返回 401 |
| `NodeByteTranslateMaxChars` | int | 5000 | 单次翻译字符上限（防止烧公共实例配额） |

上述三个键均纳入**策略指令下发/撤销**通道（见 docs/policy-dictionary.md）：
- 撤销 `NodeByteTranslateEnabled` → 恢复默认 true（开关回到开）；
- 撤销 `NodeByteTranslateMaxChars` → 清空，回退默认 5000。

## 6. 安全与隐私

- 翻译请求体经 TLS 传输；不记录原文与译文，只记录命中次数与最后一次命中时间（审计可关，默认关）；
- 公共实例可能记录请求 IP（用于反滥用）；自托管时全部留在内网；
- 客户端不缓存译文到磁盘（仅内存 in-process cache），关闭浏览器即清空；
- 单次字符上限 `NodeByteTranslateMaxChars`（默认 5000）防止滥用公共实例。

## 7. CNB 编译可靠性（用户提醒：只有 2 次编译机会）

翻译功能**不触发 CNB Chromium 全量编译**——它只是新增源文件 + 新增 API 路由 + 新增 WebUI 资源：

| 改动 | 触发的 CI |
|---|---|
| `server/src/lib/translate.ts` + API 路由 | `Build-NodeByte-Server`（GitHub 托管 Runner）+ CNB `nodebyte-lite-validate`（轻量校验） |
| `client/src-nodebyte/.../translate/*` | `Validate-Client-Assets`（补丁干跑）+ CNB 同上 |
| `client/webui/translate/*` | 同上 |

**只有 `web_trigger: nodebyte-chromium-build` 才会消耗 CNB 免费核时**，且该触发是手动的。
默认 push 只跑轻量校验（Shell 语法 / 补丁干跑 / tsc / Next.js standalone / CSV 自测），全部确定性通过。

本次提交后建议流程：
1. `git push origin main --tags` → GitHub Actions 全绿（与之前 v1.3.x 同流水线）；
2. `bash scripts/push-cnb.sh` → CNB `nodebyte-lite-validate` 跑通；
3. **不要** 在 CNB 网页触发 `nodebyte-chromium-build`，除非确实需要 Chromium 产物 —— 这是仅剩的 2 次核时；
4. 如确需触发 Chromium 编译，先在 GitHub `build-nodebyte-browser.yml`（自托管 Runner 或 GitHub Actions 大型 runner）跑通后再上 CNB。
