// nodebyte://login —— 登录逻辑
// 对接 POST {sync_server}/api/auth/login；业务状态码驱动动作（客户端提示词 7.10）：
//   0 成功 | 401 凭证错误 | 40301 需绑定 2FA → 跳转网页个人中心绑定页
//   40302 账号禁用/封禁/过期 → 提示并保持未登录 | 429 限流 → 提示稍后重试
// 安全：安全判断在后端；客户端仅 UI 提示层（提示词 2.5 / 13.1）。

const I18N = {
  zh: { title: '登录 NodeByte 账号', sub: '同步 · DROP · 协作 · 多设备互通', account: '账号', password: '密码',
        totp: '两步验证码', login: '登 录', forgot: '忘记密码',
        err401: '账号或密码错误', err40301: '需要绑定 2FA，即将跳转绑定页…', err40302: '账号已禁用/封禁/过期',
        err429: '尝试过于频繁，请稍后再试', ok: '登录成功' },
  en: { title: 'Sign in to NodeByte', sub: 'Sync · Drop · Collab · Multi-device', account: 'Account', password: 'Password',
        totp: '2FA code', login: 'Sign in', forgot: 'Forgot password',
        err401: 'Wrong account or password', err40301: '2FA binding required, redirecting…', err40302: 'Account disabled/banned/expired',
        err429: 'Too many attempts, try later', ok: 'Signed in' }
};
let LANG = (navigator.language || 'zh').startsWith('zh') ? 'zh' : 'en';

function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const k = el.getAttribute('data-i18n');
    if (I18N[LANG][k]) el.textContent = I18N[LANG][k];
  });
  document.title = `NodeByte Browser · ${I18N[LANG].login}`;
}

function showMsg(text, ok = false) {
  const el = document.getElementById('msg');
  el.textContent = text;
  el.className = ok ? 'notice ok' : 'notice';
  el.hidden = false;
}

// Mojo 桥（nodebyte.mojom.NodeByteAccount 由 C++ 注册；需核实 bindInterface 时机）
async function getAccountBridge() {
  try {
    return await Mojo.bindInterface('nodebyte.mojom.NodeByteAccount', null, 'context', true);
  } catch (e) {
    console.warn('[nodebyte] mojo bridge unavailable, fallback to REST', e);
    return null;
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  applyI18n();
  document.getElementById('serverAddr').textContent =
    'bsync.nodebyte.cn'; // 本地偏好可覆盖；CustomLockSyncServer=true 时此处只读

  const form = document.getElementById('loginForm');
  const btn = document.getElementById('btnLogin');
  const totpRow = document.getElementById('totpRow');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    btn.disabled = true;
    const body = {
      identifier: document.getElementById('identifier').value.trim(),
      password: document.getElementById('password').value,
      totpCode: document.getElementById('totpCode').value || undefined,
      deviceName: 'NodeByte Desktop'
    };
    // 实际请求经 C++ NodeByteAccount::Login（JWT/设备ID 落本地偏好）；
    // WebUI 直连 fetch 在真实构建中由 mojo 桥替换。
    try {
      const resp = await fetch('https://bsync.nodebyte.cn/api/auth/login', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await resp.json();
      switch (data.code) {
        case 0:
          showMsg(I18N[LANG].ok, true);
          if (data.data?.require2faBind) {
            showMsg(I18N[LANG].err40301, true);
            setTimeout(() => location.href = 'nodebyte://usercenter/security/2fa', 900);
          } else {
            setTimeout(() => window.close(), 600); // 登录后回到浏览器
          }
          break;
        case 401:
          if (data.data?.needTotp) totpRow.hidden = false;
          showMsg(I18N[LANG].err401);
          break;
        case 40301:
          showMsg(I18N[LANG].err40301, true);
          setTimeout(() => location.href = 'nodebyte://usercenter/security/2fa', 900);
          break;
        case 40302:
          showMsg(I18N[LANG].err40302);
          break;
        case 429:
          showMsg(I18N[LANG].err429);
          break;
        default:
          showMsg(data.message || String(data.code));
      }
    } catch (err) {
      showMsg('network error');
    } finally {
      btn.disabled = false;
    }
  });
});
