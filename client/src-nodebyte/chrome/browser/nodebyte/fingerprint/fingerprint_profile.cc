// Copyright 2026 The NodeByte Browser Authors. BSD-3-Clause.

#include "chrome/browser/nodebyte/fingerprint/fingerprint_profile.h"

#include "base/files/file_util.h"
#include "base/json/json_reader.h"
#include "base/json/json_writer.h"
#include "base/logging.h"
#include "base/strings/string_util.h"

namespace nodebyte {

FingerprintTemplate FingerprintTemplate::FromJson(
    const base::Value::Dict& json) {
  FingerprintTemplate t;
  if (const std::string* v = json.FindString("userAgent")) t.user_agent = *v;
  if (const std::string* v = json.FindString("acceptLanguage")) t.accept_language = *v;
  if (const std::string* v = json.FindString("accept")) t.accept = *v;
  if (const std::string* v = json.FindString("referer")) t.referer = *v;
  if (const std::string* v = json.FindString("webdriver")) t.webdriver = *v;
  if (const std::string* v = json.FindString("platform")) t.platform = *v;
  t.hardware_concurrency = json.FindInt("hardwareConcurrency").value_or(0);
  t.webgl_noise = json.FindBool("webglNoise").value_or(false);
  t.audio_noise = json.FindBool("audioNoise").value_or(false);
  if (const std::string* v = json.FindString("timezone")) t.timezone = *v;
  if (const std::string* v = json.FindString("language")) t.language = *v;
  t.screen_width = json.FindInt("screenWidth").value_or(0);
  t.screen_height = json.FindInt("screenHeight").value_or(0);
  return t;
}

base::Value::Dict FingerprintTemplate::ToJson() const {
  base::Value::Dict d;
  d.Set("userAgent", user_agent);
  d.Set("acceptLanguage", accept_language);
  d.Set("accept", accept);
  d.Set("referer", referer);
  d.Set("webdriver", webdriver);
  d.Set("platform", platform);
  d.Set("hardwareConcurrency", hardware_concurrency);
  d.Set("webglNoise", webgl_noise);
  d.Set("audioNoise", audio_noise);
  d.Set("timezone", timezone);
  d.Set("language", language);
  d.Set("screenWidth", screen_width);
  d.Set("screenHeight", screen_height);
  return d;
}

FingerprintProfile::FingerprintProfile(const base::FilePath& profile_path)
    : prefs_path_(profile_path.AppendASCII("nodebyte")
                      .AppendASCII("fingerprint.json")) {}

void FingerprintProfile::ApplyTemplate(const FingerprintTemplate& tpl) {
  current_ = tpl;
  // 生效点（hook 补丁 0220 落位后启用，见提示词 5.6.4）：
  //   HTTP 层：services/network/public/cpp/resource_request.cc —— 请求头改写
  //   渲染层：third_party/blink/renderer/core/frame/navigator_base.cc —— navigator 返回值
  //   WebGL：third_party/blink/renderer/modules/webgl/ —— 画布噪声
  //   Audio：AudioContext 输出扰动
}

void FingerprintProfile::SaveLocalOverride(const FingerprintTemplate& tpl) {
  current_ = tpl;
  std::string json;
  base::JSONWriter::Write(tpl.ToJson(), &json);
  base::CreateDirectory(prefs_path_.DirName());
  base::WriteFile(prefs_path_, json);  // 自定义 UA 仅本地生效不上传（提示词 5.14.4）
}

void FingerprintProfile::ResetToDefault() {
  current_ = FingerprintTemplate{};  // 恢复默认 NodeByte 标识
  base::DeleteFile(prefs_path_);
}

bool FingerprintProfile::ShouldSpoofForUrl(const GURL& url) const {
  // Edge 扩展商店 / Chrome 网上应用店 域名（【需核实】完整域列表）
  const std::string host = url.host();
  return base::EndsWith(host, "microsoftedge.com",
                        base::CompareCase::INSENSITIVE_ASCII) ||
         base::EndsWith(host, "chromewebstore.google.com",
                        base::CompareCase::INSENSITIVE_ASCII) ||
         base::EndsWith(host, "microsoft.com",
                        base::CompareCase::INSENSITIVE_ASCII);
}

std::string FingerprintProfile::SpoofedUserAgent() const {
  // 由策略 CustomSpoofBrowserVendor / CustomSpoofUserAgent 提供伪装值；
  // Edge 商店伪装 Edge、Chrome 商店伪装 Chrome，避免商店拦截。
  return current_.user_agent;
}

}  // namespace nodebyte
