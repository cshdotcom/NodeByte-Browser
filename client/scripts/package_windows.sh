#!/usr/bin/env bash
# package_windows.sh —— 收集 Windows 产物并生成 Inno Setup 打包暂存目录
#
# 产物结构（installer/NodeByteBrowser.iss 使用）：
#   staging/nodebyte.exe          ← chrome.exe 重命名（低侵入：exe 名替换走 branding patch）
#   staging/locales/*             ← 语言资源
#   staging/assets/icons/*        ← 全套图标替换
#
# Inno 编译：在 Windows 机器（或 wine + iscc）执行：
#   iscc installer/NodeByteBrowser.iss

set -euo pipefail

CHROMIUM_SRC="${1:?usage: package_windows.sh /path/to/chromium/src}"
OUT_DIR="${CHROMIUM_SRC}/out/Release-pc"
STAGING="${CHROMIUM_SRC}/out/Release-pc/_staging"

rm -rf "${STAGING}"
mkdir -p "${STAGING}/locales" "${STAGING}/assets/icons"

cp "${OUT_DIR}/chrome.exe" "${STAGING}/nodebyte.exe"
# Chromium 运行时必需文件（dll/pak/icudtl 等按构建配置存在；逐项存在才拷贝）
for f in chrome.dll icudtl.dat resources.pak v8_context_snapshot.bin; do
  [ -f "${OUT_DIR}/${f}" ] && cp "${OUT_DIR}/${f}" "${STAGING}/"
done
[ -d "${OUT_DIR}/locales" ] && cp -r "${OUT_DIR}/locales/." "${STAGING}/locales/"

echo "staging ready: ${STAGING}"
echo "next: iscc installer/NodeByteBrowser.iss  (on Windows)"
