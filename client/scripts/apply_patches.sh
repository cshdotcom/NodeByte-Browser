#!/usr/bin/env bash
# apply_patches.sh —— 应用 NodeByte 补丁到 Chromium 源码树（提示词 附录C 脚本要点）
#
# 用法：
#   bash apply_patches.sh /path/to/chromium/src
#
# 行为：
#   1. 按序号顺序应用 patches/*.patch；
#   2. 优先 git apply --3way（允许在基线轻微漂移时自动三方合并）；
#   3. 新增文件补丁（0100–0199）失败 → 立即退出并输出冲突文件；
#   4. 核心 hook 补丁（0200+，标注基线需核实）在 PATCH_BEST_EFFORT=1 时
#      失败仅告警并跳过（GitHub 托管 Runner 基线为最新 stable，允许漂移降级）。

set -euo pipefail

PATCH_BEST_EFFORT="${PATCH_BEST_EFFORT:-0}"

CHROMIUM_SRC="${1:?usage: apply_patches.sh /path/to/chromium/src}"
PATCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../patches" && pwd)"

if [ ! -d "${CHROMIUM_SRC}/.git" ]; then
  echo "error: ${CHROMIUM_SRC} is not a git checkout (gclient sync first)" >&2
  exit 1
fi

cd "${CHROMIUM_SRC}"

# 幂等：记录已应用补丁（.nodebyte-applied 清单放构建机持久磁盘，勿清理）
MARKER=".nodebyte-applied"
touch "${MARKER}"

failed=0
for patch in "${PATCH_DIR}"/*.patch; do
  name="$(basename "${patch}")"
  if grep -qxF "${name}" "${MARKER}"; then
    echo "[skip] ${name} (already applied)"
    continue
  fi
  echo "[apply] ${name}"
  if git apply --3way --whitespace=nowarn "${patch}"; then
    echo "${name}" >> "${MARKER}"
  else
    echo "-------------------------------------------" >&2
    echo "CONFLICT: ${name} failed to apply." >&2
    git apply --3way --check "${patch}" 2>&1 | head -20 >&2 || true
    echo "Conflicting files are listed above; resolve manually then re-run." >&2
    echo "-------------------------------------------" >&2
    # hook 补丁（0200+）在 best-effort 模式下跳过（基线漂移允许功能降级）
    if [ "${PATCH_BEST_EFFORT}" = "1" ] && [[ "${name}" =~ ^02[0-9][0-9]- ]]; then
      echo "warn: [best-effort] skip ${name} (hook patch, baseline drift tolerated)" >&2
      echo "SKIPPED:${name}" >> "${MARKER}"
      continue
    fi
    failed=1
    break
  fi
done

if [ "${failed}" -ne 0 ]; then
  exit 1
fi

echo "all patches applied."
