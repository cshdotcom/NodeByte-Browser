#!/usr/bin/env bash
# package_windows.sh —— 收集 Windows 产物并生成打包暂存目录（便携 zip / Inno Setup）
#
# 产物结构（installer/NodeByteBrowser.iss 使用）：
#   staging/nodebyte.exe          ← chrome.exe 重命名（低侵入：exe 名替换走 branding patch）
#   staging/locales/*             ← 语言资源
#   staging/assets/icons/*        ← 全套图标替换
#
# 用法： bash package_windows.sh /path/to/chromium/src [version]
# 环境变量： OUT_SUFFIX（默认 hosted-pc）
# Inno 编译：在 Windows 机器（或 wine + iscc）执行：
#   iscc installer/NodeByteBrowser.iss

set -euo pipefail

CHROMIUM_SRC="${1:?usage: package_windows.sh /path/to/chromium/src [version]}"
VERSION="${2:-0.0.0+unknown}"
OUT_SUFFIX="${OUT_SUFFIX:-hosted-pc}"
OUT_DIR="${CHROMIUM_SRC}/out/Release-${OUT_SUFFIX}"
STAGING="${OUT_DIR}/_staging"

rm -rf "${STAGING}"
mkdir -p "${STAGING}/locales" "${STAGING}/assets/icons"

cp "${OUT_DIR}/chrome.exe" "${STAGING}/nodebyte.exe"
# Chromium 运行时必需文件（dll/pak/icudtl 等按构建配置存在；逐项存在才拷贝）
for f in chrome.dll chrome_elf.dll icudtl.dat resources.pak v8_context_snapshot.bin \
         chrome_100_percent.pak chrome_200_percent.pak libEGL.dll libGLESv2.dll \
         d3dcompiler_47.dll vk_swiftshader.dll vk_swiftshader_icd.json; do
  [ -f "${OUT_DIR}/${f}" ] && cp "${OUT_DIR}/${f}" "${STAGING}/"
done
[ -d "${OUT_DIR}/locales" ] && cp -r "${OUT_DIR}/locales/." "${STAGING}/locales/"

{
  echo "NodeByte Browser (Windows portable)"
  echo "Chromium baseline: ${VERSION}"
  echo "Platform: windows-x64"
} > "${STAGING}/NODEBYTE-VERSION.txt"

echo "staging ready: ${STAGING}"
echo "next: iscc installer/NodeByteBrowser.iss  (on Windows)"
