# NodeByte Browser 客户端

Chromium 二次开发浏览器：**补丁式构建**（不 fork 不上传源码）。本目录包含全部自研源码、补丁集、GN 参数、构建脚本与 Windows 安装程序。

## 编译总览

```
自托管 Runner（标签 linux-build-box）
   │
   ├─ scripts/sync_chromium.sh          # depot_tools + gclient sync（官方源码，几十 GB）
   ├─ scripts/apply_patches.sh src/     # 应用 patches/*.patch（--3way，失败即停并输出冲突）
   ├─ scripts/build_pc.sh src/          # gn gen + autoninja → chrome / chrome.exe
   ├─ scripts/build_android.sh src/     # target_os=android arm64 → NodeByteBrowser.apk
   └─ scripts/package_windows.sh src/   # 收集产物 → installer/NodeByteBrowser.iss (iscc)
```

GitHub 托管 Runner **无法**承载完整 Chromium 编译（磁盘 14GB / 内存 7-8GB，见提示词 10.2.1）；
托管 Runner 负责服务端 CI 与客户端脚本/补丁校验（`.github/workflows/client-validate.yml`），
完整编译由 `build-nodebyte-browser.yml` 在自托管 Runner 执行（文档见 `../docs/build-client.md`）。

## 目录

```
client/
├── src-nodebyte/      # 自研业务源码（低侵入，全新增文件，C++/Mojo）
├── webui/             # nodebyte:// 页面（login/drop/settings/离线小游戏）
├── patches/           # 0100-0150 自动生成 + 0200+ 手工 hook（标注基线）
├── gn/                # args-dev / args-release-pc / args-release-android
├── scripts/           # gen_patches / apply_patches / sync / build / package
└── installer/         # Inno Setup（双路径+注册表+卸载保数据）
```

## 产品规格速览

- 产品名 **NodeByte Browser**；协议 `nodebyte://`；默认同步服务器 `bsync.nodebyte.cn`；默认搜索引擎必应
- 品牌仅「关于」页保留 Chromium 署名，其余全部 NodeByte（branding 由补丁 0100 + 资源 grd 承担）
- 平台差异（提示词第九章）：Windows 能力最全；Android 无桌面截图/悬浮窗/外部导入，办公仅预览

## 版本策略

- 基线版本经环境变量 `CHROMIUM_BASELINE` 控制（默认 128.0.6613.0，**需核实**与补丁兼容性）
- 升级基线流程：sync 新基线 → apply_patches 冲突清单 → 逐个修正 0200+ hook → 全量重编
- 改 gn args / 改 mojom / 删 out/ 会破坏增量缓存（提示词 10.5.4），发布前评估
