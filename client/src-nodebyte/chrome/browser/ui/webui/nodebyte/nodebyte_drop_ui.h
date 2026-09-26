// Copyright 2026 The NodeByte Browser Authors. BSD-3-Clause.
//
// nodebyte://drop WebUI 控制器（Drop 侧边栏页面宿主）。
// 业务全部在 WebUI（Vue），C++ 只暴露原子能力（mojo/nodebyte.mojom）。

#ifndef CHROME_BROWSER_UI_WEBUI_NODEBYTE_NODEBYTE_DROP_UI_H_
#define CHROME_BROWSER_UI_WEBUI_NODEBYTE_NODEBYTE_DROP_UI_H_

#include "content/public/browser/web_ui_controller.h"

namespace content {
class WebUIDataSource;
}  // namespace content

namespace nodebyte {

content::WebUIDataSource* CreateNodeByteDropDataSource();

class NodeByteDropUI : public content::WebUIController {
 public:
  explicit NodeByteDropUI(content::WebUI* web_ui);
  ~NodeByteDropUI() override;

 private:
  // 服务端推送 → WebUI 桥（mojo NodeByteDropClient）
  void BindMojo();
};

}  // namespace nodebyte

#endif  // CHROME_BROWSER_UI_WEBUI_NODEBYTE_NODEBYTE_DROP_UI_H_
