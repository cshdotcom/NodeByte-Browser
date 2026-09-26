#!/usr/bin/env bash
# ci_build_all.sh —— CNB api_trigger/web_trigger 手动触发的 Chromium 全量编译（PC 版）。
# 仅在预检通过后执行；流程 = 官方源码 → depot_tools → 打补丁 → 同步 WebUI 资源 → gn → ninja。
# 提示词 10.3 patch 差分构建策略：仓库只存 patch/gn/脚本，不存完整源码。
#
# v1.4.5 编译成功性三保险：
#   1) PATCH_BEST_EFFORT=1：hook 补丁（0230/0240，基于 154 真实基线生成）若因
#      基线漂移失败仅告警跳过，不炸整个编译（新增文件型 01xx 补丁仍硬失败）；
#   2) sync_webui.sh：grd 引用的页面源码必须同步进树，缺失 = 资源打包失败；
#   3) 默认用 args-hosted-pc.gn（关 ThinLTO/is_official_build，适配 16 核云机内存）。
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="${CHROMIUM_WORKDIR:-/work/chromium-cache}"   # 持久缓存盘（源码 + out/）
SRC="${WORK}/src"

mkdir -p "${WORK}"
cd "${WORK}"

# 1) depot_tools（首次 clone，后续增量）
# 154 依赖 CIPD bootstrap：python3_bin_reldir.txt 缺失时 fetch 直接 exit 1
if [ ! -d depot_tools ]; then
  git clone --depth=1 https://chromium.googlesource.com/chromium/tools/depot_tools.git
fi
export PATH="${WORK}/depot_tools:${PATH}"
if [ ! -f depot_tools/python3_bin_reldir.txt ]; then
  echo "==> bootstrap depot_tools ..."
  (cd depot_tools && ./update_depot_tools)
  [ -f depot_tools/python3_bin_reldir.txt ] || {
    echo "warn: python3_bin_reldir.txt 缺失，再试一次 bootstrap" >&2
    (cd depot_tools && ./update_depot_tools) || true
  }
fi

# 2) 官方正式版源码（gclient fetch --no-history，首次全量/后续增量）
if [ ! -f "${SRC}/.gclient" ]; then
  mkdir -p "${SRC}" && cd "${SRC}"
  fetch --no-history chromium
else
  cd "${SRC}" && gclient sync -D
fi

# 3) 打 NodeByte 补丁（01xx 新增文件型：失败即退；02xx hook 型：漂移告警跳过）
export PATCH_BEST_EFFORT="${PATCH_BEST_EFFORT:-1}"
bash "${REPO_ROOT}/client/scripts/apply_patches.sh" "${SRC}"

# 3.5) 同步 WebUI 页面源码进树（grd 引用缺失会导致资源打包失败 —— v1.4.5 修复）
bash "${REPO_ROOT}/client/scripts/sync_webui.sh" "${SRC}"

# 4) gn args + ninja 编译（默认 hosted 参数：关 ThinLTO，云机 16 核内存适配；
#    自托管 32GB+ 机器可 MODE=release ARGS_FILE=client/gn/args-release-pc.gn 覆盖）
if [ -z "${ARGS_FILE:-}" ]; then
  export ARGS_FILE="${REPO_ROOT}/client/gn/args-hosted-pc.gn"
fi
bash "${REPO_ROOT}/client/scripts/build_pc.sh" "${SRC}"

echo "BUILD DONE: 产物见 ${SRC}/out/Release/（package_windows.sh / package_linux.sh 打包）"
