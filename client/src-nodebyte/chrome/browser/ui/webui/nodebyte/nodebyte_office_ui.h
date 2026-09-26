// Copyright 2026 The NodeByte Browser Authors. BSD-3-Clause.
//
// nodebyte://office WebUI 控制器（办公套件页面宿主，提示词 5.11）。
// 业务全部在 WebUI 层（零依赖 JS/DecompressionStream），C++ 只注册资源并
// 注入平台门控（window.__NODEBYTE__：platform/canEdit/syncServer）。

#ifndef CHROME_BROWSER_UI_WEBUI_NODEBYTE_NODEBYTE_OFFICE_UI_H_
#define CHROME_BROWSER_UI_WEBUI_NODEBYTE_NODEBYTE_OFFICE_UI_H_

#include "content/public/browser/webui_controller.h"

namespace content {
class WebUIDataSource;
}  // namespace content

namespace nodebyte {

// 注册 nodebyte://office 数据源（资源来自独立 grd，资源隔离铁律）
content::WebUIDataSource* CreateNodeByteOfficeDataSource();

class NodeByteOfficeUI : public content::WebUIController {
 public:
  explicit NodeByteOfficeUI(content::WebUI* web_ui);
  ~NodeByteOfficeUI() override;
};

}  // namespace nodebyte

#endif  // CHROME_BROWSER_UI_WEBUI_NODEBYTE_NODEBYTE_OFFICE_UI_H_
