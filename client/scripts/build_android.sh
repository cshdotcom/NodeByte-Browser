#!/usr/bin/env bash
# build_android.sh —— Android APK 构建（arm64；提示词 10.1.1 / 附录B）
#
# 要求：Android 建议 32GB+ 内存 + NDK；一次完整编译更久（提示词 10.1.1）
# 产物： out/Release-android/apks/NodeByteBrowser.apk

set -euo pipefail

CHROMIUM_SRC="${1:?usage: build_android.sh /path/to/chromium/src}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$HOME/depot_tools:${PATH}"

cd "${CHROMIUM_SRC}"

OUT_DIR="Release-android"
mkdir -p "out/${OUT_DIR}"
cp "${REPO_ROOT}/gn/args-release-android.gn" "out/${OUT_DIR}/args.gn"

gn gen "out/${OUT_DIR}"
autoninja -C "out/${OUT_DIR}" chrome_public_apk

APK="out/${OUT_DIR}/apks/ChromePublic.apk"
[ -f "${APK}" ] && cp "${APK}" "out/${OUT_DIR}/apks/NodeByteBrowser.apk"

echo "android build done: out/${OUT_DIR}/apks/NodeByteBrowser.apk"
