// Copyright 2025 The NodeByte Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/nodebyte/nodebyte_branding.h"

#include "base/strings/string_util.h"
#include "base/strings/utf_string_conversions.h"
#include "ui/base/l10n/l10n_util.h"

namespace nodebyte {

std::string GetLocalizedProductLabel() {
  // l10n_util::GetApplicationLocale 返回当前 UI locale（如 zh-CN）。
  return GetLocalizedProductLabelForLocale(
      l10n_util::GetApplicationLocale(std::string()));
}

std::string GetLocalizedProductLabelForLocale(const std::string& locale) {
  // zh / zh-CN / zh-TW / zh-HK / zh-Hans / zh-Hant 全部显示中文产品名。
  if (base::StartsWith(locale, "zh", base::CompareCase::INSENSITIVE_ASCII)) {
    return "NodeByte \xE6\xB5\x8F\xE8\xA7\x88\xE5\x99\xA8";  // NodeByte 浏览器
  }
  return "NodeByte Browser";
}

std::u16string GetLocalizedProductLabel16() {
  return base::UTF8ToUTF16(GetLocalizedProductLabel());
}

}  // namespace nodebyte
