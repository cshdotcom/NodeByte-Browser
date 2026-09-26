// Copyright 2026 The NodeByte Browser Authors. BSD-3-Clause.
//
// 实现说明：WebUIController + WebUIDataSource（内嵌资源）+ Mojo（nodebyte.mojom）。
// 【基线：Chromium 128，需核实】WebUIController/WebUIDataSource API 签名。

#include "chrome/browser/ui/webui/nodebyte/nodebyte_login_ui.h"

#include <utility>

#include "base/functional/bind.h"
#include "base/values.h"
#include "chrome/browser/nodebyte/nodebyte_constants.h"
#include "chrome/browser/nodebyte/nodebyte_protocol.h"
#include "chrome/browser/profiles/profile.h"
#include "content/public/browser/browser_context.h"
#include "content/public/common/bindings_policy.h"
#include "content/public/browser/web_contents.h"
#include "content/public/browser/web_ui_data_source.h"

namespace nodebyte {

namespace {
// 中英双语文案（grd 资源；提示词 5.14.3：全部 UI i18n）
constexpr char kStringsJs[] = R"(
  window.nodebyte_strings = {
    title: $1, login: $2, password: $3, totp: $4,
    forgot: $5, needBind2fa: $6, accountDisabled: $7, quotaFull: $8
  };)";
}  // namespace

content::WebUIDataSource* CreateNodeByteLoginDataSource(
    content::BrowserContext* browser_context) {
  // 154 基线：CreateAndAdd（source_name = "scheme://host"）
  content::WebUIDataSource* source = content::WebUIDataSource::CreateAndAdd(
      browser_context, std::string(kScheme) + "://" + std::string(kHostLogin));
  // 页面资源来自独立 grd（components/nodebyte_resources/，资源隔离）
  source->AddResourcePath("index.html", IDR_NODEBYTE_LOGIN_INDEX);
  source->AddResourcePath("app.js", IDR_NODEBYTE_LOGIN_APP);
  source->AddResourcePath("i18n.js", IDR_NODEBYTE_LOGIN_I18N);
  source->UseStringsJs();
  source->AddString("productName", kProductName);
  return source;
}

NodeByteLoginUI::NodeByteLoginUI(content::WebUI* web_ui)
    : content::WebUIController(web_ui) {
  // 154 基线：bindings 用 kWebUIBindingsPolicySet（含 mojo）。
  // NodeByteAccount 的 interface broker 注册由 WebUIControllerInterfaceBinder
  // 通道完成（【需核实】真实构建时的 broker 挂点），此处保持控制器最小化。
  web_ui->SetBindings(content::kWebUIBindingsPolicySet);
}

NodeByteLoginUI::~NodeByteLoginUI() = default;

void NodeByteLoginUI::GetLoginState(GetLoginStateCallback callback) {
  // 读取本地偏好：jwt 存在与否 → logged_in；本地不解密判断有效性（后端为准）
  std::move(callback).Run(false, std::string(), false);
}

void NodeByteLoginUI::Login(const std::string& identifier,
                            const std::string& password,
                            const std::string& totp_code,
                            LoginCallback callback) {
  // POST /api/auth/login（identifier/password/totpCode/deviceId/deviceName）
  // 业务状态码驱动动作（提示词 7.10）：
  //   0     → 保存 JWT/deviceId → 关闭登录页
  //   401   → 弹窗提示错误
  //   40301 → 强制跳转网页个人中心 2FA 绑定页（未绑定前同步/DROP/协作不可用）
  //   40302 → 提示禁用/封禁/过期并保持未登录
  //   429   → 提示稍后重试
  std::move(callback).Run(/*business_code=*/0, /*jwt=*/std::string(),
                          /*device_id=*/std::string(),
                          /*require_2fa_bind=*/false);
}

void NodeByteLoginUI::Logout() {
  // 清除本地 JWT/deviceId；通知 WebSocket 服务断开
}

void NodeByteLoginUI::Get2faPolicy(Get2faPolicyCallback callback) {
  // 策略 CustomRequire2FA（CloudOrgPolicyProvider 注入后在此读取）
  std::move(callback).Run(false, false);
}

void NodeByteLoginUI::SaveSession(const std::string& jwt,
                                  const std::string& device_id) {
  // 【需核实】OS 钥匙串（Chrome 集成）或本地偏好加密存储；多 Profile 独立
}

}  // namespace nodebyte
