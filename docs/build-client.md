# 自托管 Runner 搭建与 Chromium 编译指南

> 客户端提示词 10.2 结论：GitHub 官方托管 Runner **完全不够**（磁盘 14GB、内存 7-8GB、Job 6h 上限），
> 完整编译必须自托管。GitHub 只做调度，编译跑在自己机器，不计免费分钟数。

## 1. 构建机要求

| 场景 | 最低配置 |
|---|---|
| PC Release | 16 核 / 32GB 内存 / NVMe SSD / 250GB 空闲 |
| PC + Android | 32 核 / 64GB 内存 / 350GB 空闲 |
| 省钱替代 | 闲置台式机/旧笔记本（Ubuntu 24.04，16GB 内存 + 30GB swap + 250GB 磁盘，不关机挂宽带） |

## 2. 注册 Runner（标签 linux-build-box）

```bash
# Ubuntu 24.04，用户态即可
mkdir ~/actions-runner && cd ~/actions-runner
# 从 GitHub 仓库 Settings → Actions → Runners → New self-hosted runner 获取最新版本链接
curl -o actions-runner-linux-x64-2.321.0.tar.gz -L https://github.com/actions/runner/releases/download/v2.321.0/actions-runner-linux-x64-2.321.0.tar.gz
tar xzf actions-runner-linux-x64-2.321.0.tar.gz
./config.sh --url https://github.com/cshdotcom/chromium-build \
  --token <RUNNER_TOKEN> \
  --labels linux-build-box
# 安装为常驻服务（不关机挂宽带）
sudo ./svc.sh install && sudo ./svc.sh start
```

## 3. 首次编译

```bash
# 克隆本仓库后手动热身（或直接在 GitHub Actions 页面 workflow_dispatch 触发）
git clone https://github.com/cshdotcom/chromium-build.git
cd chromium-build

export CHROMIUM_DIR=$HOME/chromium          # 持久磁盘，勿清理（增量编译依赖）
export CHROMIUM_BASELINE=128.0.6613.0       # 需核实

bash client/scripts/sync_chromium.sh        # 首次 fetch --no-history，几十 GB
bash client/scripts/apply_patches.sh ~/chromium/src
bash client/scripts/build_pc.sh ~/chromium/src
```

首次完整编译约 1.5–3 小时（Android 更久，提示词 10.1.1）。之后修改补丁只做增量编译（分钟级）。

## 4. 触发 CI 编译

- GitHub → Actions → **Build-NodeByte-Browser** → Run workflow → 选择 target（pc / android / both）与 mode（release / dev）
- 打了 `v*` tag 或 push `release/*` 分支且改动 `client/**` 时也会自动触发
- 在注册对应标签 runner 之前，任务会排队等待（不会失败）

## 5. 增量编译纪律（提示词 10.5）

1. 开发期用 `MODE=dev`（组件编译、symbol_level=0、关 ThinLTO）；发布再开优化。
2. 破坏增量缓存必须全量重编的操作：改 gn args、改 .mojom、升级基线、删 out/。
3. `~/chromium`（源码+out）与 `.gclient` 缓存放构建机持久磁盘**勿清理**。

## 6. 基线升级流程

1. `sync_chromium.sh` 切换新 `CHROMIUM_BASELINE`；
2. `apply_patches.sh` 输出冲突文件清单；
3. 逐个修正 0200+ hook 补丁（对照 `client/patches/README.md` 核实清单）；
4. 重新 `gen_patches.sh` 同步 0100-0150（CI 会校验一致性）；
5. 全量重编 + 回归（登录/策略/DROP/同步主链路）。

## 7. 产物

| 产物 | 路径 | 说明 |
|---|---|---|
| PC chrome.exe | `out/Release-pc/` | `package_windows.sh` 收集 → `iscc installer/NodeByteBrowser.iss` 出安装包 |
| Android APK | `out/Release-android/apks/NodeByteBrowser.apk` | arm64 |
