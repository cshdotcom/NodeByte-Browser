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

}  // namespace nodebyte

#endif  // CHROME_BROWSER_NODEBYTE_NODEBYTE_CONSTANTS_H_
