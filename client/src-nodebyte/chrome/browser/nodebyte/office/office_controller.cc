// Copyright 2026 The NodeByte Browser Authors. BSD-3-Clause.
//
// 办公套件控制器实现（提示词 5.11）。
// 策略/指令读取遵循既有约定：
//   1) 指令强制值  prefs "nodebyte.directive.forced.<key>"（DirectiveApplier 写入）
//   2) 编译默认值（见 office_controller.h / policy-defaults.ts 对齐注释）
//
// API 基址解析遵循 nodebyte_constants.h「可塑性铁律」注释的三级优先：
//   指令 NodeByteSyncServerOverride → 用户设置 → 编译默认 kDefaultSyncServer。
// 【需核实】此处局部实现与 NodeByteProtocol 统一实现（若后续落地）合并。

#include "chrome/browser/nodebyte/office/office_controller.h"

#include "base/strings/string_util.h"
#include "base/strings/stringprintf.h"
#include "build/build_config.h"
#include "chrome/browser/nodebyte/nodebyte_constants.h"
#include "chrome/browser/profiles/profile.h"
#include "components/prefs/pref_service.h"

namespace nodebyte {

namespace {

constexpr char kPrefForcedPrefix[] = "nodebyte.directive.forced.";

std::string ResolveApiBase(Profile* profile) {
  if (!profile) return std::string(kDefaultSyncServer);
  // 1) 指令覆盖（NodeByteSyncServerOverride，mandatory；撤销即清空回退）
  const std::string kForced =
      kPrefForcedPrefix + std::string("NodeByteSyncServerOverride");
  const std::string& forced = profile->GetPrefs()->GetString(kForced);
  if (!forced.empty()) return forced;
  // 2) 用户设置（设置页可改；CustomLockSyncServer 仅影响 UI 置灰）
  const std::string& user =
      profile->GetPrefs()->GetString("nodebyte.settings.sync_server");
  if (!user.empty()) return user;
  // 3) 编译默认
  return std::string(kDefaultSyncServer);
}

}  // namespace

bool OfficeController::IsSuiteEnabled(Profile* profile) {
  const std::string kKey = kPrefForcedPrefix +
      std::string(kPolicyNodeByteOfficeSuiteEnabled);
  // 无指令值 → 默认 true（与 server policy-defaults.ts 对齐）
  if (!profile || !profile->GetPrefs()->HasPrefPath(kKey)) return true;
  return profile->GetPrefs()->GetBoolean(kKey);
}

bool OfficeController::IsAndroidEditAllowed(Profile* profile) {
#if BUILDFLAG(IS_ANDROID)
  const std::string kKey = kPrefForcedPrefix +
      std::string(kPolicyNodeByteOfficeAndroidEdit);
  if (!profile || !profile->GetPrefs()->HasPrefPath(kKey)) return false;
  return profile->GetPrefs()->GetBoolean(kKey);
#else
  (void)profile;
  return true;  // 桌面端完整编辑（提示词 5.11.1）
#endif
}

std::string OfficeController::PlatformGateJson(Profile* profile) {
  return base::StringPrintf(
      R"({"platform":"%s","canEdit":%s,"officeSuite":%s,"syncServer":"%s"})",
#if BUILDFLAG(IS_ANDROID)
      "android",
#else
      "desktop",
#endif
      IsAndroidEditAllowed(profile) ? "true" : "false",
      IsSuiteEnabled(profile) ? "true" : "false",
      ResolveApiBase(profile).c_str());
}

bool OfficeController::CanOpenExtension(const std::string& path) {
  return base::EndsWith(path, ".md", base::CompareCase::INSENSITIVE_ASCII) ||
         base::EndsWith(path, ".markdown", base::CompareCase::INSENSITIVE_ASCII) ||
         base::EndsWith(path, ".txt", base::CompareCase::INSENSITIVE_ASCII) ||
         base::EndsWith(path, ".docx", base::CompareCase::INSENSITIVE_ASCII) ||
         base::EndsWith(path, ".pptx", base::CompareCase::INSENSITIVE_ASCII) ||
         base::EndsWith(path, ".pdf", base::CompareCase::INSENSITIVE_ASCII);
}

}  // namespace nodebyte
