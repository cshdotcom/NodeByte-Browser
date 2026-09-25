// Copyright 2026 The NodeByte Browser Authors. BSD-3-Clause.
//
// nodebyte://login WebUI 控制器（客户端提示词 5.1.1）。
// 替换浏览器原生 Google 账号入口：自建登录界面（内嵌表单），对接后端
// OAuth2/JWT；本地保存 JWT 与设备 ID；业务状态码驱动 UI 动作。

#ifndef CHROME_BROWSER_UI_WEBUI_NODEBYTE_NODEBYTE_LOGIN_UI_H_
#define CHROME_BROWSER_UI_WEBUI_NODEBYTE_NODEBYTE_LOGIN_UI_H_

#include "chrome/browser/nodebyte/mojo/nodebyte.mojom.h"
#include "content/public/browser/webui_controller.h"
#include "mojo/public/cpp/bindings/receiver_set.h"

namespace content {
class WebUIDataSource;
}  // namespace content

namespace nodebyte {

// 注册 nodebyte://login 数据源（资源 grd 独立文件，资源隔离铁律）
content::WebUIDataSource* CreateNodeByteLoginDataSource();

class NodeByteLoginUI : public content::WebUIController,
                        public mojom::NodeByteAccount {
 public:
  explicit NodeByteLoginUI(content::WebUI* web_ui);
  ~NodeByteLoginUI() override;

  // mojom::NodeByteAccount（由 nodebyte://login 页面 JS 调用）
  void GetLoginState(GetLoginStateCallback callback) override;
  void Login(const std::string& identifier, const std::string& password,
             const std::string& totp_code, LoginCallback callback) override;
  void Logout() override;
  void Get2faPolicy(Get2faPolicyCallback callback) override;

 private:
  // JWT / device_id 持久化：本地偏好（加密存储，多 Profile 独立）
  void SaveSession(const std::string& jwt, const std::string& device_id);

  mojo::ReceiverSet<mojom::NodeByteAccount> receivers_;
};

}  // namespace nodebyte

#endif  // CHROME_BROWSER_UI_WEBUI_NODEBYTE_NODEBYTE_LOGIN_UI_H_
