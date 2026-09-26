// Copyright 2026 The NodeByte Browser Authors. BSD-3-Clause.

#include "chrome/browser/ui/webui/nodebyte/nodebyte_drop_ui.h"

#include "chrome/browser/nodebyte/nodebyte_constants.h"
#include "content/public/browser/browser_context.h"
#include "content/public/common/bindings_policy.h"
#include "chrome/browser/nodebyte/nodebyte_protocol.h"
#include "content/public/browser/web_ui_data_source.h"

namespace nodebyte {

content::WebUIDataSource* CreateNodeByteDropDataSource(
    content::BrowserContext* browser_context) {
  // 154 基线：Create+Add 合并为 CreateAndAdd；source_name = "scheme://host"
  content::WebUIDataSource* source = content::WebUIDataSource::CreateAndAdd(
      browser_context, std::string(kScheme) + "://" + std::string(kHostDrop));
  source->AddResourcePath("index.html", IDR_NODEBYTE_DROP_INDEX);
  source->AddResourcePath("app.js", IDR_NODEBYTE_DROP_APP);
  source->AddResourcePath("i18n.js", IDR_NODEBYTE_DROP_I18N);
  source->AddString("productName", kProductName);
  return source;
}

NodeByteDropUI::NodeByteDropUI(content::WebUI* web_ui)
    : content::WebUIController(web_ui) {
  web_ui->SetBindings(content::kWebUIBindingsPolicySet);  // 154 基线
  BindMojo();
}

NodeByteDropUI::~NodeByteDropUI() = default;

void NodeByteDropUI::BindMojo() {
  // WebUI 通过 Mojo.bindInterface("nodebyte.mojom.NodeByteDrop") 获得
  // DropSidePanelCoordinator（文件/截图/推送/会话分享 原子能力）。
  // 【需核实】WebUI Mojo 接口注册点（MojoBinderPolicy）。
}

}  // namespace nodebyte
