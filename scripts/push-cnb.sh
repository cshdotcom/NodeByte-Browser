#!/usr/bin/env bash
# push-cnb.sh —— 一键把仓库推送到 CNB（cnb.cool）并触发 .cnb.yml 云端校验/编译。
#
# 用法：
#   1) 先在 CNB 网页端创建空仓库（个人空间或组织下，不要初始化 README）：
#        https://cnb.cool → 新建仓库 → 名称 NodeByte-Browser
#      （CNB 新账号根组织年度创建额度受限/个人空间无 API 建仓端点，
#        故仓库需网页端创建一次；之后全流程脚本化）
#   2) 运行本脚本：
#        CNB_PATH="cnb.dEzCZ5lCAHA/NodeByte-Browser" CNB_TOKEN="xxxx" bash scripts/push-cnb.sh
#      或已配置 remote 时：bash scripts/push-cnb.sh
#
# 环境变量：
#   CNB_PATH   仓库路径（owner/repo，默认 cnb.dEzCZ5lCAHA/NodeByte-Browser）
#   CNB_TOKEN  CNB 访问令牌（用户提供；也可用已配置的 cnb remote）
#   BRANCHES   推送分支/标签（默认 "main --tags"）

set -euo pipefail

CNB_PATH="${CNB_PATH:-cnb.dEzCZ5lCAHA/NodeByte-Browser}"
BRANCHES="${BRANCHES:-main --tags}"

if git remote get-url cnb >/dev/null 2>&1; then
  REMOTE=cnb
else
  : "${CNB_TOKEN:?需要 CNB_TOKEN（或先 git remote add cnb <url>）}"
  git remote add cnb "https://cnb:${CNB_TOKEN}@cnb.cool/${CNB_PATH}.git"
  REMOTE=cnb
fi

echo ">>> 推送到 CNB：$(git remote get-url "$REMOTE" | sed -E 's#://[^@]+@#://***@#') # $BRANCHES"
# shellcheck disable=SC2086
git push "$REMOTE" $BRANCHES

echo ">>> 完成。CNB 云端流水线（.cnb.yml）："
echo "    - main.push → nodebyte-lite-validate（轻量校验：Shell 语法/补丁干跑/tsc/standalone 构建/CSV 自测）"
echo "    - web_trigger → nodebyte-chromium-build（手动触发 Chromium 全量编译，带硬件预检）"
echo "    查看构建：https://cnb.cool/${CNB_PATH}/-/build"
