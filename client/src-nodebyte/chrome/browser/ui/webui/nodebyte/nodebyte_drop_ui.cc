// Copyright 2026 The NodeByte Browser Authors. BSD-3-Clause.

#include "chrome/browser/ui/webui/nodebyte/nodebyte_drop_ui.h"

#include "chrome/browser/nodebyte/nodebyte_constants.h"
#include "chrome/browser/nodebyte/nodebyte_protocol.h"
#include "content/public/browser/web_ui_data_source.h"

namespace nodebyte {

content::WebUIDataSource* CreateNodeByteDropDataSource() {
  content::WebUIDataSource* source =
      content::WebUIDataSource::Create(std::string(kScheme) + "::" +
                                       std::string(kHostDrop));
  source->AddResourcePath("index.html", IDR_NODEBYTE_DROP_INDEX);
  source->AddResourcePath("app.js", IDR_NODEBYTE_DROP_APP);
  source->AddResourcePath("i18n.js", IDR_NODEBYTE_DROP_I18N);
  source->AddString("productName", kProductName);
  return source;
}

NodeByteDropUI::NodeByteDropUI(content::WebUI* web_ui)
    : content::WebUIController(web_ui) {
  web_ui->SetBindings(content::BindingsPolicy::kMojo);
  BindMojo();
}

NodeByteDropUI::~NodeByteDropUI() = default;

void NodeByteDropUI::BindMojo() {
  // WebUI 通过 Mojo.bindInterface("nodebyte.mojom.NodeByteDrop") 获得
  // DropSidePanelCoordinator（文件/截图/推送/会话分享 原子能力）。
  // 【需核实】WebUI Mojo 接口注册点（MojoBinderPolicy）。
}

}  // namespace nodebyte
