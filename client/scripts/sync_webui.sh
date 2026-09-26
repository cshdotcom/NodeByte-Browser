#!/usr/bin/env bash
# sync_webui.sh —— 构建前把 client/webui/ 页面源码复制进 Chromium 树
#   bash scripts/sync_webui.sh /path/to/chromium/src
# 目标：$SRC/chrome/browser/resources/nodebyte/（grd 相对引用，见资源包 README）
set -euo pipefail

SRC="${1:?usage: sync_webui.sh /path/to/chromium/src}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="${SRC}/chrome/browser/resources/nodebyte"

if [ ! -d "${SRC}" ]; then
  echo "error: chromium src not found: ${SRC}" >&2
  exit 1
fi

mkdir -p "${DEST}"/{login,drop,settings,translate,offline-game,usercenter,office,print}
copy() { # <repo-relative> <tree-relative>
  cp "${REPO_ROOT}/client/webui/$1" "${DEST}/$2"
}
copy login/index.html      login/index.html
copy login/app.js          login/app.js
copy login/style.css       login/style.css
copy login/i18n.js         login/i18n.js
copy drop/index.html       drop/index.html
copy drop/app.js           drop/app.js
copy drop/style.css        drop/style.css
copy drop/i18n.js          drop/i18n.js
copy settings/index.html   settings/index.html
copy translate/index.html  translate/index.html
copy translate/app.js      translate/app.js
copy offline-game/index.html offline-game/index.html
copy offline-game/game.js    offline-game/game.js
copy usercenter/index.html usercenter/index.html
copy office/index.html     office/index.html
copy office/app.js         office/app.js
copy print/index.html      print/index.html
copy print/app.js          print/app.js
copy print/pdf-kit.js      print/pdf-kit.js

# grd / BUILD.gn / README 由 src-nodebyte 组补丁带入（gen_patches.sh 0190 组）
echo "webui assets synced → ${DEST}"
