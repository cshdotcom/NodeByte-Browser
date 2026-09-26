// Copyright 2026 The NodeByte Browser Authors. BSD-3-Clause.
//
// nodebyte:// WebUI 统一注册实现。
// 【基线：Chromium 128，需核实】content::WebUIConfig 构造签名与
// CreateWebUIController/CreateWebUIDataSource 虚函数形态；
// WebUIDataSource::Add(profile, source) 的线程与时序要求。

#include "chrome/browser/ui/webui/nodebyte/nodebyte_ui_configs.h"

#include <memory>
#include <string>
#include <utility>

#include "chrome/browser/nodebyte/nodebyte_constants.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/ui/webui/nodebyte/nodebyte_drop_ui.h"
#include "chrome/browser/ui/webui/nodebyte/nodebyte_login_ui.h"
#include "chrome/browser/ui/webui/nodebyte/nodebyte_office_ui.h"
#include "chrome/browser/ui/webui/nodebyte/nodebyte_print_ui.h"
#include "content/public/browser/web_ui.h"
#include "content/public/browser/web_ui_config.h"
#include "content/public/browser/web_ui_controller.h"
#include "content/public/browser/web_ui_data_source.h"
#include "grit/nodebyte_resources.h"
#include "url/gurl.h"

namespace nodebyte {

namespace {

// ---- 通用数据源：按主机挂对应 grd 资源 ----
content::WebUIDataSource* CreateSourceForHost(const std::string& host) {
  content::WebUIDataSource* source =
      content::WebUIDataSource::Create(std::string(kScheme) + "::" + host);
  if (host == kHostSettings) {
    source->AddResourcePath("index.html", IDR_NODEBYTE_SETTINGS_INDEX);
  } else if (host == kHostTranslate) {
    source->AddResourcePath("index.html", IDR_NODEBYTE_TRANSLATE_INDEX);
    source->AddResourcePath("app.js", IDR_NODEBYTE_TRANSLATE_APP);
  } else if (host == kHostGame) {
    source->AddResourcePath("index.html", IDR_NODEBYTE_GAME_INDEX);
    source->AddResourcePath("game.js", IDR_NODEBYTE_GAME_APP);
  } else if (host == kHostUserCenter) {
    // 在线个人中心（v1.4.x：跳转网页版；此占位数据源保证主机可解析）
    source->AddResourcePath("index.html", IDR_NODEBYTE_USERCENTER_INDEX);
  }
  source->AddString("productName", kProductName);
  return source;
}

// ---- 通用控制器：settings / translate / game / usercenter ----
class GenericNodeByteUI : public content::WebUIController {
 public:
  explicit GenericNodeByteUI(content::WebUI* web_ui)
      : content::WebUIController(web_ui) {}
};

// ---- 通用 WebUIConfig ----
class GenericNodeByteConfig : public content::WebUIConfig {
 public:
  explicit GenericNodeByteConfig(const std::string& host)
      : content::WebUIConfig(std::string(kScheme), host), host_(host) {}

  std::unique_ptr<content::WebUIController> CreateWebUIController(
      content::WebUI* web_ui, const GURL& url) override {
    content::WebUIDataSource* source = CreateSourceForHost(host_);
    if (source)
      content::WebUIDataSource::Add(
          Profile::FromWebUI(web_ui)->GetOriginalProfile(), source);
    return std::make_unique<GenericNodeByteUI>(web_ui);
  }

 private:
  std::string host_;
};

class NodeByteLoginConfig : public content::WebUIConfig {
 public:
  NodeByteLoginConfig()
      : content::WebUIConfig(std::string(kScheme), std::string(kHostLogin)) {}

  std::unique_ptr<content::WebUIController> CreateWebUIController(
      content::WebUI* web_ui, const GURL& url) override {
    content::WebUIDataSource::Add(
        Profile::FromWebUI(web_ui)->GetOriginalProfile(),
        CreateNodeByteLoginDataSource());
    return std::make_unique<NodeByteLoginUI>(web_ui);
  }
};

class NodeByteDropConfig : public content::WebUIConfig {
 public:
  NodeByteDropConfig()
      : content::WebUIConfig(std::string(kScheme), std::string(kHostDrop)) {}

  std::unique_ptr<content::WebUIController> CreateWebUIController(
      content::WebUI* web_ui, const GURL& url) override {
    content::WebUIDataSource::Add(
        Profile::FromWebUI(web_ui)->GetOriginalProfile(),
        CreateNodeByteDropDataSource());
    return std::make_unique<NodeByteDropUI>(web_ui);
  }
};

class NodeByteOfficeConfig : public content::WebUIConfig {
 public:
  NodeByteOfficeConfig()
      : content::WebUIConfig(std::string(kScheme), std::string(kHostOffice)) {}

  std::unique_ptr<content::WebUIController> CreateWebUIController(
      content::WebUI* web_ui, const GURL& url) override {
    content::WebUIDataSource::Add(
        Profile::FromWebUI(web_ui)->GetOriginalProfile(),
        CreateNodeByteOfficeDataSource());
    return std::make_unique<NodeByteOfficeUI>(web_ui);
  }
};

class NodeBytePrintConfig : public content::WebUIConfig {
 public:
  NodeBytePrintConfig()
      : content::WebUIConfig(std::string(kScheme), std::string(kHostPrint)) {}

  std::unique_ptr<content::WebUIController> CreateWebUIController(
      content::WebUI* web_ui, const GURL& url) override {
    content::WebUIDataSource::Add(
        Profile::FromWebUI(web_ui)->GetOriginalProfile(),
        CreateNodeBytePrintDataSource());
    return std::make_unique<NodeBytePrintUI>(web_ui);
  }
};

}  // namespace

void RegisterNodeByteWebUIConfigs() {
  content::WebUIConfigTable& table = content::GetWebUIConfigTable();
  table.Add(std::make_unique<NodeByteLoginConfig>());
  table.Add(std::make_unique<NodeByteDropConfig>());
  table.Add(std::make_unique<GenericNodeByteConfig>(std::string(kHostSettings)));
  table.Add(std::make_unique<GenericNodeByteConfig>(std::string(kHostTranslate)));
  table.Add(std::make_unique<GenericNodeByteConfig>(std::string(kHostGame)));
  table.Add(std::make_unique<GenericNodeByteConfig>(std::string(kHostUserCenter)));
  table.Add(std::make_unique<NodeByteOfficeConfig>());
  table.Add(std::make_unique<NodeBytePrintConfig>());
  // scheme 早期注册（hook 0240 同时调用 RegisterNodeByteScheme()）
}

}  // namespace nodebyte
