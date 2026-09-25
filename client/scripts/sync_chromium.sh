#!/usr/bin/env bash
# sync_chromium.sh —— 拉取 Chromium 官方正式版源码（GitHub 托管 Runner / 自托管通用）
#
# 流程（提示词 10.1/10.5）：
#   1. depot_tools（官方工具链）
#   2. Linux 构建依赖（托管 Runner 无 root，走 sudo；自托管 root 直跑）
#   3. fetch --no-history chromium（官方源，无历史省 ~50% 磁盘）
#   4. 切换基线到官方 stable 版本 tag（默认动态取 Google versionhistory API 最新 stable）
#   5. gclient sync -D + runhooks
#
# 环境变量：
#   CHROMIUM_DIR       源码根目录（默认 $HOME/chromium）
#   CHROMIUM_BASELINE  基线版本；缺省时动态获取官方最新 stable，
#                      失败回落 CHROMIUM_BASELINE_FALLBACK（140.0.7339.80，需核实）
#   DEPOT_TOOLS_DIR    depot_tools 目录（默认 $HOME/depot_tools）
#   GCLIENT_JOBS       gclient 并行任务数（默认 nproc*2 上限 16）
#   TARGET_OS          附加目标平台（android：fetch 前写入 .gclient，首次即含 SDK/NDK）

set -euo pipefail

CHROMIUM_DIR="${CHROMIUM_DIR:-$HOME/chromium}"
DEPOT_TOOLS="${DEPOT_TOOLS_DIR:-$HOME/depot_tools}"
GCLIENT_JOBS="${GCLIENT_JOBS:-$(($(nproc) * 2 > 16 ? 16 : $(nproc) * 2))}"

# ---- 版本解析：官方 versionhistory API（Google 官方正式版发布记录）----
if [ -z "${CHROMIUM_BASELINE:-}" ]; then
  CHROMIUM_BASELINE="$(curl -sf --max-time 30 \
    'https://versionhistory.googleapis.com/v1/chrome/platforms/linux/channels/stable/versions' \
    | python3 -c "import json,sys;print(json.load(sys.stdin)['versions'][0]['version'])" 2>/dev/null \
    || echo '')"
  if [ -z "${CHROMIUM_BASELINE}" ]; then
    CHROMIUM_BASELINE="${CHROMIUM_BASELINE_FALLBACK:-140.0.7339.80}"
    echo "warn: versionhistory unavailable, fallback baseline ${CHROMIUM_BASELINE}"
  fi
fi
echo "==> Chromium baseline: ${CHROMIUM_BASELINE}"

# ---- depot_tools ----
if [ ! -d "${DEPOT_TOOLS}/.git" ]; then
  git clone --depth=1 https://chromium.googlesource.com/chromium/tools/depot_tools.git "${DEPOT_TOOLS}"
fi
export PATH="${DEPOT_TOOLS}:${PATH}"

# depot_tools 首次初始化（CIPD bootstrap：生成 python3_bin_reldir.txt / vpython）
# 未初始化直接调 fetch 会报 "python3_bin_reldir.txt not found" 并 exit 1
if [ ! -f "${DEPOT_TOOLS}/python3_bin_reldir.txt" ]; then
  echo "==> bootstrap depot_tools ..."
  (cd "${DEPOT_TOOLS}" && ./update_depot_tools)
  "${DEPOT_TOOLS}/gclient" --version > /dev/null 2>&1 || gclient --version > /dev/null
fi

# ---- Linux 构建依赖 ----
# 注意：不能加 sudo -E —— 托管 Runner 的 sudoers 无 SETENV 权限，-E 会触发密码认证导致失败
if [ ! -f "${CHROMIUM_DIR}/.deps-ready" ]; then
  if [ "$(id -u)" -eq 0 ]; then
    "${DEPOT_TOOLS}/build/install-build-deps.sh" --no-prompt || true
  elif command -v sudo >/dev/null 2>&1; then
    sudo "${DEPOT_TOOLS}/build/install-build-deps.sh" --no-prompt || true
  else
    echo "warn: no root/sudo, skip install-build-deps（托管镜像自带大部分依赖）"
  fi
fi

mkdir -p "${CHROMIUM_DIR}"
cd "${CHROMIUM_DIR}"

# ---- 源码（官方仓库）----
if [ ! -f .gclient ]; then
  fetch --nohooks --no-history chromium
fi

# TARGET_OS 注入（android 必须在首次 sync 前写入，SDK/NDK 才会随 hooks 下载）
if [ -n "${TARGET_OS:-}" ]; then
  python3 - "$TARGET_OS" <<'PY'
import json, pathlib, sys
p = pathlib.Path(".gclient")
cfg = json.loads(p.read_text())
os_list = [sys.argv[1]]
if cfg.get("target_os") != os_list:
    cfg["target_os"] = os_list
    p.write_text(json.dumps(cfg, indent=2) + "\n")
    print(f"target_os -> {os_list}")
PY
fi

cd src
git fetch --tags origin --depth=1 2>/dev/null || git fetch --tags origin
git checkout -f "tags/${CHROMIUM_BASELINE}" 2>/dev/null \
  || echo "warn: tag ${CHROMIUM_BASELINE} not found, staying on current commit"

gclient sync -D --with_branch_heads --jobs "${GCLIENT_JOBS}"
gclient runhooks

touch "${CHROMIUM_DIR}/.deps-ready"
echo "==> sync done: $(cd "${CHROMIUM_DIR}/src" && git describe --tags 2>/dev/null || echo 'unknown')"
