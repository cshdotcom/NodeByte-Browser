#!/usr/bin/env bash
# sync_chromium_android.sh —— Android 目标额外同步（NDK 工具链 + android deps）
#
# 要求：32 核 / 64GB 内存 / 350GB 空闲（提示词 10.2.3）；
# Android 平台改动巨大，PC 验证完毕再移植（提示词 5.5.7 / 路线图 v1.4）。

set -euo pipefail

CHROMIUM_DIR="${CHROMIUM_DIR:-$HOME/chromium}"
ANDROID_NDK_ROOT="${ANDROID_NDK_ROOT:-/opt/android-ndk}"
export PATH="$HOME/depot_tools:${PATH}"

cd "${CHROMIUM_DIR}/src"

# android deps（gclient 里 target_os=['android']；需在 .gclient 中加入）
python3 - <<'PY'
import json, pathlib
gclient = pathlib.Path("../.gclient")
cfg = gclient.read_text() if gclient.exists() else ""
if "target_os" not in cfg:
    cfg = cfg.rstrip()[:-1] + ',\n  "target_os": ["android"]\n]'
    gclient.write_text(cfg)
    print("added target_os android to .gclient")
PY

gclient sync -D --jobs 16

# NDK（Chromium 内部会自动下载；外部路径仅用于 gn args 提示）
if [ ! -d "${ANDROID_NDK_ROOT}" ]; then
  echo "note: chromium r25+ uses bundled NDK via gclient; external NDK optional at ${ANDROID_NDK_ROOT}"
fi

echo "android toolchain synced."
