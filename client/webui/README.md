# client/webui — nodebyte:// 内置页面源码

业务 UI 全部在 WebUI 层（低侵入铁律：业务逻辑 JS/WASM，C++ 只做薄 Mojo 桥接）。构建时打进**独立 grd**（资源隔离，内核升级几乎不冲突）。

| 页面 | 主机名 | 内容 | 需求 |
|---|---|---|---|
| `login/` | `nodebyte://login` | 登录表单（JWT/TOTP）、业务状态码处理（401/40301/40302/429）、中英 i18n | 5.1 |
| `drop/` | `nodebyte://drop` | Drop 侧边栏：消息/文件/截图/标签页推送/Cookie 会话集切换/协作入口，策略置灰 | 5.4 / 5.5 |
| `settings/` | `nodebyte://settings` | 同步服务器地址锁定、代理段敏感字段 UI 隐藏、开发模式与自定义 UA | 5.3 / 5.14 |
| `offline-game/` | `nodebyte://game`（离线错误页） | 自研小游戏 NodeByte Runner：横版躲避+道具+护盾+本地最高分，替代 dino | 5.12 |

## 与 C++ 的连接

- 页面 JS 通过 `Mojo.bindInterface('nodebyte.mojom.NodeByteXxx')` 调用原生能力（接口定义 `../src-nodebyte/chrome/browser/nodebyte/mojo/nodebyte.mojom`）。
- 服务端推送到达：C++ `OnServerPush` → `window.__nodebyteDropPush(payload)`。
- 资源注册：`ui/webui/nodebyte/` 的 WebUIDataSource（`IDR_NODEBYTE_*`）。

## 能力边界（UI 明示项）

- 敏感字段仅 UI 层隐藏：`chrome://policy` 与开发者工具仍可读（提示词 5.3.3）。
- 指纹仅混淆：IP 靠代理、硬件 ID 不可改、不保证绕过风控（5.6.5）。
- Android 差异：无桌面截图、无系统悬浮窗、Drop 入口在底部菜单（第九章平台差异表）。
