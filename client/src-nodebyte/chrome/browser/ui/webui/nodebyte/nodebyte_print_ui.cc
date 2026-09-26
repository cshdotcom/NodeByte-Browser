// Copyright 2026 The NodeByte Browser Authors. BSD-3-Clause.

#include "chrome/browser/ui/webui/nodebyte/nodebyte_print_ui.h"

#include "chrome/browser/nodebyte/nodebyte_constants.h"
#include "grit/nodebyte_resources.h"
#include "content/public/browser/web_ui.h"
#include "content/public/browser/web_ui_data_source.h"

namespace nodebyte {

content::WebUIDataSource* CreateNodeBytePrintDataSource() {
  content::WebUIDataSource* source =
      content::WebUIDataSource::Create(std::string(kScheme) + "::" +
                                       std::string(kHostPrint));
  source->AddResourcePath("index.html", IDR_NODEBYTE_PRINT_INDEX);
  source->AddResourcePath("app.js", IDR_NODEBYTE_PRINT_APP);
  source->AddResourcePath("pdf-kit.js", IDR_NODEBYTE_PRINT_PDF_KIT);
  source->AddString("productName", kProductName);
  return source;
}

NodeBytePrintUI::NodeBytePrintUI(content::WebUI* web_ui)
    : content::WebUIController(web_ui) {
  // 纯本地 PDF 处理：无 Mojo、无网络依赖（隐私铁律：PDF 不出设备）
}

NodeBytePrintUI::~NodeBytePrintUI() = default;

}  // namespace nodebyte
