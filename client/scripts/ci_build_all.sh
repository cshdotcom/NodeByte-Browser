#!/usr/bin/env bash
# ci_build_all.sh —— CNB web_trigger 手动触发的 Chromium 全量编译（PC 版）。
# 仅在预检通过后执行；流程 = 官方源码 → depot_tools → 打补丁 → gn → ninja。
# 提示词 10.3 patch 差分构建策略：仓库只存 patch/gn/脚本，不存完整源码。
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="${CHROMIUM_WORKDIR:-/work/chromium-cache}"   # 持久缓存盘（源码 + out/）
SRC="${WORK}/src"

mkdir -p "${WORK}"
cd "${WORK}"

# 1) depot_tools（首次 clone，后续增量）
if [ ! -d depot_tools ]; then
  git clone --depth=1 https://chromium.googlesource.com/chromium/tools/depot_tools.git
fi
export PATH="${WORK}/depot_tools:${PATH}"
depot_tools_bootstrap() { pushd depot_tools >/dev/null && ./update_depot_tools && popd >/dev/null; }
depot_tools_bootstrap

# 2) 官方正式版源码（gclient fetch --no-history，首次全量/后续增量）
if [ ! -f "${SRC}/.gclient" ]; then
  mkdir -p "${SRC}" && cd "${SRC}"
  fetch --no-history chromium
else
  cd "${SRC}" && gclient sync -D
fi

# 3) 打 NodeByte 补丁（新增文件型补丁干净应用；hook 补丁 --3way + 失败即退）
bash "${REPO_ROOT}/client/scripts/apply_patches.sh" "${SRC}"

# 4) gn args（PC release）+ ninja 编译
bash "${REPO_ROOT}/client/scripts/build_pc.sh" "${SRC}"

echo "BUILD DONE: 产物见 ${SRC}/out/Release/（package_windows.sh / package_linux.sh 打包）"
