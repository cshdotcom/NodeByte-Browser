# 协作会议与远程指令（v1.4.5）

> 客户端提示词 5.4.5 / 5.9 + 附录 E.1-E.2 端到端落地。架构铁律：**业务逻辑在 JS/WASM 侧，
> C++ 只暴露原子能力**（低侵入 第十一章）；媒体权限**服务端为唯一权威**（附录 E.6）。

## 一、能力总览

| 能力 | 桌面（Windows/Linux/macOS） | 安卓 | 落点 |
|---|---|---|---|
| 协作会话（创建/邀请码/有效期链接） | ✅ | ✅ | REST `/api/collab/sessions` + Drop 侧边栏 |
| 邮箱批量邀请（精确邮箱，无用户搜索） | ✅ | ✅ | `POST .../[id]/participants` |
| 媒体申请/审批（开麦/开摄像头） | ✅ | ✅ | WS `request_*_publish` → owner 审批 → `media_permission` |
| WebRTC 媒体流（P2P） | ✅ | ✅ | SDP/ICE 经 WS `rtc_relay` 会内中继 |
| 发起方管控（静音/关摄像头/踢出/授予控制权/全体操作/结束） | ✅ | ✅ | `PATCH .../[id]` 白名单 9 动作 |
| 管控面板 | Drop 侧边栏协作 tab | Drop 侧边栏 | `NodeByteCollab.ShowControlPanel` |
| 输入注入（WebMouseEvent/WebKeyboardEvent） | 信令 ✅ / 注入 ⏳ 二期 | ❌ | WS `input_event`（仅 controller 角色，服务端校验） |
| 远程指令（附录 E.1，8 种白名单） | ✅ | ✅ | admin 后台 → ws-service → 客户端 Mojo 执行 |
| 设备状态上报（device_status） | ✅ | ✅ | 60s 定时 + WS 上报，admin 设备面板可视 |
| Windows 原生 HWND 悬浮面板 | ⏳ 二期 | ❌（无系统悬浮窗） | 提示词 5.9.5 桌面差异项 |
| Windows 辅助 exe（系统外软件控制/桌面截图） | ⏳ 二期 | ❌ | 提示词 5.9.6 |
| Go SFU 媒体中转（P2P 不通时） | ⏳ 二期 | ⏳ | 提示词 5.9.9 自标第一版不做 |

## 二、协作会议数据流

```
发起方                         服务端（唯一权威）                    协作者
  │ POST /api/collab/sessions     │                                  │
  ├──────────────────────────────▶│ 落库 collab_session + share_token │
  │◀──────────────────────────────┤ 返回 shareToken/短链接            │
  │ POST .../participants          │                                  │
  ├─ 邮箱批量邀请 ────────────────▶│ allowed_user_ids + 审计           │
  │                               ├─ push_message collab_invite ────▶│ 邀请弹窗
  │                               │                                  │ POST join
  │◀─ collab participant_joined ──┤◀──────── collab_join (WS) ───────┤
  │◀─ participant_update 广播 ────┤   （最新参与者列表）              │
  │                               │                                  │
  │                               │◀── request_audio_publish (WS) ───┤ 申请开麦
  │ media_request 弹窗            │                                  │
  ├─ approve_audio (Mojo→REST) ──▶│ 改库 allow_send_audio=true        │
  │                               ├── media_permission (WS) ────────▶│ 收到放行才上轨道
  │◀────────── WebRTC P2P（SDP/ICE 经 rtc_relay 中继）───────────────▶│
  │                               │                                  │
  ├─ moderate(kick/mute/…) ──────▶│ 改库 + 广播 participant_update    │ SFU 按库切断轨道
  ├─ moderate(end) ──────────────▶│ is_active=false + collab_ended ─▶│ 全员退出
```

**安全要点（附录 E.2/E.6）**：
1. 协作者即使本地硬件已打开，未收到 `media_permission` 放行**不向 PeerConnection 添加轨道**；
2. 服务端改库为唯一权威，篡改本地代码拿不到推流权限（SFU 按库状态切断，二期）；
3. `input_event` 仅 controller 角色可发（ws-service 查库校验）；
4. `rtc_relay` 双向校验发送者与目标都在会内且未被踢出。

## 三、远程指令（附录 E.1）

管理后台 →「设备与远程指令」→ 选设备 → 选命令 + payload JSON → 下发：

| 命令 | payload | 客户端行为 |
|---|---|---|
| `open_url` | `{"url":"https://…"}` | 新前台标签页打开（客户端二次校验 http/https） |
| `close_tab` | — | 关闭当前活动标签页 |
| `clear_cache` | — | 调度浏览数据清除（缓存） |
| `logout` | — | 清除本机 JWT/设备凭据（同步/Drop/协作随锁定） |
| `lock_browser` | — | 最小化浏览器窗口（系统级锁屏依赖辅助 exe，二期） |
| `switch_fingerprint` | `{"templateId":"…"}` | 切换指纹模板（存储侧） |
| `switch_proxy` | `{"mode":"fixed_servers","server":"…"}` | 写代理 prefs（direct/fixed_servers/system） |
| `enable_snapshot` | `{"url":"…"}`（可选） | 网页快照预览：抓当前页截图回传 Drop |

链路：`admin REST（白名单+payload 校验+审计 device_remote_command）→ emitToWs →
ws-service internal/emit → S→C command → 客户端 WS（WebUI JS）→ Mojo
ExecuteRemoteCommand → CollabController::RunCommand（白名单 8 种，白名单外拒绝）`。

注意：指令**不重放**（离线设备收不到）；持续语义（锁定某配置）请用「策略指令」通道，
两者职责不同。设备状态（activeTab/openTabs/proxy/fingerprintTemplateId）由客户端
每 60s 经 WS `device_status` 上报，admin 设备面板展示在线状态与快照。

## 四、客户端架构（v1.4.5）

- **Mojo（一次性批量扩展，附录 F.1）**：`NodeByteCollab` 增 `GetSessions / GetParticipants /
  EndSession / GetWsAuth / ExecuteRemoteCommand / GetDeviceStatus`，`Moderate` 增审批动作
  `approve_audio / deny_audio / approve_video / deny_video`（映射 participants PATCH）。
- **C++（chrome/browser/nodebyte/collab/collab_controller.{h,cc}，补丁组 0250）**：
  REST 会话管理代理 + WS 建连材料（`ws_url` 经 `ApiBase()` 动态推导，可塑性铁律）+
  远程指令白名单执行 + 设备状态采集（BrowserList 活动窗口/标签页）。
- **WebUI（client/webui/drop/app.js）**：WS 连接生命周期（hello 鉴权 / 60s 状态上报 /
  指数退避重连 1s→30s）、协作 UI（会话双列表/参与者/审批弹层/管控按钮）、
  WebRTC P2P（`RTCPeerConnection`，SDP/ICE 走 `rtc_relay`）、远程指令接收与执行调用。
- **平台一致性**：管控面板在 Drop 侧边栏协作 tab 渲染 —— Windows/安卓同一实现；
  原生 HWND 悬浮窗、辅助 exe、输入注入 C++ 端为二期（代码内 `【需核实】` 标注注入点，
  不虚标）。

## 五、服务端

- `/api/admin/devices`：设备列表（在线判定 90s + `last_status` 快照）；
- `/api/admin/devices/command`：远程指令下发（白名单 + payload 校验 + 审计）；
- ws-service：`rtc_relay`（会内中继）/ `collab_join`（owner 通知 + 参与者广播）/
  `collab_leave` / `input_event` 角色校验（controller only）；
- 策略键：`AllowDropCollaboration`（多人协作总开关，默认 true，可指令下发/撤销）+
  功能键 `allow_collab_invite`（组黑白名单，发起邀请前 requireFeature 校验）。

## 六、自测与 CI

`server/scripts/collab-selftest.mjs`（零依赖，124 项）：命令白名单双侧对齐 / payload
校验 / 信令 15 消息覆盖 / rtc_relay 会内校验 / REST 路由与 9 管控动作 / mojom 13 方法 /
drop WebUI 14 函数接线 / admin 面板 / 策略键。已接入 CNB lite-validate 与 GitHub server-ci。

## 七、CNB 编译保护

本轮新增 C++（collab_controller + mojom 扩展 + 常量）**已计入 0250 补丁组并干跑验证**；
Chromium 全量编译经 `api_trigger`（`POST /{repo}/-/build/start`，event=api_trigger）或
CNB 网页 web_trigger 手动触发，push 默认仍只跑 lite-validate，不烧核时。
