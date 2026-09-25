# 总体架构

> 本文档是 NodeByte Browser 系统的权威架构说明。需求来源：客户端源码开发提示词、服务端后台开发提示词（已内化为本仓库实现）。

## 1. 系统全景

```
┌───────────────────────────────────────────────────┐
│ NodeByte Browser 客户端（Chromium 二次编译）          │
│ 登录/2FA UI · 同步客户端 · Drop 侧边栏 ·              │
│ 多 Cookie 会话集 · 指纹 · 代理/VLESS ·               │
│ 策略解析执行 · 网站黑白名单 · 协作会议客户端 ·          │
│ 扩展管理 · 办公套件 · 打印增强 · 离线游戏 · 多语言      │
└──────────────┬────────────────────┬───────────────┘
               │ HTTPS REST/JWT     │ WebSocket/WebRTC
               ▼                    ▼
┌─────────────────────────┐  ┌──────────────────────┐
│ NodeByte Server (Next.js)│  │ WebSocket 信令 + SFU  │
│ 前台登录 · 个人中心 · 后台 │  │ （独立服务，ws-service）│
└───────┬─────────┬───────┘  └──────────────────────┘
        ▼         ▼
   PostgreSQL    MinIO（文件/截图/密文包/crx/文档快照/录制/头像）
```

客户端全部后端交互：
- **HTTPS REST**：账号、策略、同步、Drop、协作会话管理
- **WebSocket**：设备在线、状态上报、指令下发、实时消息、协作信令
- **WebRTC**：协作会议媒体流（P2P 不通走 SFU 中转）

## 2. 客户端分层（低侵入架构 · 铁律）

1. **内核层（C++）**：网络栈、Cookie 隔离、指纹注入、策略执行、沙箱/JS/WS 管控、WebRTC 采集与输入注入、Mojo 服务端。
2. **桥接层（Mojo IPC）**：把内核能力暴露给 WebUI；业务 C++ 全部放 `//chrome/browser/nodebyte/`。
3. **WebUI 层（HTML/JS/WASM）**：登录界面、设置页、Drop 侧边栏、个人资料面板、办公编辑器、打印面板、离线游戏，全部用 `nodebyte://` 内部页面实现。
4. **本地存储层**：Profile 数据、加密 SQLite（Cookie 会话集）、本地偏好、同步缓存。

低侵入三原则：
- **独立目录**：自研 C++ 全部在 `//chrome/browser/nodebyte/`，尽量以子类/委托模式复用原生能力，内核升级时整体迁移。
- **薄 Mojo**：C++ 只暴露原子能力（读 Cookie 集、注入请求头、截图、启动 Xray 等），业务逻辑全部 JS/WASM。
- **资源隔离**：离线游戏、办公套件静态资源放独立 grd，内核升级几乎不冲突。

## 3. 客户端启动主链路

1. 启动 → 读取本地偏好（同步服务器地址、语言、UserData 路径）→ 加载 Profile。
2. 若已登录：携带 `device_id + jwt` 建立 WebSocket 长连接；请求 `GET /api/client/policy` 拉取策略注入原生 `PolicyService`。
3. 策略生效：mandatory 项设置页置灰（Chromium 内置行为）；敏感字段 UI 隐藏明文；沙箱/JS/WS/黑白名单内核策略生效。
4. 定时/变更上报设备状态（当前 Tab、代理、指纹模板）；接收后端指令与 Drop 推送。
5. 同步客户端按同步项开关增量上传/下载（本地 AES-GCM 加密后传输，密钥永不上传）。

## 4. 服务端关键链路

### 4.1 策略下发（核心主链路）

```
浏览器登录(JWT) → GET /api/client/policy?deviceId=xxx
后端合并：用户 override_policy_json（不为 null 完全覆盖）
        > 用户组 policy_set_id 策略集
        > 全局默认策略（system_setting.global_policy）
返回：{ policyVersion, mandatory, recommended, sensitiveFields, quota, forceInstallExtensions }
浏览器：mandatory 注入 PolicyService（设置页自动置灰）
       sensitiveFields 列表 → WebUI 隐藏明文（UI 层，明示 chrome://policy 仍可读）
```

### 4.2 鉴权链（服务端唯一权威，后端不信任前端）

```
所有业务接口：JWT 有效 → 账号 active 且未过期 → 2FA 绑定态满足
           → 功能黑白名单（用户组 feature_policy）→ 配额 → 执行业务
状态码：401 未登录 | 40301 需绑定2FA | 40302 禁用/封禁/过期
      | 40303 无权限 | 41301 配额超限 | 429 限流
```

### 4.3 数据加密边界

- 密码：bcrypt 哈希入库；TOTP 密钥加密存储（`totp_secret_encrypted`）。
- 同步数据（密码/Cookie/crx/历史等）：**客户端 AES-GCM 加密后上传**，服务端只存 MinIO 密文对象 + 元数据，永不解密；管理员二次鉴权下载也无法查看内容（`is_encrypted_client_side=true` 明示）。
- 明文 Cookie 绝不入库：会话上下文分享仅传密文包，库中只存 `minio_object_key`。

## 5. 服务拆分

| 组件 | 技术 | 职责 |
|---|---|---|
| 主服务 | Next.js standalone | REST API + 前台登录 + 个人中心 + 管理后台 |
| 信令服务 | ws-service（Node ws，可平滑替换 Go） | 设备在线、状态上报、指令/Drop 推送、协作信令 |
| SFU | 独立部署（v1.1+） | 多人会议媒体流转发，按 `collab_participant` 库状态放行/切断轨道 |
| 数据库 | PostgreSQL | 全部业务数据（DDL 见 server/sql/init.sql） |
| 对象存储 | MinIO | 桶：drop-files / screenshots / sync-blobs / extension-pool / doc-snapshots / recordings / avatars |

生产环境大量长连接建议将 ws-service 平滑替换为 Go 实现（协议契约见 docs/api-contract.md，不变）。

## 6. 平台差异总表（客户端实现必须先查此表）

| 功能 | Windows | Android |
|---|---|---|
| DOCX/PPTX/MD 编辑、PPT 放映 | ✅ 完整编辑、放映、协作编辑 | ❌ 仅预览 |
| 增强打印 | ✅ 自研打印弹窗 | ✅ 前置面板→WASM-PDF→系统打印 |
| 录屏/截图 | ✅ 完整（桌面截图走辅助 exe） | ❌ 仅网页截图 |
| 外部浏览器导入 | ✅ Chrome/Edge/Firefox | ❌ 沙盒限制 |
| Drop 侧边栏 UI | 常驻侧边栏 | 底部呼出菜单 |
| 系统级悬浮管控面板 | ✅ 原生 HWND | ❌ 放 Drop 侧边栏 |
| 控制系统外软件 | ✅ 辅助 exe + 发起方授权 | ❌ 无此能力 |

## 7. 风险与明示限制（必须向用户告知）

- 敏感策略隐藏仅 UI 层：`chrome://policy` 与开发者工具仍能读内存值。
- 指纹仅混淆：TCP 层 IP 靠代理解决，部分硬件 ID 来自操作系统，不保证 100% 绕过风控。
- 沙箱关闭高危：仅进程启动时生效，后台二次确认 + 审计 + 提示重启。
- 会话撤销只能回收本次分发记录，接收方已复制/转发的副本无法回收（配合 `allow_forward_shared_session=false` 从源头防扩散）。
