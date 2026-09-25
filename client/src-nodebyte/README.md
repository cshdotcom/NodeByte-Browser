# client/src-nodebyte — NodeByte 自研业务源码树（低侵入）

本目录是 NodeByte Browser 在 Chromium 之上的**全部自研业务源码**，遵循「低侵入 Chromium 架构」（客户端提示词 第十一章）：

- **独立目录**：全部新文件，位于 `//chrome/browser/nodebyte/` 与 `//chrome/browser/ui/webui/nodebyte/`，不改 Chromium 原有文件 → 升级基线时整体迁移。
- **薄 Mojo**：C++ 只暴露原子能力，业务逻辑全部 JS/WASM（`client/webui/`）。
- **资源隔离**：WebUI 页面与离线游戏静态资源放独立 grd。

## 目录

| 路径 | 内容 | 对应需求 |
|---|---|---|
| `nodebyte_constants.h` | 产品名 / nodebyte:// 协议 / 默认同步服务器 常量 | 4.1–4.4 |
| `nodebyte_protocol.*` | nodebyte:// scheme 注册与 URL 工具 | 4.2 |
| `mojo/nodebyte.mojom` | Account / Sync / Drop / Policy / Collab 五大接口 | 附录F.1 |
| `policy_extend/` | CloudOrgPolicyProvider + 全量策略键定义 | 5.3 / 附录A |
| `sync/` | 自定义同步客户端（AES-GCM 加密、增量、快照导出） | 5.2 / F.2 |
| `cookie_sessions/` | 多 Cookie 会话集（加密 SQLite、隔离分区、HttpOnly 内核读写） | 5.5 / F.3 |
| `drop/` | Drop 侧边栏容器协调器（WebContents + Mojo） | 5.4 / F.4 |
| `fingerprint/` | 指纹模板（HTTP 头 / Navigator / WebGL / AudioContext） | 5.6 / F.5 |
| `ui/webui/nodebyte/` | login / drop WebUIController | 5.1 / 5.4 |

## 修改 Chromium 核心文件的少量 hook

以下 hook 不在本目录（独立小补丁，标注基线，见 `patches/README.md`）：

1. `components/policy/core/common/policy_registry.cc`：注册 Custom* 策略键（0200）
2. `chrome/browser/browser_process_impl.cc`：沙箱策略启动参数（0210，高危需二次确认）
3. `third_party/blink/.../settings.cc`、`websocket_manager.cc`、`mixed_content_checker.cc`：JS/WS 管控（0220）
4. `net/error_page` 资源替换：离线小游戏（0230）

## 与 webui 的关系

`client/webui/` 是 `nodebyte://` 页面的前端源码（构建时打进独立 grd）：
本目录的 WebUIController 注册数据源并暴露 Mojo，页面 JS 通过
`Mojo.bindInterface('nodebyte.mojom.NodeByteXxx')` 调用原生能力。

## 难度评级（提示词 2.4 口径）

| 模块 | 难度 | 版本建议 |
|---|---|---|
| 登录/同步基础 | 🟢 | v0.1 |
| CloudPolicyProvider | 🟡 | v0.2 |
| Drop 侧边栏 | 🟡 | v0.5 |
| 多 Cookie 会话集 | 🔴 | v0.6（PC 先行） |
| 指纹模块 | 🔴 | v0.7 |
| VLESS / 沙箱管控 | 🔴 | v0.8–0.9 |
| 协作会议 | 🔴 | v1.0+ |
