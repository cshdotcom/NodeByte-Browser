// Copyright 2026 The NodeByte Browser Authors. BSD-3-Clause.

#include "chrome/browser/ui/webui/nodebyte/nodebyte_office_ui.h"

#include "chrome/browser/nodebyte/nodebyte_constants.h"
#include "chrome/browser/nodebyte/office/office_controller.h"
#include "chrome/browser/profiles/profile.h"
#include "grit/nodebyte_resources.h"
#include "content/public/browser/web_ui.h"
#include "content/public/browser/browser_context.h"
#include "content/public/browser/web_ui_data_source.h"

namespace nodebyte {

content::WebUIDataSource* CreateNodeByteOfficeDataSource(
    content::BrowserContext* browser_context) {
  // 154 基线：CreateAndAdd（source_name = "scheme://host"）
  content::WebUIDataSource* source = content::WebUIDataSource::CreateAndAdd(
      browser_context, std::string(kScheme) + "://" + std::string(kHostOffice));
  source->AddResourcePath("index.html", IDR_NODEBYTE_OFFICE_INDEX);
  source->AddResourcePath("app.js", IDR_NODEBYTE_OFFICE_APP);
  source->AddString("productName", kProductName);
  // 平台门控（WebUI 启动脚本读取后设置 window.__NODEBYTE__）
  source->AddString("platformGate",
                    OfficeController::PlatformGateJson(
                        /*profile=*/nullptr));
  return source;
}

NodeByteOfficeUI::NodeByteOfficeUI(content::WebUI* web_ui)
    : content::WebUIController(web_ui) {
  // 纯 WebUI 业务：无 Mojo 依赖（文件读写走 File API + Blob 下载）
}

NodeByteOfficeUI::~NodeByteOfficeUI() = default;

}  // namespace nodebyte
