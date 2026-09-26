# 翻译功能（v1.4.0）

> 用户需求：「再加一个翻译功能看看有没有什么开源免费的翻译 API」。
> 全部使用**开源 / 可自托管 / 无需付费 API Key**的翻译服务，避免依赖 Google/DeepL 商业 API。

## 1. 选型：开源翻译 API 矩阵

| 供应商 | 协议 | 开源协议 | 公共实例 | 自托管 | API Key | 备注 |
|---|---|---|---|---|---|---|
| **LibreTranslate** | REST | AGPL-3.0 | ✅ translate.argosopentech.com / libretranslate.de | ✅ Docker 一键起 | 可选 | 主用，纯开源，社区维护 |
| **Lingva Translate** | REST | GPL-3.0 | ✅ lingva.ml / lingva.lunar.icu | ✅ Docker | 不需要 | Google Translate 代理，无需 Key |
| **MyMemory** | REST | 专有（免费配额） | ✅ api.mymemory.translated.net | ❌ | 可选 | 5000 词/天免费，兜底用 |
| **DeepLX** | REST | MIT | ❌（多数公共实例已限速） | ✅ Docker | 不需要 | DeepL 免费版代理 |
| **Argos Translate** | 离线 | MIT | — | ✅ Python 包，可嵌入 Docker | — | 完全离线，后续可作离线兜底 |

### 为什么不直接用 Google Translate API / DeepL API？
- 商业 API 需要付费 Key，与「开源免费」目标不符；
- 公共实例有时会限速，但服务端聚合 + 缓存 + 自动降级足以覆盖大部分场景；
- 自托管 LibreTranslate / DeepLX 完全可控、无配额限制、零成本。

## 2. 架构

```
浏览器客户端（TranslateController）
        │
        │ POST /api/translate { text, source?, target, format? }
        ▼
服务端（Next.js API）
   ├─ 命中缓存？ → 直接返回（cached=true）
   ├─ 否则按 providers 权重依次尝试：
   │    1. LibreTranslate  → 200 OK 即返回
   │    2. Lingva          → 200 OK 即返回
   │    3. MyMemory        → 200 OK 即返回
   │    4. DeepLX          → 200 OK 即返回
   └─ 全部失败 → AggregateError（含每个 provider 的错误明细）
        │
        ▼
   写入 in-process 缓存（key=sha256(text)+lang 对，TTL=cacheTtlHours，默认 168h）
```

**为什么客户端不直接调公共实例？**
1. 不暴露服务端密钥/自托管端点给浏览器；
2. 服务端可缓存（命中即返回，不烧公共实例配额）+ 限速 + 审计；
3. 策略 `NodeByteTranslateEnabled` 由服务端统一管控，浏览器侧只需隐藏入口；
4. 浏览器同源策略下跨域请求公共实例可能被 CORS 拦截。

## 3. 接口

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
    "provider": "libretranslate",
    "endpoint": "https://translate.argosopentech.com",
    "cached": false
  }
}
```

### 3.3 管理员配置：GET/PUT `/api/admin/translate-config`
```json
{
  "enabled": true,
  "providers": [
    {
      "provider": "libretranslate",
      "endpoint": "https://lt.my-corp.internal",
      "apiKey": "optional-when-your-instance-requires-it",
      "weight": 10
    }
  ],
  "cacheTtlHours": 168,
  "auditLog": false,
  "defaultTarget": "zh-CN"
}
```

- `providers` 留空数组 → 用 DEFAULT_PROVIDERS（公共实例）；
- 自托管 LibreTranslate：`docker run -p 5000:5000 libretranslate/libretranslate`
- 自托管 DeepLX：`docker run -p 1188:1188 ghcr.io/owen0oii/deeplx`
- 自托管 Lingva：`docker run -p 8080:3000 thedaviddelta/lingva-translate`

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
