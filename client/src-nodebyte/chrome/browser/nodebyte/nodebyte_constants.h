// Copyright 2026 The NodeByte Browser Authors. BSD-3-Clause.
//
// NodeByte Browser 客户端常量定义。
// 低侵入铁律：本目录（//chrome/browser/nodebyte/）是全部自研业务的唯一 C++ 落点，
// 内核大版本升级时整体迁移，尽量不修改 Chromium 原有文件。

#ifndef CHROME_BROWSER_NODEBYTE_NODEBYTE_CONSTANTS_H_
#define CHROME_BROWSER_NODEBYTE_NODEBYTE_CONSTANTS_H_

#include <string_view>

namespace nodebyte {

// 产品名（恒定，N、B 大写；提示词 4.1）
inline constexpr std::string_view kProductName = "NodeByte Browser";
inline constexpr std::string_view kProductNameZh = "NodeByte 浏览器";

// 自定义内部协议（代码内常量定义，不与 chrome:// 冲突；提示词 4.2）
inline constexpr std::string_view kScheme = "nodebyte";

// 内部页面主机名（nodebyte://xxx）
inline constexpr std::string_view kHostLogin = "login";
inline constexpr std::string_view kHostDrop = "drop";
inline constexpr std::string_view kHostSettings = "settings";
inline constexpr std::string_view kHostUserCenter = "usercenter";
inline constexpr std::string_view kHostGame = "game";
inline constexpr std::string_view kHostTranslate = "translate";

// 默认同步服务地址（提示词 4.3；设置页展示，策略 CustomLockSyncServer=true 时置灰）
inline constexpr std::string_view kDefaultSyncServer = "bsync.nodebyte.cn";

// 编译默认搜索引擎（客户端提示词 4.5/12：必应；策略/指令可覆盖并锁定，
// 撤销后由 DirectiveApplier/TemplateURLService 恢复到此默认）。
inline constexpr std::string_view kDefaultSearchEngineName = "Bing";
inline constexpr std::string_view kDefaultSearchURL = "https://cn.bing.com/search?q={searchTerms}";

// 关于页标注（提示词 4.4）
inline constexpr std::string_view kChromiumAttribution =
    "Based on Chromium open-source project";

// 策略拉取间隔（分钟；策略变更另有 WebSocket policy_update 即时触发）
inline constexpr int kPolicyPollMinutes = 15;

// 设备状态上报间隔（秒；提示词 3.3.4）
inline constexpr int kDeviceStatusReportSeconds = 30;

// 本地导出备份扩展名（提示词 5.2.4：本地完成、不经过服务端）
inline constexpr std::string_view kBackupExtension = ".custom-browser-backup";

// 翻译策略键（与 server/src/lib/policy-defaults.ts 对齐）
inline constexpr std::string_view kPolicyNodeByteTranslateEnabled = "NodeByteTranslateEnabled";
inline constexpr std::string_view kPolicyNodeByteTranslateAllowAnonymous = "NodeByteTranslateAllowAnonymous";
inline constexpr std::string_view kPolicyNodeByteTranslateMaxChars = "NodeByteTranslateMaxChars";

// 翻译默认目标语言（与 server/src/lib/translate.ts DEFAULT_SETTINGS.defaultTarget 对齐）
inline constexpr std::string_view kDefaultTranslateTarget = "zh-CN";

// =====================================================================
// 可塑性 / 动态服务器绑定（用户需求：同步服务器地址改了 → 所有接口自动跟随）
// =====================================================================
// 铁律：任何模块【禁止】把服务器地址写死。所有 API 调用统一经
//   NodeByteProtocol::ApiBase()
// 取「当前生效的同步服务器地址」，解析优先级：
//   1) 策略指令 NodeByteSyncServerOverride（mandatory，撤销即清空回退）
//   2) 用户设置 prefs kSyncServerPref（设置页可改，受 CustomLockSyncServer 限制）
//   3) 编译默认 kDefaultSyncServer
// 地址变更时 NodeByteProtocol::NotifySyncServerChanged() 依序通知：
//   同步客户端重拉策略 → WebSocket 断开重连（新地址）→ Drop/翻译/TTS/更新
//   各模块的内存 API 基地址缓存失效并重建。全程无需重启浏览器。
inline constexpr std::string_view kApiPathPolicy = "/api/client/policy";
inline constexpr std::string_view kApiPathTranslate = "/api/translate";
inline constexpr std::string_view kApiPathTts = "/api/tts";
inline constexpr std::string_view kApiPathClientUpdate = "/api/client/update";
inline constexpr std::string_view kApiPathExtDownload = "/api/client/ext-download";
inline constexpr std::string_view kApiPathSyncImported = "/api/sync/imported";
inline constexpr std::string_view kWsPathSignal = "/ws";

// TTS 朗读策略键（与 policy-defaults.ts 对齐；客户端朗读走 /api/tts 后端代理）
inline constexpr std::string_view kPolicyNodeByteTtsEnabled = "NodeByteTtsEnabled";
inline constexpr std::string_view kPolicyNodeByteTtsMaxChars = "NodeByteTtsMaxChars";
// 默认 TTS 音色（Edge 神经音色；实际可用音色由 /api/tts GET 返回）
inline constexpr std::string_view kDefaultTtsVoice = "zh-CN-XiaoxiaoNeural";

// 浏览器更新检查（走 /api/client/update；策略关闭则隐藏「检查更新」入口）
inline constexpr std::string_view kPolicyNodeByteUpdateCheckEnabled = "NodeByteUpdateCheckEnabled";
inline constexpr int kUpdateCheckIntervalHours = 24;

// 扩展商店代理下载（走 /api/client/ext-download；关闭则回退直连官方商店）
inline constexpr std::string_view kPolicyNodeByteExtProxyDownload = "NodeByteExtProxyDownload";

}  // namespace nodebyte

#endif  // CHROME_BROWSER_NODEBYTE_NODEBYTE_CONSTANTS_H_
