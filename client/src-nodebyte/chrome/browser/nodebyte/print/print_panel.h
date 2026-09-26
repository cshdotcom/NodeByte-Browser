// Copyright 2026 The NodeByte Browser Authors. BSD-3-Clause.
//
// 高级打印面板入口开关（提示词 5.11.2/5.11.3；hook 0240 的 Print() 重定向读取）。
//   1) 指令强制值 prefs "nodebyte.directive.forced.NodeBytePrintPanelEnabled"
//   2) 编译默认 true（面板为主；关闭/撤销即回退原生打印预览，运行时可切换）

#ifndef CHROME_BROWSER_NODEBYTE_PRINT_PRINT_PANEL_H_
#define CHROME_BROWSER_NODEBYTE_PRINT_PRINT_PANEL_H_

class Profile;

namespace nodebyte {

// NodeBytePrintPanelEnabled：true → 打印入口打开 nodebyte://print 面板；
// false → 原生打印预览（策略/指令通道可运行时切换，无需重编译）。
bool PrintPanelEnabled(Profile* profile);

}  // namespace nodebyte

#endif  // CHROME_BROWSER_NODEBYTE_PRINT_PRINT_PANEL_H_
