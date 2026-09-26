// nodebyte://drop —— Drop 侧边栏应用（客户端提示词 5.4 / F.4）
// 业务逻辑在 JS；原生能力经 Mojo：nodebyte.mojom.NodeByteDrop / NodeByteCollab（v1.4.5）
// 策略置灰：allow_drop_file_screenshot=false → 发送文件/截图按钮置灰（后端同样校验）
//           AllowDropCollaboration=false → 协作 tab 整体禁用（服务端同样拒绝）
//
// WS 信令（附录 D/E）：连接由本页 JS 持有（低侵入：业务不进 C++）：
//   hello(jwt) → device_status 定时上报（60s）→ S→C command（远程指令，经 Mojo
//   ExecuteRemoteCommand 执行）→ S→C collab 事件（媒体申请/审批/参与者/rtc_relay）。
// WebRTC：媒体流 P2P（SDP/ICE 经 ws rtc_relay 中继）；media_permission 放行前
//   不向 PeerConnection 添加任何本地轨道（服务端为唯一权威，附录 E.2 要点）。

const I18N = {
  zh: { messages: '消息', files: '文件', sessions: 'Cookie 会话', collab: '协作',
        pushTab: '推送当前标签页', sendText: '发送文本到设备', sendFile: '发送文件',
        shotTab: '网页截图', shotDesktop: '桌面截图', newSess: '新建会话集',
        startCollab: '发起协作会话', joinCollab: '邀请码加入', refreshCollab: '刷新',
        ownedSessions: '我发起的会话', joinedSessions: '我参与的会话',
        reqAudio: '申请开麦', reqVideo: '申请开摄像头', muteAll: '全体静音',
        cameraAll: '全体关闭摄像头', endSession: '结束会话', kick: '踢出',
        mute: '静音', unmute: '解除静音', disableCamera: '关摄像头',
        grantControl: '授予控制权', revokeControl: '收回控制权',
        pendingApprovals: '待审批的媒体申请', approve: '批准', deny: '拒绝',
        sessHint: '访问网站时检测域名 → 选择会话集 → 内核注入隔离存储分区（不污染默认 Cookie 库）',
        collabHint: '有效期链接 · 邮箱批量邀请 · 媒体申请由发起方审批 · 服务端不放行不建立轨道',
        disabledByPolicy: '已被组织策略禁用', revoked: '已撤销',
        wsOn: '信令已连接', wsOff: 'WS 未连接', wsRetry: '重连中…',
        collabByPolicy: '协作已被组织策略关闭（AllowDropCollaboration）',
        inviteTitle: '分享邀请链接', copied: '已复制' },
  en: { messages: 'Messages', files: 'Files', sessions: 'Cookie Sets', collab: 'Collab',
        pushTab: 'Push current tab', sendText: 'Send text', sendFile: 'Send file',
        shotTab: 'Tab screenshot', shotDesktop: 'Desktop screenshot', newSess: 'New cookie set',
        startCollab: 'Start collab session', joinCollab: 'Join by token', refreshCollab: 'Refresh',
        ownedSessions: 'Sessions I own', joinedSessions: 'Sessions I joined',
        reqAudio: 'Request mic', reqVideo: 'Request camera', muteAll: 'Mute all',
        cameraAll: 'Cameras off (all)', endSession: 'End session', kick: 'Kick',
        mute: 'Mute', unmute: 'Unmute', disableCamera: 'Cam off',
        grantControl: 'Grant control', revokeControl: 'Revoke control',
        pendingApprovals: 'Pending media requests', approve: 'Approve', deny: 'Deny',
        sessHint: 'Domain detected → pick a cookie set → kernel injects into isolated partition',
        collabHint: 'Expiring links · bulk email invite · media needs owner approval',
        disabledByPolicy: 'Disabled by policy', revoked: 'Revoked',
        wsOn: 'Signaling online', wsOff: 'WS offline', wsRetry: 'Reconnecting…',
        collabByPolicy: 'Collab disabled by policy (AllowDropCollaboration)',
        inviteTitle: 'Share invite link', copied: 'Copied' }
};
const LANG = (navigator.language || 'zh').startsWith('zh') ? 'zh' : 'en';

function t(k) { return I18N[LANG][k] || k; }

// ---- Mojo 桥（真实构建中由 C++ 提供；失败时降级为演示态）----
let bridge = null;        // nodebyte.mojom.NodeByteDrop
let collab = null;        // nodebyte.mojom.NodeByteCollab
let collabAllowed = false;
async function initBridge() {
  try {
    bridge = Mojo.bindInterface('nodebyte.mojom.NodeByteDrop', null, 'context', true);
  } catch (e) { bridge = null; }
  try {
    collab = Mojo.bindInterface('nodebyte.mojom.NodeByteCollab', null, 'context', true);
  } catch (e) { collab = null; }
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
      const item = li(`<span class="badge">协作邀请</span>${m.payload.from || ''}<div class="t">session ${m.payload.sessionId || ''}</div>`, revoked);
      if (!revoked && m.payload.sessionId) {
        const btn = document.createElement('button');
        btn.textContent = t('joinCollab');
        btn.addEventListener('click', () => openSessionDetail(m.payload.sessionId));
        item.appendChild(btn);
      }
      list.appendChild(item);
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

// =====================================================================
// 协作 + 远程（v1.4.5；提示词 5.9 / 附录 E.1-E.2）
// =====================================================================

let ws = null;
let wsRetryMs = 1000;
let statusTimer = null;
let currentSessionId = null;
let myUserId = null;
let isOwnerHere = false;
let participants = [];
const pendingApprovals = [];   // { participantId, request, from }
const peer = { pc: null, localStream: null, allowAudio: false, allowVideo: false };

function setWsState(txt, cls) {
  const el = document.getElementById('wsState');
  if (el) { el.textContent = txt; el.className = 'badge ' + (cls || ''); }
}

// ---- WS 信令：建连 / hello / 心跳上报 / 重连退避 ----
async function connectSignal() {
  if (!collab || !collabAllowed) return;
  try {
    const r = await collab.getWsAuth();
    if (!r.collabAllowed) {
      setWsState(t('collabByPolicy'), 'warn');
      return;
    }
    // ws_url 由 C++ 按 ApiBase() 动态推导（可塑性铁律）；WebUI 域下拼绝对地址
    const url = String(r.wsUrl || '/ws').startsWith('ws')
      ? r.wsUrl
      : (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + (r.wsUrl || '/ws');
    ws = new WebSocket(url);
    ws.onopen = () => {
      wsRetryMs = 1000;
      send('hello', { deviceId: r.deviceId, jwt: r.jwt });
      setWsState(t('wsOn'), 'ok');
      reportStatus();
      clearInterval(statusTimer);
      statusTimer = setInterval(reportStatus, 60000);
    };
    ws.onmessage = (ev) => { try { onSignal(JSON.parse(ev.data)); } catch {} };
    ws.onclose = ws.onerror = () => {
      setWsState(t('wsRetry'), 'warn');
      clearInterval(statusTimer);
      setTimeout(connectSignal, wsRetryMs);
      wsRetryMs = Math.min(wsRetryMs * 2, 30000);
    };
  } catch (e) { setWsState(t('wsOff'), 'warn'); }
}

function send(type, data) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type, seq: Date.now(), data }));
}

// device_status 上报（附录 E.1：activeTab / openTabs / proxy / fingerprintTemplateId）
async function reportStatus() {
  if (!collab) return;
  try {
    const r = await collab.getDeviceStatus();
    const status = JSON.parse(r.statusJson || '{}');
    send('device_status', status);
  } catch {}
}

// ---- S→C 消息分发 ----
function onSignal(msg) {
  const { type, data } = msg;
  if (type === 'command') return onRemoteCommand(data);
  if (type === 'push_message') return window.__nodebyteDropPush && window.__nodebyteDropPush(JSON.stringify(data));
  if (type === 'collab') return onCollabEvent(data);
  if (type === 'policy_update') { /* 策略即时重拉（C++ 通道），侧边栏仅刷新置灰 */ }
}

// ---- 远程指令（附录 E.1 S→C command → Mojo 白名单执行）----
async function onRemoteCommand(data) {
  if (!collab) return;
  try {
    await collab.executeRemoteCommand(String(data.cmd || ''), JSON.stringify(data.payload || {}));
  } catch {}
}

// ---- 协作事件（附录 E.2 S→C）----
function onCollabEvent(d) {
  if (!d) return;
  switch (d.kind) {
    case 'participant_joined':
    case 'participant_update':
      if (currentSessionId && d.sessionId === currentSessionId) {
        participants = d.participants || [];
        renderParticipants();
        if (d.participants) {
          const me = participants.find((p) => p.user_id === myUserId);
          if (me) { peer.allowAudio = !!me.allow_send_audio; peer.allowVideo = !!me.allow_send_video; renderMyPerm(); }
        }
      }
      break;
    case 'media_request':
      pendingApprovals.push(d);
      renderApprovals();
      break;
    case 'media_permission':
      if (d.allowAudio !== undefined) peer.allowAudio = !!d.allowAudio;
      if (d.allowVideo !== undefined) peer.allowVideo = !!d.allowVideo;
      renderMyPerm();
      publishApprovedTracks();
      break;
    case 'control_grant':
      setRtcState(`control → ${d.mode}`);
      break;
    case 'collab_ended':
      teardownRtc();
      closeDetail();
      loadSessions();
      break;
    case 'rtc':
      onRtcSignal(d);
      break;
    case 'input_event':
      // owner 主机注入 WebMouseEvent/WebKeyboardEvent（C++ 侧原子能力，二期注入点）
      break;
  }
}

// ---- 会话列表（REST 经 Mojo）----
async function loadSessions() {
  if (!collab) return;
  try {
    const r = await collab.getSessions();
    if (r.businessCode !== 0) return;
    const owned = JSON.parse(r.ownedJson || '[]');
    const joined = JSON.parse(r.joinedJson || '[]');
    const oEl = document.getElementById('collabOwned');
    const jEl = document.getElementById('collabJoined');
    oEl.innerHTML = ''; jEl.innerHTML = '';
    owned.forEach((s) => {
      const el = li(`<span class="badge ok">owner</span>${s.session_id.slice(0, 8)}…<div class="t">在线 ${s.online_count} · ${s.token_expire_at ? new Date(s.token_expire_at).toLocaleString() : '永久'}</div>`);
      const btn = document.createElement('button');
      btn.textContent = t('inviteTitle');
      btn.addEventListener('click', () => showInvite(s.share_token));
      const open = document.createElement('button');
      open.textContent = '管理';
      open.addEventListener('click', () => openSessionDetail(s.session_id, true));
      el.appendChild(btn); el.appendChild(open);
      oEl.appendChild(el);
    });
    joined.forEach((s) => {
      const el = li(`<span class="badge">${s.role || 'viewer'}</span>${s.session_id.slice(0, 8)}…<div class="t">owner ${s.owner_name}</div>`);
      const open = document.createElement('button');
      open.textContent = '进入';
      open.addEventListener('click', () => openSessionDetail(s.session_id, false));
      el.appendChild(open);
      jEl.appendChild(el);
    });
  } catch {}
}

function showInvite(token) {
  const link = `${location.origin}/collab/join?token=${token}`;
  prompt(t('inviteTitle'), link);
}

// ---- 会话详情（参与者/管控/媒体申请/WebRTC）----
async function openSessionDetail(sessionId, ownerFlag) {
  if (!collab) return;
  currentSessionId = sessionId;
  document.getElementById('collabDetail').hidden = false;
  document.getElementById('collabDetailTitle').textContent = `会话 ${sessionId.slice(0, 8)}…`;
  try {
    const r = await collab.getParticipants(sessionId);
    if (r.businessCode !== 0) return;
    const detail = JSON.parse(r.participantsJson || '{}');
    participants = detail.participants || [];
    isOwnerHere = ownerFlag !== undefined ? ownerFlag : !!detail.isOwner;
    const me = participants.find((p) => p.user_id === myUserId);
    if (me) { peer.allowAudio = !!me.allow_send_audio; peer.allowVideo = !!me.allow_send_video; }
    document.getElementById('ownerRow').hidden = !isOwnerHere;
    renderParticipants();
    renderMyPerm();
    send('collab_join', { sessionId });
  } catch {}
}

function closeDetail() {
  currentSessionId = null;
  document.getElementById('collabDetail').hidden = true;
}

function renderParticipants() {
  const list = document.getElementById('participantList');
  list.innerHTML = '';
  participants.forEach((p) => {
    const badges = [
      `<span class="badge">${p.role || 'viewer'}</span>`,
      p.is_muted ? '<span class="badge warn">🔇</span>' : '',
      p.is_camera_disabled ? '<span class="badge warn">📷</span>' : ''
    ].join('');
    const el = li(`${badges} ${p.username || p.user_id}<div class="t">${p.email || ''}</div>`);
    if (isOwnerHere && p.role !== 'owner') {
      [[t('mute'), 'mute'], [t('unmute'), 'unmute'], [t('disableCamera'), 'disable_camera'],
       [t('grantControl'), 'grant_control'], [t('revokeControl'), 'revoke_control'], [t('kick'), 'kick']]
        .forEach(([label, action]) => {
          const b = document.createElement('button');
          b.textContent = label;
          b.addEventListener('click', () => moderate(action, p.participant_id));
          el.appendChild(b);
        });
    }
    list.appendChild(el);
  });
}

function renderMyPerm() {
  const el = document.getElementById('myPerm');
  if (el) el.textContent = `🎤 ${peer.allowAudio ? '✓' : '×'} · 📷 ${peer.allowVideo ? '✓' : '×'}（服务端权威）`;
}

function setRtcState(txt) {
  const el = document.getElementById('rtcState');
  if (el) el.textContent = txt;
}

async function moderate(action, participantId) {
  if (!collab || !currentSessionId) return;
  try { await collab.moderate(currentSessionId, action, participantId || ''); } catch {}
  setTimeout(openSessionDetailRefresh, 400);
}
function openSessionDetailRefresh() {
  if (currentSessionId) openSessionDetail(currentSessionId, isOwnerHere);
}

// ---- 审批（owner：media_request → approve/deny → REST PATCH 权威落库 + WS 通知）----
function renderApprovals() {
  const box = document.getElementById('approvalBox');
  const list = document.getElementById('approvalList');
  box.hidden = pendingApprovals.length === 0;
  list.innerHTML = '';
  pendingApprovals.forEach((req) => {
    const el = li(`<span class="badge">${req.request === 'audio' ? '🎤' : '📷'}</span>${req.from || req.participantId}`);
    const yes = document.createElement('button');
    yes.textContent = t('approve');
    yes.addEventListener('click', async () => {
      // 审批走 REST 权威通道：approve_audio/approve_video → C++ Moderate →
      // PATCH /api/collab/sessions/[id]/participants { approve:true, request } →
      // 服务端改库（唯一权威）+ emitToWs 回推 media_permission，客户端收到后才上轨道
      try { await collab.moderate(req.sessionId, `approve_${req.request}`, req.participantId); } catch {}
      pendingApprovals.splice(pendingApprovals.indexOf(req), 1);
      renderApprovals();
    });
    const no = document.createElement('button');
    no.textContent = t('deny');
    no.addEventListener('click', async () => {
      try { await collab.moderate(req.sessionId, `deny_${req.request}`, req.participantId); } catch {}
      pendingApprovals.splice(pendingApprovals.indexOf(req), 1);
      renderApprovals();
    });
    el.appendChild(yes); el.appendChild(no);
    list.appendChild(el);
  });
}

// ---- WebRTC P2P（信令 rtc_relay；media_permission 放行前不添加本地轨道）----
async function publishApprovedTracks() {
  if (!currentSessionId) return;
  const needAudio = peer.allowAudio, needVideo = peer.allowVideo;
  if (!needAudio && !needVideo) return;
  if (!peer.localStream) {
    try {
      peer.localStream = await navigator.mediaDevices.getUserMedia({
        audio: needAudio, video: needVideo
      });
    } catch { setRtcState('local media denied'); return; }
  }
  ensurePc();
  peer.localStream.getTracks().forEach((track) => {
    const kind = track.kind === 'audio' ? 'audio' : 'video';
    const allowed = kind === 'audio' ? peer.allowAudio : peer.allowVideo;
    if (!allowed) return; // 未放行不上轨道（即使本地硬件已打开）
    const sender = peer.pc.getSenders().find((s) => s.track && s.track.kind === kind);
    if (sender) sender.replaceTrack(track); else peer.pc.addTrack(track, peer.localStream);
  });
}

function ensurePc() {
  if (peer.pc) return peer.pc;
  const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  pc.onicecandidate = (ev) => {
    if (ev.candidate && currentSessionId) {
      const target = participants.find((p) => p.user_id !== myUserId);
      if (target) send('rtc_relay', { sessionId: currentSessionId, toUserId: target.user_id, payload: { ice: ev.candidate.toJSON() } });
    }
  };
  pc.ontrack = (ev) => {
    const v = document.getElementById('remoteVideo');
    if (v) { v.srcObject = ev.streams[0]; setRtcState('receiving media'); }
  };
  peer.pc = pc;
  return pc;
}

async function onRtcSignal(d) {
  if (!currentSessionId || d.sessionId !== currentSessionId) return;
  const pl = d.payload || {};
  const pc = ensurePc();
  try {
    if (pl.sdp) {
      await pc.setRemoteDescription({ type: pl.sdp.type, sdp: pl.sdp.sdp });
      if (pl.sdp.type === 'offer') {
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        send('rtc_relay', { sessionId: currentSessionId, toUserId: d.from, payload: { sdp: { type: answer.type, sdp: answer.sdp } } });
      }
    } else if (pl.ice) {
      await pc.addIceCandidate(pl.ice);
    }
  } catch (e) { setRtcState('rtc error'); }
}

function teardownRtc() {
  if (peer.pc) { try { peer.pc.close(); } catch {} peer.pc = null; }
  if (peer.localStream) { peer.localStream.getTracks().forEach((tr) => tr.stop()); peer.localStream = null; }
  peer.allowAudio = peer.allowVideo = false;
  setRtcState('');
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

document.getElementById('btnCollabCreate').addEventListener('click', async () => {
  if (!collab) return;
  const hours = Number(prompt('会话有效期（小时，0=永久）：', '24') || 24);
  try {
    const r = await collab.createSession(hours, true, 8);
    if (r.businessCode === 0 && r.shareToken) showInvite(r.shareToken);
    loadSessions();
  } catch {}
});

document.getElementById('btnCollabJoin').addEventListener('click', async () => {
  if (!collab) return;
  const token = prompt('邀请码 / token：');
  if (!token) return;
  try {
    const r = await collab.joinByToken(token.trim());
    if (r.businessCode === 0 && r.sessionId) openSessionDetail(r.sessionId, false);
  } catch {}
});

document.getElementById('btnCollabRefresh').addEventListener('click', loadSessions);
document.getElementById('btnReqAudio').addEventListener('click', () => currentSessionId && send('request_audio_publish', { sessionId: currentSessionId }));
document.getElementById('btnReqVideo').addEventListener('click', () => currentSessionId && send('request_video_publish', { sessionId: currentSessionId }));
document.getElementById('btnMuteAll').addEventListener('click', () => moderate('mute_all', ''));
document.getElementById('btnCameraAll').addEventListener('click', () => moderate('camera_all', ''));
document.getElementById('btnEndSession').addEventListener('click', async () => {
  if (!collab || !currentSessionId) return;
  try { await collab.endSession(currentSessionId); } catch {}
  teardownRtc(); closeDetail(); loadSessions();
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
  await loadSessions();
  await connectSignal();
})();
