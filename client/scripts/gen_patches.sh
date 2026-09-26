#!/usr/bin/env bash
# gen_patches.sh —— 从 src-nodebyte/ 生成补丁集（补丁差分构建策略，提示词 10.3）
#
# 仓库只存 patch / gn 参数 / 构建脚本，不存完整 Chromium 源码；
# 本脚本把 src-nodebyte/ 下全部新文件生成「新增文件型补丁」，按目录分组输出到 patches/。
# hand-written hook 补丁（0200+，对 Chromium 核心文件的小修改）不在本脚本范围内，
# 直接维护在 patches/ 下（标注基线「需核实」）。
#
# 用法： bash scripts/gen_patches.sh
# 输出： patches/0100-*.patch 等；patches/README.md 表格需人工核对更新。

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIR="${REPO_ROOT}/src-nodebyte"
OUT_DIR="${REPO_ROOT}/patches"

EMPTY_TREE="4b825dc642cb6eb9a060e54bf8d69288fbee4904"  # git 空树哈希（固定值）

# 分组定义：补丁名 → src-nodebyte 下相对目录（空格分隔）
declare -A PATCH_GROUPS=(
  ["0100-nodebyte-core"]="chrome/browser/nodebyte/BUILD.gn chrome/browser/nodebyte/nodebyte_constants.h chrome/browser/nodebyte/nodebyte_protocol.h chrome/browser/nodebyte/nodebyte_protocol.cc chrome/browser/nodebyte/nodebyte_branding.h chrome/browser/nodebyte/nodebyte_branding.cc chrome/browser/nodebyte/mojo"
  ["0110-nodebyte-policy"]="chrome/browser/nodebyte/policy_extend"
  ["0120-nodebyte-sync"]="chrome/browser/nodebyte/sync"
  ["0130-nodebyte-cookie-sessions"]="chrome/browser/nodebyte/cookie_sessions"
  ["0140-nodebyte-drop"]="chrome/browser/nodebyte/drop chrome/browser/nodebyte/fingerprint"
  ["0150-nodebyte-webui"]="chrome/browser/ui/webui/nodebyte"
  ["0160-nodebyte-extensions"]="chrome/browser/nodebyte/extensions"
  ["0170-nodebyte-import"]="chrome/browser/nodebyte/import"
  ["0180-nodebyte-translate"]="chrome/browser/nodebyte/translate"
  ["0190-nodebyte-office"]="chrome/browser/nodebyte/office chrome/browser/nodebyte/print chrome/browser/resources/nodebyte"
  ["0250-nodebyte-collab"]="chrome/browser/nodebyte/collab"
)

mkdir -p "${OUT_DIR}"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

# 在临时 git 仓库里准备 src-nodebyte 内容（保持相对路径结构）
cp -r "${SRC_DIR}/." "${TMP_DIR}/"
cd "${TMP_DIR}"
git init -q
git config user.email "patch-gen@nodebyte.local"
git config user.name "patch-gen"
git add -A

for name in "${!PATCH_GROUPS[@]}"; do
  out_file="${OUT_DIR}/${name}.patch"
  : > "${out_file}"
  for rel in ${PATCH_GROUPS[$name]}; do
    # 与空树的 diff = 新增文件补丁（git apply --3way 可稳定应用：目标文件不存在）
    git diff --binary "${EMPTY_TREE}" -- "${rel}" >> "${out_file}" || true
  done
  # 跨 git 版本稳定性：剥离 index 元数据行（blob 摘要与 git 版本/环境相关，
  # 剥离后补丁字节跨环境一致，CI 一致性校验才可复现；新增文件补丁不依赖 index）
  sed -i '/^index [0-9a-f]\{7,\}\.\.[0-9a-f]\{7,\}\( [0-9]\{4,\}\)\?$/d' "${out_file}" || true
  if [ ! -s "${out_file}" ]; then
    echo "error: empty patch ${name}" >&2
    exit 1
  fi
  echo "generated: ${name}.patch ($(grep -c '^diff --git' "${out_file}") files)"
done

echo "done. patches/ updated — remember to review patches/README.md."
