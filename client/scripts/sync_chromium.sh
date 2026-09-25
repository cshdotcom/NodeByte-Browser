#!/usr/bin/env bash
# sync_chromium.sh —— 拉取 Chromium 源码（PC，提示词 10.1/10.5）
#
# 要求（自托管构建机，标签 linux-build-box）：
#   Ubuntu 24.04；PC Release ≥16 核 / 32GB 内存 / 250GB 空闲 NVMe
#
# 首次：fetch chromium --no-history（完整源码几十 GB，耐心等待）
# 之后：gclient sync -D 增量拉取 + 切换基线 tag（CHROMIUM_BASELINE）
#
# 环境变量：
#   CHROMIUM_DIR     源码根目录（默认 $HOME/chromium）；out/ 与 .gclient 缓存放持久磁盘勿清理
#   CHROMIUM_BASELINE 基线版本（默认 128.0.6613.0；【需核实】与 patches 兼容性）

set -euo pipefail

CHROMIUM_DIR="${CHROMIUM_DIR:-$HOME/chromium}"
CHROMIUM_BASELINE="${CHROMIUM_BASELINE:-128.0.6613.0}"
DEPOT_TOOLS="${DEPOT_TOOLS:-$HOME/depot_tools}"

# ---- depot_tools ----
if [ ! -d "${DEPOT_TOOLS}" ]; then
  git clone --depth=1 https://chromium.googlesource.com/chromium/tools/depot_tools.git "${DEPOT_TOOLS}"
fi
export PATH="${DEPOT_TOOLS}:${PATH}"

# ---- Linux 构建依赖 ----
if [ ! -f "${CHROMIUM_DIR}/.deps-ready" ]; then
  "${DEPOT_TOOLS}/build/install-build-deps.sh" --no-prompt || true
  mkdir -p "${CHROMIUM_DIR}"
  touch "${CHROMIUM_DIR}/.deps-ready"
fi

mkdir -p "${CHROMIUM_DIR}"
cd "${CHROMIUM_DIR}"

# ---- 源码 ----
if [ ! -f .gclient ]; then
  # 首次：无历史拉取（省磁盘）
  fetch --nohooks --no-history chromium
fi

cd src
git fetch --tags origin
git checkout "tags/${CHROMIUM_BASELINE}" 2>/dev/null || {
  echo "warn: tag ${CHROMIUM_BASELINE} not found, staying on current commit"
}

gclient sync -D --with_branch_heads --jobs 16
gclient runhooks

echo "chromium synced at baseline ${CHROMIUM_BASELINE} -> $(pwd)"
