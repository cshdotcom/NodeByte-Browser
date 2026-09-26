# NodeByte 独立资源包（grd）树内文件映射

构建前把本仓库 `client/webui/` 的页面源码复制进 Chromium 树
`chrome/browser/resources/nodebyte/`（grd 引用相对路径）。
复制脚本：`bash scripts/sync_webui.sh /path/to/chromium/src`（构建机执行）。

| 树内文件 | 仓库来源 | 用途 |
|---|---|---|
| `login/{index.html,app.js,style.css,i18n.js}` | `client/webui/login/` | nodebyte://login（5.1） |
| `drop/{index.html,app.js,style.css,i18n.js}` | `client/webui/drop/` | nodebyte://drop（5.4/5.5） |
| `settings/index.html` | `client/webui/settings/` | nodebyte://settings（5.3/5.14） |
| `translate/{index.html,app.js}` | `client/webui/translate/` | nodebyte://translate |
| `offline-game/{index.html,game.js}` | `client/webui/offline-game/` | nodebyte://game + 断网错误页（5.12） |
| `usercenter/index.html` | `client/webui/usercenter/` | nodebyte://usercenter 跳转占位 |
| `office/{index.html,app.js}` | `client/webui/office/` | nodebyte://office（5.11.1，v1.4.4） |
| `print/{index.html,app.js,pdf-kit.js}` | `client/webui/print/` | nodebyte://print（5.11.2/3，v1.4.4） |
| `nodebyte_resources.grd` / `BUILD.gn` | 本目录直接维护 | grit 定义与目标 |

注意：
- `IDR_NODEBYTE_*` 常量由 grit 生成到 `grit/nodebyte_resources.h`，
  控制器（chrome/browser/ui/webui/nodebyte/）include 该生成头。
- translate/app.js 若尚未存在则以 index.html 内联脚本为准（grd 仅登记存在的文件）。
- usercenter/index.html 为占位跳转页（在线个人中心，v1.4.x 交付语义）。
