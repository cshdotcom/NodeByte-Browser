#!/usr/bin/env bash
# patch_dryrun.sh —— 新增文件型补丁干跑校验（CNB lite-validate / GitHub Actions 共用）。
# 说明：.cnb.yml 的内联 script 由 CNB 预处理器改写（$VAR/$() 会被替换），
#       干跑逻辑全部收进本脚本文件执行，绕开内联限制。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CHECK_DIR="$(mktemp -d /tmp/patch-check.XXXXXX)"

git init -q "${CHECK_DIR}"
fail=0
for p in "${REPO_ROOT}"/client/patches/01*.patch; do
  if git -C "${CHECK_DIR}" apply --check "${p}"; then
    echo "patch OK: $(basename "${p}")"
  else
    echo "patch FAIL: $(basename "${p}")" >&2
    fail=1
  fi
done
rm -rf "${CHECK_DIR}"
if [ "${fail}" -ne 0 ]; then
  echo "patch dry-run FAILED" >&2
  exit 1
fi
echo "patch dry-run OK: all 01xx patches apply cleanly"
