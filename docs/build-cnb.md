# CNB（cnb.cool）构建指南

> NodeByte 采用 **GitHub + CNB 双平台**：代码同仓双推，CNB 负责云端校验/构建，
> GitHub Actions 负责服务端镜像发布与客户端长编译调度。

## 一、双平台布局

| 平台 | 仓库 | 用途 |
|---|---|---|
| GitHub | `cshdotcom/NodeByte-Browser` | 主仓；Release（源码+changelog）；docker-image.yml 发布 ghcr.io 多架构镜像；build-nodebyte-browser.yml 三平台客户端编译 |
| CNB | `cnb.cool/<owner>/NodeByte-Browser` | 镜像同步仓；`.cnb.yml` 云原生校验/构建；web_trigger 手动重编译 |

> **CNB 首次建仓说明**（实测，2026-09）：CNB 新账号存在以下限制——
> ① 个人空间无 OpenAPI 建仓端点；② 根组织年度创建额度受限（新账号 "root
> organization has reached its yearly creation limit"）；③ push 不支持自动建仓。
> 因此**首次需在网页端创建一次空仓库**（不要初始化 README）：
> `https://cnb.cool` → 新建仓库 → `NodeByte-Browser`，
> 之后用 `scripts/push-cnb.sh` 一键推送（脚本会尝试 API 建仓/配置 remote/推送）。

推送命令（本地仓库已配置双 remote 时）：

```bash
git remote add github https://github.com/cshdotcom/NodeByte-Browser.git
git remote add cnb    https://cnb:<CNB_TOKEN>@cnb.cool/<owner>/NodeByte-Browser.git
git push github main --tags && git push cnb main --tags
# 或一键： CNB_TOKEN=xxx bash scripts/push-cnb.sh
```

## 二、CNB 流水线设计（不浪费核时）

`.cnb.yml` 两条流水线：

### 1）`main.push` → nodebyte-lite-validate（默认自动，分钟级）

| 步骤 | 内容 | 失败可能 |
|---|---|---|
| 环境自检 | node/git/bash 版本 | 无 |
| Shell 语法检查 | 全部构建脚本 `bash -n` | 无（已本地验证） |
| 补丁干跑校验 | 8 个新增文件补丁 `git apply --check` | 无（已本地验证） |
| 服务端 tsc + standalone 构建 | `npm ci` → `tsc --noEmit` → `next build` | 依赖/类型错误（已本地验证） |
| CSV 自测 | `node server/scripts/csv-selftest.mjs` | 无 |

确定性通过，单次消耗约 2-4 分钟 —— 保证 **push 不烧多余核时**。

### 2）`web_trigger` → nodebyte-chromium-build（手动触发，小时级）

Chromium 全量编译（官方源码 → depot_tools → 补丁 → gn → ninja），
**不在 push 自动执行**；触发前 `ci_precheck.sh` 硬件预检：

- CPU ≥ 16 核、内存 ≥ 32GB、空闲磁盘 ≥ 250GB，任一不满足**立即失败退出**，
  不进入长编译 —— 这是「确保编译成功、不烧核时」的关键闸门；
- 预检通过后走 `ci_build_all.sh`（源码缓存持久盘 `CHROMIUM_WORKDIR`，增量编译）。

CNB 免费核时有限，Chromium 编译建议优先自托管构建机（提示词 10.2：
闲置电脑挂 `linux-build-box` Runner，零云费仅电费），CNB 只跑轻量校验与镜像构建。

## 三、CNB 上手动触发 Chromium 编译

1. CNB 网页 → 仓库 → 构建 → 选择 `nodebyte-chromium-build` → 运行；
2. **编程触发（v1.4.5）**：`POST https://api.cnb.cool/{repo}/-/build/start`
   （Bearer token，body `{"event":"api_trigger"}`）→ 返回 sn →
   `GET /-/build/status/{sn}` 轮询；
2. 观察 precheck 输出，规格不足先扩容或改自托管；
3. 产物（chrome / chrome.exe / NodeByteBrowser.apk）在 stages 产物区下载，
   后续接入 `package_windows.sh` / `package_linux.sh` 打包安装器。

## 四、与 GitHub Actions 的分工

| 场景 | 平台 | 工作流/流水线 |
|---|---|---|
| 每次推送的回归校验 | CNB | lite-validate（本文件） |
| 服务端 Docker 镜像发布 | GitHub | docker-image.yml → ghcr.io 多架构 |
| 客户端三平台编译 | GitHub | build-nodebyte-browser.yml（自托管 Runner 调度） |
| 补丁回归（干跑） | 双平台 | CNB lite-validate + GitHub client-validate.yml |
| Release（源码+changelog） | GitHub | scripts/release.sh（每 tag 必发） |
