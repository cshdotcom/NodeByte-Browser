/**
 * NodeByte WebSocket 信令服务（独立部署，提示词 3.2.2 / 5.10）
 *
 * 协议（附录D，统一信封 { type, seq, data }）：
 *   C→S hello            { deviceId, jwt }                建连鉴权
 *   C→S device_status    { activeTab, openTabs, proxy, fingerprintTemplateId }
 *   S→C command          { cmd, payload }                 open_url/close_tab/clear_cache/logout/lock_browser/...
 *   S→C push_message     { pushType, payload, msgId }     Drop 推送（tab_page/session_context/collab_invite/notice/text）
 *   S→C session_revoked  { sharedSessionId }
 *   S→C policy_update    { policyVersion }
 *   C→S collab_create / collab_join / request_audio_publish / request_video_publish / request_control / input_event
 *   S→C media_permission / participant_update / control_grant / collab_ended
 *
 * 服务间事件：POST /internal/emit（Bearer INTERNAL_SHARED_SECRET）由 Next.js 调用。
 * 生产环境大规模长连接建议以 Go 重写本服务（协议契约不变）。
 */
import { WebSocketServer } from 'ws';
import crypto from 'node:crypto';
import pg from 'pg';

const PORT = Number(process.env.WS_PORT || 8081);
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-to-a-long-random-secret-value';
const INTERNAL_SECRET = process.env.INTERNAL_SHARED_SECRET || 'change-me-internal-secret';
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://nodebyte:nodebyte@localhost:5432/nodebyte';

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 5 });

/** deviceId → socket；userId → Set<socket> */
const devices = new Map();
const users = new Map();

// ---------------------------------------------------------------- JWT 校验（与 Next.js src/lib/crypto.ts 同构，HS256）
function b64urlToJson(s) {
  try { return JSON.parse(Buffer.from(s, 'base64url').toString()); } catch { return null; }
}
function verifyJwt(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const data = `${parts[0]}.${parts[1]}`;
  const expect = crypto.createHmac('sha256', JWT_SECRET).update(data).digest('base64url');
  const a = Buffer.from(expect), b = Buffer.from(parts[2]);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const payload = b64urlToJson(parts[1]);
  if (!payload || payload.exp <= Math.floor(Date.now() / 1000)) return null;
  return payload;
}

// ---------------------------------------------------------------- WebSocket 服务
const wss = new WebSocketServer({ port: PORT });
console.log(`[ws-service] listening on :${PORT}`);

function send(ws, type, data) {
  if (ws.readyState === 1) ws.send(JSON.stringify({ type, seq: Date.now(), data }));
}

function sendToUser(userId, type, data) {
  const set = users.get(userId);
  if (set) for (const ws of set) send(ws, type, data);
}

function sendToDevice(deviceId, type, data) {
  const ws = devices.get(deviceId);
  if (ws) send(ws, type, data);
}

wss.on('connection', (ws, req) => {
  ws.isAuthed = false;
  ws.deviceId = null;
  ws.userId = null;

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    const { type, data = {} } = msg;

    // ---- 建连鉴权：hello { deviceId, jwt } ----
    if (type === 'hello') {
      const payload = verifyJwt(data.jwt);
      if (!payload) { send(ws, 'auth_failed', { reason: 'invalid jwt' }); ws.close(); return; }
      // 设备吊销检查
      try {
        const r = await pool.query(`SELECT is_revoked FROM user_devices WHERE device_id = $1 AND user_id = $2`, [data.deviceId, payload.sub]);
        if (r.rows[0]?.is_revoked) { send(ws, 'auth_failed', { reason: 'device revoked' }); ws.close(); return; }
      } catch { /* DB 不可用时不阻塞（只读检查） */ }

      ws.isAuthed = true;
      ws.deviceId = data.deviceId;
      ws.userId = payload.sub;
      devices.set(data.deviceId, ws);
      if (!users.has(payload.sub)) users.set(payload.sub, new Set());
      users.get(payload.sub).add(ws);
      send(ws, 'hello_ok', { deviceId: data.deviceId });
      pool.query(`UPDATE user_devices SET last_online_at = now() WHERE device_id = $1`, [data.deviceId]).catch(() => undefined);
      return;
    }

    if (!ws.isAuthed) { send(ws, 'error', { reason: 'not authed, send hello first' }); return; }

    switch (type) {
      case 'device_status': {
        // 落库最新状态（提示词 7.4 / 5.10.1）
        pool.query(
          `UPDATE user_devices SET last_online_at = now(), last_status = $2::jsonb WHERE device_id = $1`,
          [ws.deviceId, JSON.stringify(data)]
        ).catch(() => undefined);
        send(ws, 'ack', { of: 'device_status' });
        break;
      }
      case 'collab_create': {
        // 会话创建经 REST 完成权威落库；此处仅透传确认（v1.1 SFU 承接媒体面）
        send(ws, 'ack', { of: 'collab_create', hint: 'use REST /api/collab/sessions' });
        break;
      }
      case 'request_audio_publish':
      case 'request_video_publish': {
        // 转发给 owner（REST 审批流已实现；此通道做低延迟通知）
        const r = await pool.query(`SELECT owner_user_id FROM collab_session WHERE session_id = $1`, [data.sessionId]);
        if (r.rows[0]) sendToUser(r.rows[0].owner_user_id, 'collab', {
          kind: 'media_request', sessionId: data.sessionId, participantId: data.participantId,
          request: type === 'request_audio_publish' ? 'audio' : 'video'
        });
        break;
      }
      case 'input_event': {
        // 输入事件仅转发给 session owner（owner 主机注入 WebMouseEvent/WebKeyboardEvent）
        const r = await pool.query(`SELECT owner_user_id FROM collab_session WHERE session_id = $1`, [data.sessionId]);
        if (r.rows[0]) sendToUser(r.rows[0].owner_user_id, 'collab', { kind: 'input_event', from: ws.userId, data });
        break;
      }
      default:
        send(ws, 'error', { reason: `unknown type: ${type}` });
    }
  });

  ws.on('close', () => {
    if (ws.deviceId) devices.delete(ws.deviceId);
    if (ws.userId && users.get(ws.userId)) {
      users.get(ws.userId).delete(ws);
      if (users.get(ws.userId).size === 0) users.delete(ws.userId);
    }
  });
});

// ---------------------------------------------------------------- 内部事件入口（Next.js → ws-service）
import http from 'node:http';
const httpServer = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/internal/emit') {
    const auth = req.headers.authorization ?? '';
    if (auth !== `Bearer ${INTERNAL_SECRET}`) { res.writeHead(401); res.end('unauthorized'); return; }
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      try {
        const ev = JSON.parse(body);
        const payload = ev.data ?? {};
        if (ev.type === 'command') {
          if (ev.deviceId) sendToDevice(ev.deviceId, 'command', payload);
          else if (ev.userId) sendToUser(ev.userId, 'command', payload);
        } else if (ev.type === 'push_message') {
          if (ev.deviceId) sendToDevice(ev.deviceId, 'push_message', payload);
          else if (ev.userId) sendToUser(ev.userId, 'push_message', payload);
        } else if (ev.type === 'session_revoked') {
          if (ev.userId) sendToUser(ev.userId, 'session_revoked', payload);
        } else if (ev.type === 'policy_update') {
          if (ev.userId) sendToUser(ev.userId, 'policy_update', payload);
          else sendAll('policy_update', payload);
        } else if (ev.type === 'collab') {
          if (ev.userId) sendToUser(ev.userId, 'collab', payload);
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, onlineDevices: devices.size, onlineUsers: users.size }));
      } catch { res.writeHead(400); res.end('bad json'); }
    });
    return;
  }
  if (req.url === '/healthz') { res.writeHead(200); res.end(JSON.stringify({ ok: true, devices: devices.size, users: users.size })); return; }
  res.writeHead(404); res.end();
});

function sendAll(type, data) {
  for (const ws of wss.clients) send(ws, type, data);
}

httpServer.listen(PORT + 100, () => console.log(`[ws-service] internal emit on :${PORT + 100}`));

process.on('SIGTERM', () => { wss.close(); httpServer.close(); pool.end(); });
