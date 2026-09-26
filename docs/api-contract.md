# 接口契约与 WebSocket 信令协议

> 客户端与服务端的对接契约。字段与语义与两份提示词第七/八章保持一致；变更需同步两侧行为。

## 1. 统一约定

- JSON 信封：`{ "code": 0, "message": "ok", "data": {...} }`
- 分页：`page` / `pageSize`，响应含 `total`
- 鉴权：`Authorization: Bearer <jwt>`（浏览器客户端）；Web 前台 httpOnly cookie `nb_token`
- 鉴权链（附录D.1）：JWT 有效 → 账号 active 且未过期 → 2FA 绑定态 → 功能黑白名单 → 配额 → 业务

业务状态码（客户端识别执行动作）：

| 状态码 | 含义 | 浏览器动作 |
|---|---|---|
| 401 | 未登录/令牌过期 | 弹窗跳转网页个人中心登录 |
| 40301 | 需绑定 2FA | 强制跳转 2FA 绑定页 |
| 40302 | 禁用/封禁/过期 | 提示并退出登录 |
| 40303 | 无功能权限 | 功能入口置灰/隐藏 |
| 41301 | 配额超限 | 提示「存储空间已满」 |
| 429 | 限流 | 提示稍后重试 |

## 2. 核心接口（本仓库已实现）

### 2.1 认证
| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/login` | `{identifier, password, totpCode?, deviceId?, deviceName?}` → jwt + require2faBind(40301 语义) |
| POST | `/api/auth/logout` | 清除会话 |
| POST | `/api/auth/register/send-code` | 邮箱验证码（`enable_public_register` 开关；60s/次限流） |
| POST | `/api/auth/register` | 验证码 + 密码创建（默认组/永久/继承配额策略） |
| POST | `/api/auth/forgot-password` | 方式 A（账号+TOTP）；方式 B（邮箱链接→48h 冷静期→二次确认→重置并清空 2FA） |
| POST | `/api/auth/reset-password` | 凭 resetToken（30 分钟）重置 |
| POST | `/api/auth/change-password` | 校验旧密码 |
| POST | `/api/auth/2fa/setup|enable|disable` | TOTP 绑定（QR+16 位密钥）/启用/解绑（密码+验证码） |
| GET | `/api/auth/me` | 当前账号 + 配额概览 |

### 2.2 浏览器客户端
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/client/policy?deviceId=` | 合并策略（override>组>全局）+ quota + forceInstallExtensions + policyVersion + **directives[]（生效指令）+ revoked[]（近 30 天撤销）** |
| POST | `/api/client/device/status` | activeTab/openTabs/proxy/fingerprintTemplateId 落库 |
| GET | `/api/client/quota` | 云配额（total/used/free/percent） |

### 2.3 同步
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/sync/{type}?since=` | 列出密文快照（预签名下载 URL）；type ∈ bookmarks/history/settings/cookie_sets/fingerprints/proxy/extensions/passwords/preferences |
| POST | `/api/sync/{type}` | `{lastVersion, blob(客户端 AES-GCM 密文), meta?, snapshotType?}`；策略校验（CustomAllowSync/CustomSyncDisabledTypes → 40303）、配额 41301 |
| GET | `/api/sync/imported?limit=` | **待下发导入区**（管理端/自助导入的数据；密码服务端解密后经 TLS 交付本人） |
| POST | `/api/sync/imported` | `{action:'ack', batchIds:[...]}` 客户端确认合并后删除服务端副本（零明文驻留收敛） |

### 2.4 Drop
| 方法 | 路径 | 说明 |
|---|---|---|
| GET/POST | `/api/drop/messages` | 消息列表 / 文本（邮箱批量，不存在明确报错） |
| GET/POST/DELETE | `/api/drop/files` | 列表 / 预签名直传（confirm 确认）/ 删除扣减用量 |
| GET | `/api/drop/files/{id}` | 预签名下载（密文明示无法解密） |
| POST | `/api/drop/tab-push` | 标签页推送（设备/邮箱批量） |
| GET/POST | `/api/drop/sessions` | 收到的会话 / 分享（发送前强制校验密码，后端强校验+审计） |
| POST | `/api/drop/sessions/{id}/revoke` | 撤销（回收本次分发记录，副本不可回收并明示） |

### 2.5 协作
| 方法 | 路径 | 说明 |
|---|---|---|
| GET/POST | `/api/collab/sessions` | 列表 / 创建（有效期 token 1h/24h/永久） |
| GET/PATCH/DELETE | `/api/collab/sessions/{id}` | 详情 / 管控（mute/camera/revoke/grant/kick/mute_all/camera_all/end）/ 销毁 |
| POST/PATCH | `/api/collab/sessions/{id}/participants` | 邮箱批量邀请 / 媒体申请与审批（服务端唯一权威） |
| POST | `/api/collab/join` | token + 登录 + 白名单（不允许游客） |

### 2.6 管理后台（节选）
`/api/admin/users`（CRUD+actions: ban/reset_password/reset_2fa/revoke_devices/set_quota/set_policy）、
`/api/admin/groups`（CRUD+set_features）、`/api/admin/policy-sets`（CRUD）、
`/api/admin/directives`（**策略指令 create/revoke/list，撤销语义见 policy-dictionary.md 五**）、
`/api/admin/import`（**CSV 解析预览**）+ `/api/admin/import/apply`（**批量选用户导入**，targets: userIds/groupIds/allUsers，mode: merge/replace）、
`/api/personal/import`（**自助导入到自己账号** + GET 待下发概览）、
`/api/admin/files`（verify 二次鉴权 → 列表/下载/删除）、`/api/admin/extensions`（包/ID 下发/日志）、
`/api/admin/audit`、`/api/admin/settings`、`/api/admin/stats`、`/api/admin/bootstrap`、
`/api/admin/translate-config`（**GET/PUT 翻译配置：开关/自托管实例/缓存 TTL/审计/默认目标语言**）。

### 2.7 翻译（15 种常用 API 全矩阵）
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/translate` | 语言列表 + 当前 providers（脱敏）+ 默认目标语言 |
| POST | `/api/translate` | `{ text, source?, target, format? }` → `{ translatedText, detectedSource?, provider, endpoint, cached }`；登录用户可用，单次 ≤ `NodeByteTranslateMaxChars` |
| GET/PUT | `/api/admin/translate-config` | 后台翻译配置（15 种 provider + 凭据 + 权重 + 启用；密钥回显脱敏、留空保存保留原密钥） |
| POST | `/api/admin/translate-test` | 管理员一键测试单条接口配置 → `{ ok, detail, sample?, latencyMs? }` |

**架构**：浏览器只访问本后端 `/api/translate` → 后端按「后台翻译配置」顺序连接上游 → 密钥仅存服务端。
**默认梯队（免 Key，实测可用性排序）**：`google_free`（Google 免费端点，✅ 实测）→ `edge_free`（Edge 匿名 JWT）→ `mymemory`（✅ 实测）；
**可添加**：`libretranslate` / `lingva` / `deeplx`（自托管）、`deepl` / `microsoft` / `baidu` / `youdao` / `tencent`（TC3 签名）/
`aliyun`（SHA1 RPC 签名）/ `niutrans` / `yandex` / `openai_compat`（LLM：DeepSeek/Ollama 等，共 15 种）。
一条失败自动降级下一条；缓存命中直接返回。详见 docs/translate.md。

### 2.8 上游服务（v1.4.2：先连后端 → 后台配置 → 上游）
| 方法 | 路径 | 说明 |
|---|---|---|
| GET/POST | `/api/tts` | TTS 朗读：GET 音色/元信息；POST `{ text, voice?, speed?, format? }` → 音频流（edge_tts_server/azure_speech/openai_speech 三上游自动降级） |
| GET/PUT | `/api/admin/tts-config` + POST `/api/admin/tts-test` | TTS 上游配置与一键测试（密钥脱敏/merge） |
| GET | `/api/client/update?platform&arch&version` | 浏览器更新检查：后台手工清单或上游 manifest 转发，语义化版本比较 |
| GET | `/api/client/ext-download?store&extId` | 扩展商店代理下载：镜像模板 `{extId}` 或官方直连 |

**可塑性**：以上全部接口（连同策略/同步/Drop/翻译/WS）地址均由「当前同步服务器地址」动态推导，
策略指令 > 用户设置 > 编译默认；切换后无需重启自动重连（docs/upstream-services.md 一）。

## 3. WebSocket 信令协议（附录D）

统一信封 `{ "type": "...", "seq": 1, "data": {...} }`；建连先发 `hello { deviceId, jwt }`。
服务：`ws-service`（8081，wss 由反代暴露）；`/internal/emit`（8181）供 Next.js 推事件。

| 方向 | type | data 要点 | 行为 |
|---|---|---|---|
| C→S | hello | deviceId, jwt | 鉴权 + 设备吊销检查 |
| C→S | device_status | activeTab, openTabs, proxy, fingerprintTemplateId | 落库最新状态 |
| S→C | command | cmd: open_url/close_tab/clear_cache/logout/lock_browser/switch_fingerprint/switch_proxy/enable_snapshot | 仅本设备 |
| S→C | push_message | pushType: tab_page/session_context/collab_invite/notice/text | Drop 展示，可点击 |
| S→C | session_revoked | sharedSessionId | 会话置灰、移入归档 |
| S→C | policy_update | policyVersion | 重新拉取策略 |
| C→S | collab_create / collab_join | expireHours, allowMulti / sessionId, token | 权威落库走 REST |
| C→S | request_audio_publish / request_video_publish | participantId | 转发 owner 审批 |
| S→C | media_permission | participantId, allowAudio/allowVideo | 放行才建轨道 |
| S→C | participant_update / control_grant / collab_ended | — | 广播状态 |
| C→S | input_event | mouse/key | 仅转发 owner（注入 WebMouseEvent/WebKeyboardEvent） |

**权威边界**：媒体权限以数据库 `allow_send_audio/allow_send_video` 为唯一权威；即使协作者篡改本地，服务端不放行就拿不到推流权限。
