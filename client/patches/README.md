# client/patches — 补丁集

> 补丁差分构建策略（提示词 10.3）：**仓库不 fork、不上传 Chromium 源码**；CI 在自托管 Runner 上拉官方源码 → 应用本补丁集 → ninja 编译。

## 生成方式

- `0100`–`0190`：**新增文件型补丁**，由 `scripts/gen_patches.sh` 从 `client/src-nodebyte/` 自动生成（全部新文件，`git apply --3way` 应用稳定，因为目标文件不存在）。
- `0200`+：**hook 型小补丁**（对 Chromium 核心文件的少量修改），手工维护，全部标注基线与「需核实」。

## 补丁清单

| 补丁 | 内容 | 类型 | 基线 | 风险 |
|---|---|---|---|---|
| `0100-nodebyte-core.patch` | 产品常量、nodebyte:// 协议、nodebyte.mojom 五大接口 | 新增文件 | any | 🟢 低 |
| `0110-nodebyte-policy.patch` | CloudOrgPolicyProvider + 全量策略键 | 新增文件 | 128（需核实 Provider 接口） | 🟡 |
| `0120-nodebyte-sync.patch` | 自定义同步客户端 + AES-GCM 加密 | 新增文件 | any | 🟢 |
| `0130-nodebyte-cookie-sessions.patch` | 多 Cookie 会话集（加密 SQLite、隔离注入） | 新增文件 | any | 🟡 |
| `0140-nodebyte-drop.patch` | Drop 侧边栏协调器 + 指纹模板 | 新增文件 | 128 | 🟡 |
| `0150-nodebyte-webui.patch` | nodebyte:// login/drop 控制器 + 统一注册件（v1.4.4 补齐全部主机） | 新增文件 | 128 | 🟡 |
| `0160-nodebyte-extensions.patch` | 扩展手动安装器（crx/zip，含安卓 SAF 管线） | 新增文件 | 128 | 🟡 |
| `0170-nodebyte-import.patch` | CSV/浏览器数据导入器（密码/书签/历史） | 新增文件 | 128 | 🟢 |
| `0180-nodebyte-translate.patch` | 翻译控制器（开源多供应商 API，整页/选区翻译 + DOM 还原） | 新增文件 | 128 | 🟢 |
| `0190-nodebyte-office.patch` | 办公套件控制器 + 打印面板开关 + 独立 grd 资源包（v1.4.4） | 新增文件 | 128 | 🟢 |
| `0250-nodebyte-collab.patch` | 协作会议控制器（REST 代理/WS 建连材料/远程指令白名单执行/设备状态采集）（v1.4.5） | 新增文件 | 2 | 🟢 |
| `0230-hooks-build-wiring.patch` | hook（**154 真实基线**）：chrome/browser/BUILD.gn 接入 nodebyte 核心模块与 WebUI 控制器编译目标（v1.4.5） | Chromium 154.0.8037.57 | 1 | 🟢 |
| `0240-hooks-webui-register.patch` | hook（**154 真实基线**）：RegisterChromeWebUIConfigs 注册挂接 + nodebyte:// 标准 scheme（v1.4.5；Ctrl+P 接管二期） | Chromium 154.0.8037.57 | 2 | 🟢 |

## 应用方式

```bash
# CI（自托管 Runner）或本地（有 chromium src 时）
bash client/scripts/apply_patches.sh ~/chromium/src
```

失败即退出并输出冲突文件（`git apply --3way`）；冲突解决后重跑（`.nodebyte-applied` 清单保证幂等）。

## hook 补丁的基线核实清单（升级 Chromium 版本时逐项核对）

1. `components/policy/core/common/policy_registry.cc` 的注册宏与分发表结构。
2. `chrome/browser/browser_process_impl.cc` 构造顺序与命令行开关注入时机（沙箱仅启动时生效）。
3. `third_party/blink/renderer/core/frame/settings.cc` 的 `javascript_enabled` 通路。
4. `services/network/websocket/websocket_manager.cc` 建连前拦截点签名。
5. `third_party/blink/renderer/core/loader/mixed_content_checker.cc` 的 `ShouldBlockWebSocket`。
6. `components/error_page_strings.grdp` / `net/error_page` 资源组织方式。
