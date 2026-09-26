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

# 2) 官方正式版源码（gclient fetch --no-history；googlesource 大仓库从国内网络
#    易静默挂死 —— 心跳保活 + 断点续传重试，v1.4.5 编译监督修复）
cd "${WORK}"   # fetch 必须在 WORK 根执行：.gclient@WORK，源码树 WORK/src=SRC（旧写法在 SRC 内 fetch 会产生双层 src/src）
heartbeat_start() {
  while kill -0 "$1" 2>/dev/null; do
    sleep 45
    echo "[hb] $(date -u +%H:%M:%S) src.git=$(du -sh "${SRC}/.git" 2>/dev/null | cut -f1) disk=$(df -h "${SRC}" 2>/dev/null | tail -1 | awk '{print $4}')"
  done
}
sync_attempt() {
  # 已有 .gclient → 增量续传；否则首次 fetch
  if [ ! -f "${WORK}/.gclient" ]; then
    fetch --no-history chromium
  else
    gclient sync -D --no-history
  fi
}
# 最多 5 次尝试（gclient sync 断点续传，每次从中断处继续）
fetch_ok=0
for attempt in 1 2 3 4 5; do
  echo "==> gclient fetch/sync 第 ${attempt} 次尝试"
  sync_attempt &
  FETCH_PID=$!
  heartbeat_start "${FETCH_PID}" &
  HB_PID=$!
  if wait "${FETCH_PID}"; then
    kill "${HB_PID}" 2>/dev/null || true
    fetch_ok=1
    echo "==> 源码同步完成（第 ${attempt} 次尝试）"
    break
  fi
  kill "${HB_PID}" 2>/dev/null || true
  echo "warn: 第 ${attempt} 次尝试失败，30s 后重试（断点续传）"
  df -h "${SRC}" | tail -1
  sleep 30
done
[ "${fetch_ok}" = "1" ] || { echo "error: 源码同步 5 次尝试均失败" >&2; df -h "${SRC}" >&2; du -sh "${SRC}/.git" >&2; exit 1; }

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
