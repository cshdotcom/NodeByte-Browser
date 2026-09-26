# 办公套件与高级打印（v1.4.4）

> 对应客户端提示词 **5.11 内置办公套件与打印**。v1.4.3 复核时本节为最大缺口
> （写作功能 / Office 嵌入 / 打印三项均未落地），v1.4.4 端到端补齐。

## 1. 架构总览

```
nodebyte://office（办公套件 WebUI）          nodebyte://print（高级打印面板 WebUI）
  MD/TXT 完整编辑（本地）                      载入临时 PDF
  DOCX/PPTX 解析预览 + PPT 放映（本地）        页码范围 / 缩放 / 边距 / 多页合一 / 小册子
  PDF 内核查看器（PDFium 原生）                pdf-kit 页面级二次处理（本地，纯 JS）
        │ 读取 office-config（可塑性）               │
        ▼                                           ▼
  NodeByte 服务端 GET /api/client/office-config ── 后台「办公与打印」配置
        │
        └─ wasmUrl（可选）：LibreOffice WASM 完整编辑引擎，按需加载
```

- **隐私铁律**：文档内容与 PDF 全程本地处理，不上传服务端；服务端只下发配置。
- **可塑性铁律**：客户端经 `{syncServer}/api/client/office-config` 读配置，
  同步服务器变更自动跟随（见 upstream-services.md 的同一机制）。
- **资源隔离铁律**：办公/打印/全部 nodebyte:// 页面静态资源进独立 grd
  （`chrome/browser/resources/nodebyte/`），内核升级冲突面最小。

## 2. 办公套件 nodebyte://office（提示词 5.11.1）

| 格式 | 桌面端（Windows） | 安卓端 |
|---|---|---|
| MD | **完整编辑**：标题/粗斜体/删除线/列表/引用/行内代码/表格/链接/图片插入（base64 内嵌）/字号/颜色，分屏实时预览，导出 .md / .html | 仅预览（策略可放开） |
| TXT | 完整编辑 + **编码自动识别**（UTF-8/UTF-16/GB18030/Big5/Shift_JIS/Windows-1252 启发式打分） | 仅预览 |
| DOCX | 解析预览（段落/标题样式/粗斜下划线/颜色字号/列表/表格/图片 rels 映射）+ 轻编辑（contenteditable），导出 .html | 仅预览 |
| PPTX | 解析预览（EMU→百分比定位文本框/图片）+ **放映**：全屏、翻页（按钮/键盘）、**演讲者视图**（备注） | 仅预览 |
| PDF | Chromium 内核 PDFium 原生查看（查看/旋转/另存） | 同左 |

- **零第三方依赖**：OOXML 解压用 `DecompressionStream('deflate-raw')`（Chromium 103+），
  DOCX/PPTX 一律 DOM 构建渲染（不 innerHTML 装载不可信 XML，XSS 面收敛为零）。
- **LibreOffice WASM 按需加载**（提示词「体积大，可内置按需加载」）：
  后台配置 `wasmUrl` → 办公页出现「WASM」按钮 → 动态加载引擎脚本，
  约定引擎暴露 `window.NodeByteWasmOffice.mount(viewEl, bytes)` 完整编辑接口；
  未配置时内置轻量渲染照常工作。完整 DOCX/PPTX 原格式回写属该引擎范围。
- **平台门控**：C++ 注入 `window.__NODEBYTE__`（platform/canEdit/officeSuite/syncServer）；
  安卓默认隐藏编辑工具栏（提示词平台差异表），策略 `NodeByteOfficeAndroidEdit` 放开。
- 打开入口：页面「打开文件/拖拽」；外部文件关联（Windows shell / Android intent）由
  `OfficeController::CanOpenExtension()` 白名单（.md/.txt/.docx/.pptx/.pdf）。

## 3. 高级打印 nodebyte://print（提示词 5.11.2 / 5.11.3）

**流程（与提示词安卓流程一致：前置面板 → 临时 PDF → 二次处理 → 系统打印）**：

1. **取临时 PDF**：桌面 Ctrl+P → 目的地「另存为 PDF」；安卓系统打印 →「另存为 PDF」；
   或办公套件导出 PDF。
2. **前置面板排版**：页码范围（`1-5,8,11-13`）、缩放 25–400%、边距（mm，四边统一）、
   **多页合一**（1/2/4/6/9/16，网格缩放摆放）、**小册子**（骑马钉排序 [8,1][2,7][6,3][4,5]，
   双槽对页输出，双面打印沿短边翻页 → 对折装订）。
3. **pdf-kit 本地二次处理** → 新 PDF 下载 → 交给系统打印框架输出。

### pdf-kit（零依赖 PDF 页面级处理引擎）

- 原理：源页内容流**原样字节搬运**为 Form XObject（不重编码、不解压压缩流），
  新输出页用 `cm` 变换链（归一化 → /Rotate 旋转矩阵 → 缩放 → 摆放）排版；
  原文档对象原样携带（对象号不变，字体/图片引用天然有效），重建经典 xref。
- 支持：经典 xref 与 **ObjStm 压缩对象流**自动展开；`/Length` 直接值精确定界 +
  endstream 回退扫描（防二进制内嵌字样截断）。
- 变换数学：`fit = min(可用宽/可视宽, 可用高/可视高) × scale`，槽内居中；
  /Rotate 90/180/270 显式顺时针矩阵（含补偿平移），BBox 保持原始坐标。
- 已知边界（v1.4.4 如实标注）：加密 PDF 不支持（明确报错）；注释/表单域在重排时丢弃；
  罕见「二进制噪声伪造对象头」文件可能解析偏移（首见优先策略）。

### 打印入口（v1.4.5 状态）

- **入口**：地址栏直达 `nodebyte://print`（WebUI 注册，154 真实基线 hook 0240）。
- **Ctrl+P 接管**（`browser_commands.cc` Print() 重定向 + `NodeBytePrintPanelEnabled`
  策略门控）：**二期** —— 该 hook 依赖 `nodebyte::PrintPanelEnabled(profile)` 桥接函数
  的内核挂点，v1.4.5 诚实降级不接线（详见 feature-checklist 5.11.2）。
- 提示词要求的「Windows 完整替换原生弹窗」分两阶段：本版为入口接管 + 面板增强；
  原生弹窗深度替换（print_preview UI 层）标注为二期（需编译期核实，
  与提示词「二期工程量大」的诚实标注一致）。

## 4. 服务端接口与后台

| 接口 | 方法 | 说明 |
|---|---|---|
| `/api/client/office-config` | GET | 客户端配置（**无需登录**：办公页支持未登录本地打开；无敏感字段） |
| `/api/admin/office-config` | GET/PUT | 后台配置（authAdmin + 审计 `modify_system_setting`） |

配置项（存 `system_setting.office_config`）：

| 字段 | 默认 | 说明 | 对应策略键 |
|---|---|---|---|
| `enabled` | true | 办公套件总开关（关闭后客户端隐藏入口，且不再下发细节） | `NodeByteOfficeSuiteEnabled` |
| `editOnAndroid` | false | 安卓端编辑放开 | `NodeByteOfficeAndroidEdit` |
| `printPanelEnabled` | true | 打印面板接管打印入口 | `NodeBytePrintPanelEnabled` |
| `wasmUrl` | '' | LibreOffice WASM 引擎资源地址（http/https；空 = 不启用按需加载） | — |
| `maxUploadMb` | 20 | 预留服务端辅助转换上限（当前本地处理不经过服务端） | — |

后台「上游服务」面板新增**办公与打印**卡片：三个开关（套件/安卓编辑/打印面板）+
WASM 地址 + 上限 + 保存。策略三键已入指令注册表（下发/撤销通道），
`summarizeForWeb` 同步暴露 `officeSuite/officeAndroidEdit/printPanel`。

## 5. 客户端补丁与注册（v1.4.4 同步补齐注册缺口）

| 补丁 | 内容 |
|---|---|
| `0190-nodebyte-office.patch` | `office_controller.{h,cc}`（平台门控/策略/CanOpenExtension）、`print_panel.{h,cc}`（PrintPanelEnabled）、`resources/nodebyte/{nodebyte_resources.grd,BUILD.gn}`（独立 grd 全页资源） |
| `0150-nodebyte-webui.patch`（再生） | 新增 `nodebyte_office_ui.{h,cc}`、`nodebyte_print_ui.{h,cc}`、**`nodebyte_ui_configs.{h,cc}`（统一注册件）** |
| `0240-hooks-webui-register.patch` | hook（154 真实基线生成，v1.4.5）：chrome_web_ui_configs.cc 注册挂接 + nodebyte:// 标准 scheme 接入；Print() 重定向列为二期（policy_bridge 依赖未接线） |

**注册缺口修复（重要）**：v1.4.3 复核发现 nodebyte:// 页面从未真正注册——
0150 只有控制器类，`IDR_NODEBYTE_*` 引用的 grd 目标不存在（0230 引用了
`//chrome/browser/resources/nodebyte:nodebyte_resources` 但该目标从未被创建）。
v1.4.4 的 `nodebyte_ui_configs.{h,cc}` 为 **login/drop/settings/translate/game/
usercenter/office/print 八主机**统一注册 WebUIConfig + WebUIDataSource，
并补齐 login/drop 的 `i18n.js`、translate 的 `app.js`、usercenter 占位页。

## 6. 自测与 CI

- `server/scripts/office-print-selftest.mjs`：46 项零依赖自测
  （office.ts 校验 / 路由 / 策略三键 / 指令注册 / WebUI 资产 / 补丁一致性 /
  **pdf-kit 行为级**：范围·多页合一·小册子·边距缩放·Flate 搬运·往返稳定）。
- 接入 `.cnb.yml` lite-validate 与 GitHub `server-ci.yml`（不消耗 CNB 核时）。
- 本地预检：tsc 0 错 / standalone 构建通过 / 11 个新增文件型补丁干跑全过。

## 7. CNB 编译保护

本轮全部客户端改动走补丁（干跑验证），**不触发 `web_trigger`，不消耗 CNB 编译额度**；
服务端与自测随 push 的 lite-validate 自动通过。编译核实项（hook 0240 三处签名、
WebUIConfig API 形态）已按项目惯例标注【需核实】，并全部带策略门控与原生回退，
编译失败风险收敛在单一 hook，且指令通道可运行时回退。
