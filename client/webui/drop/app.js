// nodebyte://drop —— Drop 侧边栏应用（客户端提示词 5.4 / F.4）
// 业务逻辑在 JS；原生能力经 Mojo：nodebyte.mojom.NodeByteDrop
// 策略置灰：allow_drop_file_screenshot=false → 发送文件/截图按钮置灰（后端同样校验）

const I18N = {
  zh: { messages: '消息', files: '文件', sessions: 'Cookie 会话', collab: '协作',
        pushTab: '推送当前标签页', sendText: '发送文本到设备', sendFile: '发送文件',
        shotTab: '网页截图', shotDesktop: '桌面截图', newSess: '新建会话集',
        startCollab: '发起协作会话',
        sessHint: '访问网站时检测域名 → 选择会话集 → 内核注入隔离存储分区（不污染默认 Cookie 库）',
        collabHint: '有效期链接 · 邮箱批量邀请 · 媒体申请由发起方审批 · 服务端不放行不建立轨道',
        disabledByPolicy: '已被组织策略禁用', revoked: '已撤销' },
  en: { messages: 'Messages', files: 'Files', sessions: 'Cookie Sets', collab: 'Collab',
        pushTab: 'Push current tab', sendText: 'Send text', sendFile: 'Send file',
        shotTab: 'Tab screenshot', shotDesktop: 'Desktop screenshot', newSess: 'New cookie set',
        startCollab: 'Start collab session',
        sessHint: 'Domain detected → pick a cookie set → kernel injects into isolated partition',
        collabHint: 'Expiring links · bulk email invite · media needs owner approval',
        disabledByPolicy: 'Disabled by policy', revoked: 'Revoked' }
};
const LANG = (navigator.language || 'zh').startsWith('zh') ? 'zh' : 'en';

function t(k) { return I18N[LANG][k] || k; }

// ---- Mojo 桥（真实构建中由 C++ 提供；失败时降级为演示态）----
let bridge = null;
async function initBridge() {
  try {
    bridge = Mojo.bindInterface('nodebyte.mojom.NodeByteDrop', null, 'context', true);
  } catch (e) { bridge = null; }
}

// ---- Tab 切换 ----
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
    document.querySelectorAll('.panel').forEach((x) => x.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`panel-${tab.dataset.tab}`).classList.add('active');
  });
});

function li(html, cls = '') {
  const el = document.createElement('li');
  el.className = cls;
  el.innerHTML = html;
  return el;
}

// ---- 消息 ----
function renderMessages(messages) {
  const list = document.getElementById('msgList');
  list.innerHTML = '';
  (messages || []).forEach((m) => {
    const revoked = m.revoked ? ' revoked' : '';
    if (m.pushType === 'tab_page') {
      list.appendChild(li(`<span class="badge">标签页</span><a href="#" data-url="${m.payload.url}">${m.payload.title || m.payload.url}</a><div class="t">from ${m.payload.from || ''}</div>`, revoked));
    } else if (m.pushType === 'session_context') {
      list.appendChild(li(`<span class="badge">登录上下文</span>接受 / 拒绝 · <span class="muted">${m.payload.from || ''}</span>`, revoked));
    } else if (m.pushType === 'collab_invite') {
      list.appendChild(li(`<span class="badge">协作邀请</span>${m.payload.from || ''}`, revoked));
    } else {
      list.appendChild(li(`<span class="badge">通知</span>${m.payload.text || ''}`, revoked));
    }
  });
}

// ---- 文件 ----
function renderFiles(files) {
  const list = document.getElementById('fileList');
  list.innerHTML = '';
  (files || []).forEach((f) => {
    list.appendChild(li(`<span class="badge">${f.fileType}</span>${f.fileName}<div class="t">${(f.sizeBytes / 1024).toFixed(1)} KB · ${new Date(f.createdAt).toLocaleString()}</div>`));
  });
}

// ---- Cookie 会话集（展示 + 选择；数据经 Mojo/内核加密 SQLite 查询）----
function renderSessions(sets) {
  const list = document.getElementById('sessList');
  list.innerHTML = '';
  (sets || []).forEach((s) => {
    const el = li(`<span class="badge ${s.effective ? '' : 'warn'}">${s.effective ? '可用' : t('revoked')}</span>${s.displayName || s.id}<div class="t">${s.domainRule} · ${s.sourceLabel || '本机'}</div>`);
    el.addEventListener('click', () => bridge && bridge.useSharedSession(s.id));
    list.appendChild(el);
  });
}

// ---- 事件绑定 ----
document.getElementById('btnPushTab').addEventListener('click', async () => {
  const emails = prompt(t('pushTab') + ' → 邮箱（逗号/空格分隔，可空）') || '';
  if (bridge) {
    // 当前标签页 URL/标题由 C++ 侧注入（GetActiveTab）
    bridge.pushTab('', '', emails.split(/[\s,]+/).filter(Boolean), []);
  }
});

document.getElementById('btnUpload').addEventListener('click', () => bridge && bridge.pickAndUploadFiles());
document.getElementById('btnShotTab').addEventListener('click', () => bridge && bridge.captureTabScreenshot());
document.getElementById('btnShotDesktop').addEventListener('click', () => {
  // Android 无桌面截图（能力差异：返回 supported=false 并置灰）
  if (bridge) bridge.captureDesktopScreenshot();
});

document.getElementById('btnNewSess').addEventListener('click', () => {
  const name = prompt(t('newSess') + ' · 备注：');
  const domain = prompt('域名规则（如 example.com / *.example.com）：') || '';
  if (name !== null && domain) {
    renderSessions([{ id: 'new', displayName: name, domainRule: domain, effective: true }]);
  }
});

document.getElementById('btnCollabCreate').addEventListener('click', () => {
  const hours = Number(prompt('会话有效期（小时，0=永久）：', '24') || 24);
  if (bridge) bridge.createSession(hours, true, 8);
});

// 服务端推送到达（C++ OnServerPush → window.__nodebyteDropPush）
window.__nodebyteDropPush = (payloadJson) => {
  try { renderMessages([JSON.parse(payloadJson)]); } catch {}
};

// 初始化
(async () => {
  await initBridge();
  // 策略置灰（数据来自 NodeBytePolicy::GetSensitiveFields / feature 黑白名单）
  const policyBlocked = false; // 由 C++ 注入实际策略值
  ['btnUpload', 'btnShotTab', 'btnShotDesktop'].forEach((id) => {
    const b = document.getElementById(id);
    if (policyBlocked) { b.disabled = true; b.title = t('disabledByPolicy'); }
  });
  renderMessages([]);
  renderFiles([]);
  renderSessions([]);
})();
