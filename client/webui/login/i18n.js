// NodeByte WebUI i18n（中英；提示词 5.14 全 UI i18n）
// 由 scripts/gen_i18n.py 生成，键 = 页面 data-i18n + C++ kStringsJs 占位。
'use strict';
window.nodebyte_i18n = {'zh': {'account': 'account', 'accountDisabled': '账号已被禁用', 'collab': '协作', 'files': '文件', 'forgot': '忘记密码？', 'login': '登录', 'messages': '消息', 'needBind2fa': '请先绑定两步验证', 'newSess': '新建会话集', 'password': '密码', 'pushTab': '推送当前标签页', 'quotaFull': '设备数已达上限', 'sendFile': '发送文件', 'sendText': '发送文本到设备', 'sessHint': '访问网站时检测域名 → 选择会话集 → 内核注入隔离存储', 'sessions': 'Cookie 会话', 'shotDesktop': '桌面截图', 'shotTab': '网页截图', 'sub': 'sub', 'title': '登录 NodeByte', 'totp': '两步验证码（可选）'}, 'en': {'account': 'account', 'accountDisabled': 'Account disabled', 'collab': 'Collab', 'files': 'Files', 'forgot': 'Forgot password?', 'login': 'Sign in', 'messages': 'Messages', 'needBind2fa': 'Bind two-factor authentication first', 'newSess': 'New session set', 'password': 'Password', 'pushTab': 'Push current tab', 'quotaFull': 'Device quota reached', 'sendFile': 'Send file', 'sendText': 'Send text to device', 'sessHint': 'Detect domain while browsing → pick a session set → isolated storage injection', 'sessions': 'Cookie sessions', 'shotDesktop': 'Desktop screenshot', 'shotTab': 'Page screenshot', 'sub': 'sub', 'title': 'Sign in to NodeByte', 'totp': '2FA code (optional)'}};
window.nodebyte_applyI18n = function () {
  const lang = (navigator.language || 'zh-CN').toLowerCase().startsWith('zh') ? 'zh' : 'en';
  const dict = window.nodebyte_i18n[lang] || window.nodebyte_i18n.zh;
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const k = el.getAttribute('data-i18n');
    if (dict[k] != null) el.textContent = dict[k];
  });
  const t = document.querySelector('title[data-i18n-title]');
  if (t) { const k = t.getAttribute('data-i18n-title'); if (dict[k] != null) t.textContent = dict[k]; }
};
document.addEventListener('DOMContentLoaded', window.nodebyte_applyI18n);
