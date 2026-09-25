// Copyright 2025 The NodeByte Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
//
// nodebyte_branding.h —— 产品显示名本地化（需求：编译后的软件自动识别当前安装
// 设备语言，中文环境显示「NodeByte 浏览器」，其余显示「NodeByte Browser」）。
//
// 用法：UI 各处展示产品名时调用 nodebyte::GetLocalizedProductLabel()，
// 替代硬编码字符串（低侵入：不改动 Chromium 现有 branding 体系，
// 由调用点逐个切换，未切换处退化为英文品牌名，行为可预期）。

#ifndef CHROME_BROWSER_NODEBYTE_NODEBYTE_BRANDING_H_
#define CHROME_BROWSER_NODEBYTE_NODEBYTE_BRANDING_H_

#include <string>

namespace nodebyte {

// 按当前应用 locale 返回本地化产品名（zh* → 中文，其余 → 英文）。
std::string GetLocalizedProductLabel();

// 指定 locale 的纯函数版本（便于单测与设置页预览）。
// locale 形如 "zh-CN" / "zh-TW" / "en-US" / "ja"。
std::string GetLocalizedProductLabelForLocale(const std::string& locale);

// u16 便捷版（Views/界面字符串常用）。
std::u16string GetLocalizedProductLabel16();

}  // namespace nodebyte

#endif  // CHROME_BROWSER_NODEBYTE_NODEBYTE_BRANDING_H_
