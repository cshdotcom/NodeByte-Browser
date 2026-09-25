// Copyright 2026 The NodeByte Browser Authors. BSD-3-Clause.
//
// 浏览器指纹模板（客户端提示词 5.6 / F.5）：
//   目标：不同设备使用同一套账号时指纹可以不同，防同 Cookie 跨设备风控。
//   来源：后台策略下发模板（每设备可不同）+ 本地手动编辑；参与同步。
//
// 能力边界（必须向用户明示，提示词 13.9/13.10）：
//   - TCP 层 IP 无法靠指纹修改（靠代理解决）
//   - 部分硬件 ID 来自操作系统、沙盒内拿不到
//   - 指纹只能混淆，不能保证 100% 绕过风控（风控 = IP + Cookie + 指纹 三位一体）

#ifndef CHROME_BROWSER_NODEBYTE_FINGERPRINT_FINGERPRINT_PROFILE_H_
#define CHROME_BROWSER_NODEBYTE_FINGERPRINT_FINGERPRINT_PROFILE_H_

#include <string>

#include "base/values.h"
#include "url/gurl.h"

namespace nodebyte {

struct FingerprintTemplate {
  // HTTP 层（resource_request.cc：改写请求头，每设备独立配置）
  std::string user_agent;
  std::string accept_language;
  std::string accept;
  std::string referer;

  // JS API（navigator_base.cc / webgl / audio）
  std::string webdriver;             // navigator.webdriver（"true"/"false"）
  std::string platform;              // navigator.platform
  int hardware_concurrency = 0;      // navigator.hardwareConcurrency（0=不改）
  bool webgl_noise = false;          // WebGL 画布指纹加噪声
  bool audio_noise = false;          // AudioContext 输出加扰动
  std::string timezone;              // 时区模拟（空=跟随系统）
  std::string language;              // navigator.language
  int screen_width = 0;              // 屏幕分辨率模拟（0=不改）
  int screen_height = 0;

  static FingerprintTemplate FromJson(const base::Value::Dict& json);
  base::Value::Dict ToJson() const;
};

class FingerprintProfile {
 public:
  explicit FingerprintProfile(const base::FilePath& profile_path);

  // 加载：策略模板（CloudPolicyProvider 通知）或本地自定义（开发模式面板）
  void ApplyTemplate(const FingerprintTemplate& tpl);
  const FingerprintTemplate& current() const { return current_; }

  // 本地自定义持久化（仅本地生效；开发模式开关控制 UI 可见性）
  void SaveLocalOverride(const FingerprintTemplate& tpl);
  void ResetToDefault();  // 恢复默认 NodeByte 标识

  // 商店伪装（提示词 5.10.3）：访问 Edge/Chrome 扩展商店时 UA 伪装为原版浏览器；
  // 普通网页仍用 NodeByte UA。由 CustomSpoofBrowserVendor/CustomSpoofUserAgent 控制。
  bool ShouldSpoofForUrl(const GURL& url) const;
  std::string SpoofedUserAgent() const;

 private:
  base::FilePath prefs_path_;  // <profile>/nodebyte/fingerprint.json
  FingerprintTemplate current_;
};

}  // namespace nodebyte

#endif  // CHROME_BROWSER_NODEBYTE_FINGERPRINT_FINGERPRINT_PROFILE_H_
