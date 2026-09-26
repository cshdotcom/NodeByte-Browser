// Copyright 2026 The NodeByte Browser Authors. BSD-3-Clause.
//
// nodebyte:// WebUI 统一注册件（v1.4.4 补齐注册缺口）。
// 背景：0150 只创建了 login/drop 控制器文件，settings/translate/game 等
// 页面从未真正注册（feature-checklist 的 WebUI 注册缺口）。
// 本文件为全部 nodebyte:// 主机注册 WebUIConfig + WebUIDataSource：
//   login / drop / settings / translate / game / office / print
// 挂接点：chrome/browser/ui/webui/chrome_web_ui_configs.cc（hook 0240）。

#ifndef CHROME_BROWSER_UI_WEBUI_NODEBYTE_NODEBYTE_UI_CONFIGS_H_
#define CHROME_BROWSER_UI_WEBUI_NODEBYTE_NODEBYTE_UI_CONFIGS_H_

namespace nodebyte {

// 向 content WebUIConfig 表注册全部 nodebyte:// 主机。
// 由 hook 0240 在 RegisterChromeWebUIConfigs() 末尾调用。
void RegisterNodeByteWebUIConfigs();

}  // namespace nodebyte

#endif  // CHROME_BROWSER_UI_WEBUI_NODEBYTE_NODEBYTE_UI_CONFIGS_H_
