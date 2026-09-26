#!/usr/bin/env bash
# ci_precheck.sh —— Chromium 编译前硬件预检（CNB web_trigger / 自托管共用）。
# 目的：磁盘/内存不足时立即失败退出，不进入长编译，避免白白消耗核时。
# 门槛（客户端提示词 10.1/10.3）：PC Release ≥16 核 32GB 内存 + 250GB 空闲磁盘；
# Android 建议 32GB+ 内存。
set -euo pipefail

fail() { echo "PRECHECK FAILED: $1" >&2; exit 1; }

CPU=$(nproc)
MEM_KB=$(awk '/MemTotal/{print $2}' /proc/meminfo)
MEM_GB=$((MEM_KB / 1024 / 1024))
DISK_GB=$(df -BG --output=avail . | tail -1 | tr -dc '0-9')

echo "CPU: ${CPU} cores | MEM: ${MEM_GB} GB | DISK avail: ${DISK_GB} GB"

[ "${CPU}" -ge 16 ] || fail "需要 ≥16 核（当前 ${CPU}）——请使用自托管构建机或更高规格"
[ "${MEM_GB}" -ge 30 ] || fail "需要 ≥32GB 内存（当前 ${MEM_GB}）——链接阶段 12-20GB 会 OOM"
# 磁盘门槛按编译参数分档：hosted（默认，关 LTO/零符号）峰值 ~100GB → 140GB 阈值；
# release 全量（use_thin_lto=true）需 240GB —— 用 RELEASE_PROFILE=1 启用严格档
PROFILE_DISK=140
if [ "${RELEASE_PROFILE:-0}" = "1" ]; then PROFILE_DISK=240; fi
[ "${DISK_GB}" -ge ${PROFILE_DISK} ] || fail "需要 ≥${PROFILE_DISK}GB 空闲磁盘（当前 ${DISK_GB}）——hosted 编译峰值约 100GB（源码~30 + out~50 + 缓存~20）"

echo "PRECHECK OK: 满足 Chromium 全量编译门槛"
