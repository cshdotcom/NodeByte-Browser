#!/usr/bin/env bash
# build_pc.sh —— PC（Windows/Linux）构建（GitHub 托管 Runner / 自托管通用）
#
# 用法： bash build_pc.sh /path/to/chromium/src
# 产物： out/Release-<suffix>/chrome（Linux）/ chrome.exe（Windows）
#
# 环境变量：
#   MODE          release | dev（默认 release）
#   ARGS_FILE     GN 参数文件（默认 gn/args-release-pc.gn；托管 Runner 传 args-hosted-*.gn）
#   OUT_SUFFIX    输出目录后缀（默认 pc；托管传 hosted-pc 区分产物）
#   DEPOT_TOOLS_DIR depot_tools 位置（默认 $HOME/depot_tools）

set -euo pipefail

CHROMIUM_SRC="${1:?usage: build_pc.sh /path/to/chromium/src}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="${DEPOT_TOOLS_DIR:-$HOME/depot_tools}:${PATH}"
MODE="${MODE:-release}"

cd "${CHROMIUM_SRC}"

OUT_DIR="Release-${OUT_SUFFIX:-pc}"
ARGS_FILE="${ARGS_FILE:-${REPO_ROOT}/gn/args-release-pc.gn}"
if [ "${MODE}" = "dev" ]; then
  OUT_DIR="Debug-pc"
  ARGS_FILE="${ARGS_FILE:-${REPO_ROOT}/gn/args-dev.gn}"
fi

mkdir -p "out/${OUT_DIR}"
cp "${ARGS_FILE}" "out/${OUT_DIR}/args.gn"

# gn args 写入后 gen（改 gn args 会破坏增量缓存 → 全量重编，提示词 10.5.4）
gn gen "out/${OUT_DIR}"

# 编译（autoninja 按 -j 参数并行；托管 4 核自动适配）
autoninja -C "out/${OUT_DIR}" chrome

echo "build done: out/${OUT_DIR}/"
ls -la "out/${OUT_DIR}/chrome" 2>/dev/null || ls -la "out/${OUT_DIR}/chrome.exe" 2>/dev/null || true
