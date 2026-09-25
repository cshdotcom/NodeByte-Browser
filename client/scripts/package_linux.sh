#!/usr/bin/env bash
# package_linux.sh —— 收集 Linux standalone 便携成品（tar 压缩包）
#
# 产物： out/Release-<suffix>/_dist/NodeByte-Browser-<version>-linux-x64.tar.gz
# 内容： chrome 主程序 + 运行时资源（locales/pak/icudtl/v8 快照）+ nodebyte 启动器
#
# 用法： bash package_linux.sh /path/to/chromium/src [version]

set -euo pipefail

CHROMIUM_SRC="${1:?usage: package_linux.sh /path/to/chromium/src [version]}"
VERSION="${2:-0.0.0+unknown}"
OUT_SUFFIX="${OUT_SUFFIX:-hosted-pc}"
OUT_DIR="${CHROMIUM_SRC}/out/Release-${OUT_SUFFIX}"
STAGING="${OUT_DIR}/_staging-linux"
DIST="${OUT_DIR}/_dist"

rm -rf "${STAGING}" "${DIST}"
mkdir -p "${STAGING}/locales" "${DIST}"

# 主程序 + 运行时必需文件（逐项存在才拷贝，兼容不同构建配置）
cp "${OUT_DIR}/chrome" "${STAGING}/nodebyte"
for f in chrome_sandbox chrome_crashpad_handler icudtl.dat resources.pak \
         chrome_100_percent.pak chrome_200_percent.pak v8_context_snapshot.bin \
         snapshot_blob.bin MEI_DEPRECATED_COMPLIANT_MESSAGE libEGL.so libGLESv2.so \
         libvk_swiftshader.so vk_swiftshader_icd.json; do
  [ -f "${OUT_DIR}/${f}" ] && cp "${OUT_DIR}/${f}" "${STAGING}/"
done
[ -d "${OUT_DIR}/locales" ] && cp -r "${OUT_DIR}/locales/." "${STAGING}/locales/"

# 启动器：默认关闭 GPU 沙箱兼容场景由用户自选，给出 chrome-sandbox 提示
cat > "${STAGING}/nodebyte-desktop" <<'EOF'
#!/usr/bin/env bash
# NodeByte Browser 桌面启动器（standalone 便携包）
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export CHROME_DESKTOP="nodebyte.desktop"
exec "${DIR}/nodebyte" "$@"
EOF
chmod +x "${STAGING}/nodebyte-desktop"

# 版本说明
{
  echo "NodeByte Browser (standalone portable)"
  echo "Chromium baseline: ${VERSION}"
  echo "Platform: linux-x64"
  echo "Build date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "Source: https://github.com/cshdotcom/NodeByte-Browser"
} > "${STAGING}/NODEBYTE-VERSION.txt"

# 打包（zstd 优先，回落 gzip）
cd "${STAGING}"
TARBALL="${DIST}/NodeByte-Browser-${VERSION}-linux-x64.tar"
tar cf "${TARBALL}" .
if command -v zstd >/dev/null 2>&1; then
  zstd -q -3 -f "${TARBALL}" -o "${TARBALL}.zst" && rm -f "${TARBALL}"
  echo "dist ready: ${TARBALL}.zst"
else
  gzip -f "${TARBALL}"
  echo "dist ready: ${TARBALL}.gz"
fi
ls -la "${DIST}/"
