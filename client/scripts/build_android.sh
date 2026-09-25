#!/usr/bin/env bash
# build_android.sh —— Android APK 构建（arm64；GitHub 托管 Runner / 自托管通用）
#
# 产物： out/Release-<suffix>/apks/ChromePublic.apk → NodeByteBrowser.apk
# 环境变量：
#   ARGS_FILE     GN 参数文件（默认 gn/args-release-android.gn；托管传 args-hosted-android.gn）
#   OUT_SUFFIX    输出目录后缀（默认 android；托管传 hosted-android）

set -euo pipefail

CHROMIUM_SRC="${1:?usage: build_android.sh /path/to/chromium/src}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="${DEPOT_TOOLS_DIR:-$HOME/depot_tools}:${PATH}"

cd "${CHROMIUM_SRC}"

OUT_DIR="Release-${OUT_SUFFIX:-android}"
mkdir -p "out/${OUT_DIR}"
cp "${ARGS_FILE:-${REPO_ROOT}/gn/args-release-android.gn}" "out/${OUT_DIR}/args.gn"

gn gen "out/${OUT_DIR}"
autoninja -C "out/${OUT_DIR}" chrome_public_apk

APK="out/${OUT_DIR}/apks/ChromePublic.apk"
if [ -f "${APK}" ]; then
  cp "${APK}" "out/${OUT_DIR}/apks/NodeByteBrowser.apk"
fi

echo "android build done: out/${OUT_DIR}/apks/"
ls -la "out/${OUT_DIR}/apks/" 2>/dev/null || true
