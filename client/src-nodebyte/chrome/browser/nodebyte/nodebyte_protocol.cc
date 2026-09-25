// Copyright 2026 The NodeByte Browser Authors. BSD-3-Clause.
//
// nodebyte:// 自定义协议注册。
// 实现说明：在 content 层注册自定义 scheme（标准做法是自定义 content::ContentBrowserClient
// 的 RegisterNonNetworkSubresourceURLLoaderFactory / RegisterNonNetworkNavigationURLLoaderFactory，
// 用 profile-scoped URLLoaderFactory 拦截 nodebyte:// 导航，交给 WebUIController 渲染本地页面）。
// 【基线：Chromium 128，需核实】ContentBrowserClient 挂点签名随版本变化。

#include "chrome/browser/nodebyte/nodebyte_protocol.h"

#include "base/strings/stringprintf.h"
#include "chrome/browser/nodebyte/nodebyte_constants.h"
#include "content/public/common/url_constants.h"
#include "url/gurl.h"
#include "url/url_util.h"

namespace nodebyte {

void RegisterNodeByteScheme() {
  // 标准scheme + 无CORS限制按 WebUI 处理；调用时机在 ContentBrowserClient 早期。
  // 【需核实】url::AddStandardScheme 在多进程下的注册时序要求。
  url::AddStandardScheme(kScheme.data(), url::SCHEME_WITH_HOST);
}

GURL MakeNodeByteUrl(std::string_view host) {
  return GURL(base::StringPrintf("%s://%s/", kScheme.data(), host.data()));
}

bool IsNodeByteUrl(const GURL& url) {
  return url.is_valid() && url.scheme_piece() == kScheme;
}

}  // namespace nodebyte
