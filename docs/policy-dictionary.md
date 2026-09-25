# 策略字典（Custom* 与原生键 · 客户端执行点对照）

> 策略 JSON 由服务端生成下发（附录A 结构），客户端职责是解析并执行。
> mandatory → 设置页原生置灰；recommended → 默认值用户可改；sensitiveFields → WebUI 隐藏明文（UI 层，明示 chrome://policy 仍可读）。

## 账号安全

| 键 | 类型 | 执行点 |
|---|---|---|
| `CustomRequire2FA` | bool | 后端强校验（40301）；客户端 UI 锁定同步/DROP/协作入口 |
| `CustomLockSyncServer` | bool | 设置页同步服务器输入框置灰（nodebyte://settings） |
| `CustomAllowMultiProfile` | bool | 新建用户按钮隐藏/置灰 |
| `CustomAllowGuestMode` | bool | 访客入口隐藏/置灰 |
| `CustomAllowIncognito` | bool | 无痕菜单隐藏/置灰 |

## 同步控制

| 键 | 类型 | 执行点 |
|---|---|---|
| `CustomAllowSync` | bool | 同步入口置灰 + 后端接口 40303（双保险） |
| `CustomAllowExportBackup` | bool | 导出 `.custom-browser-backup` 按钮隐藏/置灰 |
| `CustomSyncDisabledTypes` | string[] | passwords/cookies/extensions/history/local_storage/device_fingerprint… 按类型禁止（前后端同步校验） |

## 沙箱与网页能力

| 键 | 类型 | 执行点 | 风险 |
|---|---|---|---|
| `CustomDisableRendererSandbox` | bool | `browser_process_impl.cc` 启动参数（hook 0210）；仅启动时生效，改后提示重启 | 🔴 高危：后台二次确认+审计 |
| `CustomAllowJavaScript` | bool | `blink settings.cc` javascript_enabled（hook 0220） | 🟡 |
| `CustomAllowWebSockets` | bool | `websocket_manager.cc` 建连前拦截 | 🟡 |
| `CustomWebsocketAllowList` / `CustomWebsocketBlockedHosts` | string[] | WS 白/黑名单 | 🟡 |
| `CustomAllowWsUnderHttps` | bool | `mixed_content_checker.cc` + `websocket_manager.cc` **双层**防绕过 | 🔴 强烈不建议无白名单全局放开 |
| `CustomWebSocketAllowedHosts` / `CustomWebSocketBlockedHosts` | string[] | 同上 | 🟡 |

## 同源 / CORS / Cookie

| 键 | 类型 | 执行点 |
|---|---|---|
| `CustomDisableSameOriginPolicy` | bool | `cors.cc` / `local_dom_window.cc`（严禁全局关闭，白名单命中才放行） |
| `CustomCrossOriginAllowList` | string[] | 同上 |
| `CustomAllowReadForeignCookieOrigins` | string[] | `cookie_access_delegate.cc`；HttpOnly 依旧只能 C++ 层访问 |

## 代理 / VLESS

| 键 | 类型 | 执行点 |
|---|---|---|
| `ProxyMode` / `ProxyServer` / `ProxyBypassList` | 原生键 | `net/proxy_resolution`（mandatory 强制置灰 / recommended 可改） |
| `CustomProxyVlessConfig` | object | PC 方案 B：解析配置拉起本地 Xray → socks5（sensitiveFields 典型项） |

## 网站黑白名单

| 键 | 类型 | 执行点 |
|---|---|---|
| `SiteBlocklist` / `SiteAllowlist` | string[] | 内核网络层拦截 + 拦截页 |
| `SiteListMode` | enum | blacklist / whitelist |

## 配额 / 搜索引擎 / 扩展 / 伪装

| 键 | 类型 | 执行点 |
|---|---|---|
| `CustomLocalStorageQuotaMB` | int | blink storage 配额覆盖 |
| `CustomCloudDropQuotaMB` | int | 云端配额（与组配额体系联动） |
| `DefaultSearchProviderEnabled` / `DefaultSearchProviderSearchURL` | 原生键 | 必应默认，策略可覆盖并锁定 |
| `ForceInstallExtensionPackages` / `ForceInstallExtensionIds` | 原生键 | 静默安装；用户端启用/停用/删除/改权限全部置灰 |
| `AllowUserSelfInstallExtension` / `AllowUserUninstallForcedExt` | bool | 用户自装 / 强制扩展可否卸载（管理员移除策略后自动卸载） |
| `CustomSpoofBrowserVendor` / `CustomSpoofUserAgent` | string | 扩展商店访问 UA 伪装（Edge 商店伪装 Edge、Chrome 商店伪装 Chrome） |

## Drop / 协作

| 键 | 类型 | 执行点 |
|---|---|---|
| `AllowDropCollaboration` | bool | 多人协作文档整体关闭，仅保留多设备互通 |

## 用户组功能黑白名单（feature_policy 键，组配置合并进 Policy JSON）

| 键 | 默认 | 客户端行为 |
|---|---|---|
| `allow_drop_file_screenshot` | true | Drop 发文件/截图按钮置灰 |
| `allow_sync` | true | 全量同步入口 |
| `allow_export_backup` | true | 导出备份 |
| `allow_collab_invite` | true | 发起协作邀请 |
| `allow_joplin_integration` | true | Joplin 对接入口 |
| `allow_vless_proxy` | true | VLESS 功能 |
| `allow_disable_sandbox` | true | 关沙箱（高危，需二次确认+审计） |
| `allow_share_session_context` | true | 发起会话分享 |
| `allow_forward_shared_session` | **false** | 转发外部会话（默认关闭防扩散） |

## 策略变更处理

- WebSocket `policy_update` 通知或定时（15 分钟）重新拉取；
- 沙箱类策略提示重启；其余即时生效；
- `chrome://policy` 与开发者工具仍能读取内存值（UI 层隐藏的边界，向用户明示）。
