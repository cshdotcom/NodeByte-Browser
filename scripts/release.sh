#!/usr/bin/env bash
# release.sh —— 一键发布（提交 / 打 tag / 推送 / 创建 Release 附更新记录）
#
# 用法：
#   bash scripts/release.sh v1.1.0 "发布说明标题"
#
# 依赖：gh CLI（或手工用 REST API）；GIT 已经 commit 的内容一并推送。
# 约定：每次提交都打 tag；tag 与 Release 一一对应；Release 附更新记录（CHANGELOG + 本次说明）。

set -euo pipefail

TAG="${1:?usage: release.sh v<version> <title>}"
TITLE="${2:-Release ${TAG}}"
CHANGELOG="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/CHANGELOG.md"

# 1. 推送 main 与全部 tag
git push origin main
git push origin "${TAG}"

# 2. 提取 CHANGELOG 对应段落作为 Release Notes
notes="${TMPDIR:-/tmp}/notes-${TAG}.md"
{
  echo "# ${TITLE}"
  echo
  sed -n "/^## \[${TAG#v}\]/,/^## /p" "${CHANGELOG}" 2>/dev/null | sed '$d' || true
  echo
  echo "**源码归档**：点击下方 Source code (zip/tar.gz) 自动附加。"
} > "${notes}"

# 3. 创建 Release（含源码 + 更新记录）
gh release create "${TAG}" \
  --title "${TITLE}" \
  --notes-file "${notes}" \
  --repo cshdotcom/chromium-build

echo "released: ${TAG} — ${TITLE}"
