// Copyright 2026 The NodeByte Browser Authors. BSD-3-Clause.
//
// 办公套件控制器（提示词 5.11）：平台门控 + 策略读取 + API 基址注入。
// 业务全部在 nodebyte://office WebUI（零依赖 JS），C++ 只提供原子能力。

#ifndef CHROME_BROWSER_NODEBYTE_OFFICE_OFFICE_CONTROLLER_H_
#define CHROME_BROWSER_NODEBYTE_OFFICE_OFFICE_CONTROLLER_H_

#include <string>

class Profile;

namespace nodebyte {

class OfficeController {
 public:
  // 总开关（策略 NodeByteOfficeSuiteEnabled / 指令通道可运行时切换）
  static bool IsSuiteEnabled(Profile* profile);
  // Android 仅预览（提示词 5.11.1 平台差异）；策略 NodeByteOfficeAndroidEdit 放开
  static bool IsAndroidEditAllowed(Profile* profile);
  // 注入给 WebUI 的 window.__NODEBYTE__（platform/canEdit/syncServer）
  static std::string PlatformGateJson(Profile* profile);
  // 外部文件打开扩展名白名单（.md/.txt/.docx/.pptx/.pdf）
  static bool CanOpenExtension(const std::string& path);
};

}  // namespace nodebyte

#endif  // CHROME_BROWSER_NODEBYTE_OFFICE_OFFICE_CONTROLLER_H_
