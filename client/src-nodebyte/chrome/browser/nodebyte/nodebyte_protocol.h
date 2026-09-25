// Copyright 2026 The NodeByte Browser Authors. BSD-3-Clause.

#ifndef CHROME_BROWSER_NODEBYTE_NODEBYTE_PROTOCOL_H_
#define CHROME_BROWSER_NODEBYTE_NODEBYTE_PROTOCOL_H_

#include <string_view>

class GURL;

namespace nodebyte {

// 注册 nodebyte:// 为标准 scheme（进程早期调用一次）。
void RegisterNodeByteScheme();

// 构造内部页面 URL，如 MakeNodeByteUrl(kHostDrop) → nodebyte://drop/
GURL MakeNodeByteUrl(std::string_view host);

bool IsNodeByteUrl(const GURL& url);

}  // namespace nodebyte

#endif  // CHROME_BROWSER_NODEBYTE_NODEBYTE_PROTOCOL_H_
