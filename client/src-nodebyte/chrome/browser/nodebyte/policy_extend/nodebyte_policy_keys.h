// Copyright 2026 The NodeByte Browser Authors. BSD-3-Clause.
//
// 自定义策略键全量定义（客户端提示词 附录A：客户端职责是解析并执行）。
// 注册位置见 hook 补丁 0200（components/policy/core/common/policy_registry.cc，需核实）。
//
// 执行点对照（提示词 附录A.3）：
//   CustomDisableRendererSandbox     → browser_process_impl.cc 启动参数（hook 0210）
//   CustomAllowJavaScript            → blink settings.cc（hook 0220）
//   CustomAllowWebSockets / 列表     → websocket_manager.cc（hook 0220）
//   CustomAllowWsUnderHttps / 列表   → mixed_content_checker.cc + websocket_manager.cc 双层
//   CustomDisableSameOriginPolicy 等 → cors.cc / local_dom_window.cc（hook 0220）
//   CustomAllowReadForeignCookieOrigins → cookie_access_delegate.cc（0130 会话集一并处理）
//   ProxyMode/ProxyServer/...        → net/proxy_resolution（原生企业策略键，直接复用）
//   SiteBlocklist/SiteAllowlist      → 原生 URLBlocklist 政策 + 网络层拦截
//   其余 Custom*                     → CloudOrgPolicyProvider 注入后由各业务模块读取

#ifndef CHROME_BROWSER_NODEBYTE_POLICY_EXTEND_NODEBYTE_POLICY_KEYS_H_
#define CHROME_BROWSER_NODEBYTE_POLICY_EXTEND_NODEBYTE_POLICY_KEYS_H_

#include <string_view>

namespace nodebyte::policy_keys {

// 账号安全
inline constexpr std::string_view kRequire2fa = "CustomRequire2FA";
inline constexpr std::string_view kLockSyncServer = "CustomLockSyncServer";
inline constexpr std::string_view kAllowMultiProfile = "CustomAllowMultiProfile";
inline constexpr std::string_view kAllowGuestMode = "CustomAllowGuestMode";
inline constexpr std::string_view kAllowIncognito = "CustomAllowIncognito";

// 同步控制
inline constexpr std::string_view kAllowSync = "CustomAllowSync";
inline constexpr std::string_view kAllowExportBackup = "CustomAllowExportBackup";
inline constexpr std::string_view kSyncDisabledTypes = "CustomSyncDisabledTypes";

// 沙箱与网页能力
inline constexpr std::string_view kDisableRendererSandbox = "CustomDisableRendererSandbox";
inline constexpr std::string_view kAllowJavaScript = "CustomAllowJavaScript";
inline constexpr std::string_view kAllowWebSockets = "CustomAllowWebSockets";
inline constexpr std::string_view kWebsocketAllowList = "CustomWebsocketAllowList";
inline constexpr std::string_view kWebsocketBlockedHosts = "CustomWebsocketBlockedHosts";
inline constexpr std::string_view kAllowWsUnderHttps = "CustomAllowWsUnderHttps";
inline constexpr std::string_view kWebSocketAllowedHosts = "CustomWebSocketAllowedHosts";
inline constexpr std::string_view kWebSocketBlockedHosts = "CustomWebSocketBlockedHosts";

// 同源 / CORS
inline constexpr std::string_view kDisableSameOriginPolicy = "CustomDisableSameOriginPolicy";
inline constexpr std::string_view kCrossOriginAllowList = "CustomCrossOriginAllowList";
inline constexpr std::string_view kAllowReadForeignCookieOrigins = "CustomAllowReadForeignCookieOrigins";

// 代理 / VLESS（ProxyMode / ProxyServer / ProxyBypassList 为原生键）
inline constexpr std::string_view kProxyVlessConfig = "CustomProxyVlessConfig";

// 网站黑白名单（SiteBlocklist / SiteAllowlist 原生；SiteListMode 自定义）
inline constexpr std::string_view kSiteListMode = "SiteListMode";

// 配额
inline constexpr std::string_view kLocalStorageQuotaMB = "CustomLocalStorageQuotaMB";
inline constexpr std::string_view kCloudDropQuotaMB = "CustomCloudDropQuotaMB";

// 搜索引擎（原生键）
// DefaultSearchProviderEnabled / DefaultSearchProviderSearchURL

// 扩展下发（原生 ForceInstall* 键 + 自定义）
inline constexpr std::string_view kAllowUserSelfInstallExtension = "AllowUserSelfInstallExtension";
inline constexpr std::string_view kAllowUserUninstallForcedExt = "AllowUserUninstallForcedExt";

// 伪装（扩展商店访问 UA 伪装）
inline constexpr std::string_view kSpoofBrowserVendor = "CustomSpoofBrowserVendor";
inline constexpr std::string_view kSpoofUserAgent = "CustomSpoofUserAgent";

// Drop / 协作
inline constexpr std::string_view kAllowDropCollaboration = "AllowDropCollaboration";

// 用户组功能黑白名单（feature_policy 键；组配置合并进 Policy JSON 下发）
inline constexpr std::string_view kFeatDropFileScreenshot = "allow_drop_file_screenshot";
inline constexpr std::string_view kFeatSync = "allow_sync";
inline constexpr std::string_view kFeatExportBackup = "allow_export_backup";
inline constexpr std::string_view kFeatCollabInvite = "allow_collab_invite";
inline constexpr std::string_view kFeatJoplinIntegration = "allow_joplin_integration";
inline constexpr std::string_view kFeatVlessProxy = "allow_vless_proxy";
inline constexpr std::string_view kFeatDisableSandbox = "allow_disable_sandbox";
inline constexpr std::string_view kFeatShareSessionContext = "allow_share_session_context";
inline constexpr std::string_view kFeatForwardSharedSession = "allow_forward_shared_session";

}  // namespace nodebyte::policy_keys

#endif  // CHROME_BROWSER_NODEBYTE_POLICY_EXTEND_NODEBYTE_POLICY_KEYS_H_
