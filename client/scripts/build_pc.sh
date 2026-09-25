#!/usr/bin/env bash
# build_pc.sh —— PC（Windows/Linux）Release 构建（提示词 10.5 / 附录B/C）
#
# 用法： bash build_pc.sh /path/to/chromium/src
# 产物： out/Release-pc/chrome（Linux 调试验证）/ 交叉编译 Windows 时产物 chrome.exe
#
# 开发期：is_component_build=true（增量飞快、降内存）、symbol_level=0、关 ThinLTO；
# 发布版：args-release-pc.gn（关组件、开优化；ThinLTO 内存爆炸风险见提示词 10.5.1）。

set -euo pipefail

CHROMIUM_SRC="${1:?usage: build_pc.sh /path/to/chromium/src}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$HOME/depot_tools:${PATH}"
MODE="${MODE:-release}"   # release | dev

cd "${CHROMIUM_SRC}"

OUT_DIR="Release-pc"
ARGS_FILE="${REPO_ROOT}/gn/args-release-pc.gn"
if [ "${MODE}" = "dev" ]; then
  OUT_DIR="Debug-pc"
  ARGS_FILE="${REPO_ROOT}/gn/args-dev.gn"
fi

mkdir -p "out/${OUT_DIR}"
cp "${ARGS_FILE}" "out/${OUT_DIR}/args.gn"

# gn args 写入后 gen（改 gn args 会破坏增量缓存 → 全量重编，提示词 10.5.4）
gn gen "out/${OUT_DIR}"

# 编译（autoninja 按核数并行；链接阶段内存 12–20GB）
autoninja -C "out/${OUT_DIR}" chrome

echo "build done: out/${OUT_DIR}/"
ls -la "out/${OUT_DIR}/chrome" 2>/dev/null || ls -la "out/${OUT_DIR}/chrome.exe" 2>/dev/null || true
