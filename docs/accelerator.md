# NodeByte 加速器与第三方代理协议支持

> v1.3.0 明确支持矩阵。对应客户端提示词 5.7（代理与 VLESS）、附录A（ProxyMode /
> ProxyServer / ProxyBypassList / CustomProxyVlessConfig）与用户组开关 allow_vless_proxy。

## 一、协议支持矩阵

| 协议 | 支持 | 实现方式 | 节点链接 | 策略键 |
|---|---|---|---|---|
| HTTP | ✅ | Chromium 原生 `net/proxy_resolution` 栈 | — | ProxyMode/ProxyServer |
| HTTPS | ✅ | 原生代理栈 | — | ProxyMode/ProxyServer |
| SOCKS4 | ✅ | 原生代理栈 | — | ProxyMode/ProxyServer |
| SOCKS5 | ✅ | 原生代理栈（含远程 DNS） | — | ProxyMode/ProxyServer |
| VMess | ✅ | 本地 Xray-core（方案 B） | `vmess://` | CustomProxyVlessConfig |
| VLESS | ✅ | 本地 Xray-core（方案 B） | `vless://` | CustomProxyVlessConfig |
| Trojan | ✅ | 本地 Xray-core（方案 B） | `trojan://` | CustomProxyVlessConfig |
| Shadowsocks | ✅ | 本地 Xray-core（方案 B） | `ss://` | CustomProxyVlessConfig |
| 订阅链接 | ✅ | 客户端定期拉取订阅 → 解析节点列表 | `http(s)://...sub` | — |

- **原生协议**（HTTP/HTTPS/SOCKS4/SOCKS5）：设置页直接添加，走 Chromium
  原生代理栈；Windows/Android 均可。
- **第三方协议**（VMess/VLESS/Trojan/SS）：采用客户端提示词 5.7.2 **方案 B**
  —— 浏览器代理保留原生 SOCKS5，内核拉起本地 Xray 二进制并解析完整节点
  配置（inbound 127.0.0.1:port socks5 → outbound 协议出站）；UI 提供
  节点表单与链接/订阅导入。方案 A（v2ray/xray 编译进网络进程）列为二期
  （Android 编译复杂度高，见提示词 5.7.2 优劣分析）。
- **订阅**：支持 V2Ray/Clash 订阅 URL，自动拉取解析为节点列表，可一键切换。

## 二、平台差异

| 能力 | Windows | Android |
|---|---|---|
| 原生 HTTP(S)/SOCKS 代理 | ✅ | ✅ |
| VMess/VLESS/Trojan/SS（Xray 方案 B） | ✅（本地拉起 Xray 二进制） | ✅（Xray 以应用内组件运行，不依赖外部可执行权限） |
| 订阅链接 | ✅ | ✅ |
| 系统级 TUN/全局加速 | ❌（浏览器进程域内） | ❌ |

## 三、策略控制

| 策略键 | 语义 | 撤销语义 |
|---|---|---|
| `NodeByteAcceleratorEnabled` | 加速器总开关（switch） | 撤销 → 恢复默认（开启） |
| `NodeByteAcceleratorProtocols` | 允许的第三方协议列表（json 数组，如 ["vless","vmess"]） | 撤销 → 清空（全部协议可用） |
| `NodeByteAllowCustomProxy` | 允许用户自定义/新增节点（switch） | 撤销 → 恢复默认（允许） |
| `ProxyMode` / `ProxyServer` / `ProxyBypassList` | 原生键；mandatory 下发时 UI 全灰 | text 类 → 撤销清空 |
| `CustomProxyVlessConfig` | 第三方协议完整节点配置（json，sensitiveFields 建议标记 → UI 隐藏明文） | json → 撤销清空 |
| `allow_vless_proxy`（用户组黑白名单） | 是否开放第三方协议功能 | 功能黑白名单随组策略移除自动恢复 |

策略下发由 `/api/client/policy` 承载（directives 指令最高优先级），
撤销机制见 docs/policy-dictionary.md 第五章。

## 四、设置页 UI（nodebyte://settings → 加速器）

- 模式：跟随系统 / 直连 / 手动加速节点（mandatory ProxyMode 时全灰）；
- 协议选择：HTTP / HTTPS / SOCKS4 / SOCKS5 / VMess / VLESS / Trojan /
  Shadowsocks（`NodeByteAcceleratorProtocols` 限制可选范围；
  `allow_vless_proxy=false` 隐藏第三方协议项）；
- 节点编辑：地址、端口、UUID/密码、传输层（tcp/ws/grpc）、TLS/Reality、
  SNI；支持粘贴 `vless://` `trojan://` `ss://` `vmess://` 链接一键导入；
- 订阅：订阅 URL 管理、手动/自动更新、节点测速（延迟）；
- 敏感字段：`CustomProxyVlessConfig` 在 sensitiveFields 中时 UI 隐藏明文
  显示「此配置由组织管理员管控，不可查看和修改」（nodebyte://policy 与
  开发者工具仍可读取内存值，向用户明示 —— 提示词 5.3.3）；
- 设备状态上报：WebSocket `device_status` 携带当前代理信息
  `{ mode, server, protocol }`（服务端 7.4 契约）。

## 五、错误上报

第三方协议连接失败按扩展下载源同类通道上报后端（时间戳、用户 ID、用户组 ID、
节点 ID、协议、错误详情、设备 ID），后台审计可筛选查看。
