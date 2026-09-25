# NodeByte 数据导入体系（CSV / 浏览器导入 / 账号下发）

> v1.3.0 新增。覆盖：管理端批量导入 CSV、个人中心/前台自助导入、浏览器设置内 CSV 导入、
> 常见电脑端浏览器数据导入、同步数据类型开关勾选。

## 一、总体架构（三通道）

```
┌────────────────────────────────────────────────────────────────┐
│ 通道 A：本机直接导入（浏览器内）                                  │
│   nodebyte://settings → 数据导入                                │
│   CSV 解析 → 写入本机加密存储（PasswordStore/BookmarkModel/History）│
│   → 按同步项勾选状态增量上传（端到端 AES-GCM 加密）                 │
├────────────────────────────────────────────────────────────────┤
│ 通道 B：账号「待下发导入区」（服务端）                             │
│   管理端 /admin 导入中心（批量选用户）  POST /api/admin/import*    │
│   个人中心 /u 数据导入（导入到自己账号）  POST /api/personal/import │
│        ↓ 落库（密码列服务端静态加密 AES-256-GCM）                  │
│   客户端 GET /api/sync/imported → 转本机端到端加密 → POST ack      │
│        ↓ 服务端副本删除（零明文驻留收敛）                          │
├────────────────────────────────────────────────────────────────┤
│ 通道 C：从其他浏览器一键导入（仅 Windows，复用 Chromium 原生 importer）│
│   Chrome / Edge / Firefox / Brave / Opera / Vivaldi / 360 / QQ   │
│   可导入：书签、保存的密码、历史记录（Android 不支持，沙盒限制）      │
└────────────────────────────────────────────────────────────────┘
```

## 二、CSV 格式与列识别

表头列名自动识别（中英文别名同源实现：`server/src/lib/csv.ts` 与
`chrome/browser/nodebyte/import/data_importer.cc`），RFC-4180 解析
（引号转义、字段内逗号/换行、BOM、CRLF/LF）。

### 2.1 密码（passwords）

| 字段 | 识别的列名（大小写/空白不敏感） |
|---|---|
| url | `url` `login_uri` `uri` `website` `address` `server` `网址` `url地址` |
| username | `username` `login_username` `user` `account` `login` `用户名` `账号` |
| password | `password` `login_password` `pwd` `密码` `口令` |
| name（可选） | `name` `title` `hostname` `名称` `标题` `备注` |

兼容导出格式：**Chrome / Edge**（name,url,username,password）、**Firefox**
（url,username,password,httpRealm,...）、**Bitwarden**（login_uri,login_username,login_password）。

### 2.2 书签（bookmarks）

| 字段 | 识别的列名 |
|---|---|
| title | `title` `name` `标题` `名称` |
| url | `url` `link` `网址` `链接` |
| folder（可选） | `folder` `path` `category` `文件夹` `目录` `分类`（支持 `/` 分层） |
| date_added（可选） | `date_added` `date` `created` `添加时间`（数字=WebKit 微秒/Unix 秒，或任意可解析日期） |

### 2.3 历史记录（history）

| 字段 | 识别的列名 |
|---|---|
| url | `url` `link` `网址` `链接` |
| title（可选） | `title` `name` `标题` |
| last_visit_time（可选） | `last_visit_time` `visit_time` `time` `访问时间` |
| visit_count（可选） | `visit_count` `count` `visits` `次数`（默认 1） |

限制：单文件 ≤ 20MB、≤ 10 万行（超出截断并告警）；空行跳过；URL 无法识别的行保留原文并生成告警。

## 三、管理端批量导入（/admin → 导入中心）

三步流程，全部落审计（`import_data_to_users`）：

1. **上传解析**：选类型（密码/书签/历史）+ CSV 文件 → 服务端解析返回
   列映射、有效行数、告警列表、前 10 条预览（密码列脱敏显示）。
2. **批量选用户**：
   - 用户列表搜索（用户名/邮箱）+ 分页，勾选一个或多个，翻页累计保留勾选；
   - 或勾选「全部用户」（导入到全部 active 账号）；
   - 支持按用户组批量（targets: `{"groupIds":[...]}`，API 直调时可用）。
3. **执行**：选合并模式（追加）/ 覆盖模式（清空该类型待下发区后写入）→
   二次确认弹窗（提示词约束 6：批量操作必须二次确认）→ 执行 → 报告
   （N 个用户 × M 条）。

API：

```
POST /api/admin/import          multipart{ file, type }          → 预览（不落库）
POST /api/admin/import/apply    multipart{ file, type, mode, targets }
      targets = {"userIds":["uuid",...]} | {"groupIds":["uuid",...]} | {"allUsers":true}
      mode    = merge | replace
```

## 四、个人中心 / 前台自助导入（导入到自己账号）

入口：网页个人中心 `/u` → 数据导入标签页；前台登录后同样可达。
用户只能导入到**自己**的账号（`source=self_csv`，服务端强制 target=self，
不信任前端传参）；导入数据计入个人云配额（估算 每行 256 字节）。

```
POST /api/personal/import   multipart{ file, type, mode? }   → 导入到自己账号
GET  /api/personal/import                                    → 待下发概览
```

## 五、浏览器设置内导入（通道 A）

`nodebyte://settings` → 数据导入：

- **CSV 导入**：选择类型 + 文件 → 本机解析（`DataImporter`）→ 直接写入本机
  加密存储（密码进 PasswordStore、书签保持文件夹层级、历史去重合并）→
  按同步项勾选状态增量上传（端到端加密）。
- **浏览器导入**（仅 Windows）：Chrome / Edge / Firefox / Brave / Opera /
  Vivaldi / 360 安全浏览器 / QQ 浏览器，可导入书签、保存的密码、历史记录；
  入口在首次启动引导页 + 设置页（提示词 5.13）。Android 无此能力（沙盒限制），
  但支持 CSV 导入与通道 B 账号下发。

## 六、同步数据类型开关（勾选）

设置页同步项勾选（保存到本地偏好并随同步上报）：

书签 / 密码凭证 / 浏览历史 / 基础配置与偏好 / Cookie 会话集 / 扩展插件(crx) /
指纹配置 / 代理与加速器配置 / 稍后再看。

- 策略 `CustomSyncDisabledTypes` 数组中的类型：勾选项强制置灰不可选（内核层拒传）；
- 策略 `CustomAllowSync=false`：整个同步入口置灰；
- **服务端同样校验**（sync API 对禁用类型返回 40303），不能只靠客户端。

## 七、密码安全边界（明示）

1. 通道 A：密码从未离开本机明文域；同步上传前客户端 AES-GCM 加密，服务端只存密文。
2. 通道 B（服务端批量导入 / 自助导入）：CSV 内密码明文**仅在导入瞬间经过服务端**，
   落库即 AES-256-GCM 静态加密（密钥来自服务端 JWT_SECRET 派生，见 crypto.ts）；
   下发给账号本人（TLS + JWT + 2FA 绑定态强校验）；客户端确认合并后
   `POST /api/sync/imported {action:'ack'}` **删除服务端副本**——
   最终收敛为「服务端零明文、零副本」。
3. 管理员不可见明文（后台只显示「N 条密文记录」）；审计日志只记批次与行数，
   不含任何密码内容。
4. 通道 C：浏览器导入复用 Chromium 原生 importer，密码直接写入本机 PasswordStore。

## 八、状态码约定（与全局一致）

| 状态码 | 场景 |
|---|---|
| 401 | 未登录 → 弹窗跳转登录 |
| 40301 | 需绑定 2FA（导入接口同样受 2FA 绑定态校验） |
| 40303 | 导入类型被策略禁止 / 同步类型被 CustomSyncDisabledTypes 禁止 |
| 41301 | 存储配额超限（通道 B 计入配额） |
| 400 | CSV 为空 / 列无法识别 / 无有效行 / 文件过大 |
