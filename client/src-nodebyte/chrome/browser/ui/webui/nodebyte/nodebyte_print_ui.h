// Copyright 2026 The NodeByte Browser Authors. BSD-3-Clause.
//
// nodebyte://print WebUI 控制器（高级打印面板宿主，提示词 5.11.2/5.11.3）。
// 打印排版全部在 WebUI 层（pdf-kit 页面级二次处理，纯本地）；
// C++ 只注册资源与打印入口重定向（hook 0240，策略门控原生回退）。

#ifndef CHROME_BROWSER_UI_WEBUI_NODEBYTE_NODEBYTE_PRINT_UI_H_
#define CHROME_BROWSER_UI_WEBUI_NODEBYTE_NODEBYTE_PRINT_UI_H_

#include "content/public/browser/webui_controller.h"

namespace content {
class WebUIDataSource;
}  // namespace content

namespace nodebyte {

content::WebUIDataSource* CreateNodeBytePrintDataSource();

class NodeBytePrintUI : public content::WebUIController {
 public:
  explicit NodeBytePrintUI(content::WebUI* web_ui);
  ~NodeBytePrintUI() override;
};

}  // namespace nodebyte

#endif  // CHROME_BROWSER_UI_WEBUI_NODEBYTE_NODEBYTE_PRINT_UI_H_
