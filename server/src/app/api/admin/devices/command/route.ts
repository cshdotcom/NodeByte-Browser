import { q1 } from '@/lib/db';
import { CODE, ok, err, readJson } from '@/lib/status';
import { authAdmin } from '@/lib/auth';
import { adminAudit, clientIp } from '@/lib/audit';
import { emitToWs } from '@/lib/push';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/devices/command — 远程指令下发（客户端提示词附录 E.1 S→C command）
 *
 * body: { deviceId?: string, userEmail?: string, cmd: string, payload?: object }
 *   - deviceId 优先（精确到设备）；否则按 userEmail 广播到该用户全部在线设备；
 *   - cmd 白名单（附录 E.1）：open_url / close_tab / clear_cache / logout /
 *     lock_browser / switch_fingerprint / switch_proxy / enable_snapshot；
 *   - payload 按命令校验（open_url 必须 url；switch_proxy 必须 mode+server 等）；
 *   - 经 ws-service internal/emit 实时下发；设备离线时返回 offline 提示（REST 无重放，
 *     重放语义由策略指令通道承担，两者职责不同）；
 *   - 全量审计 admin_audit_log（device_remote_command）。
 */
const COMMANDS = new Set([
  'open_url', 'close_tab', 'clear_cache', 'logout',
  'lock_browser', 'switch_fingerprint', 'switch_proxy', 'enable_snapshot'
]);

function validatePayload(cmd: string, payload: Record<string, unknown> | undefined): string | null {
  switch (cmd) {
    case 'open_url':
      if (!payload?.url || typeof payload.url !== 'string' || !/^https?:\/\//i.test(payload.url)) {
        return 'open_url 需要合法的 http(s) url';
      }
      return null;
    case 'switch_proxy':
      if (!payload?.mode || !['direct', 'fixed_servers', 'system'].includes(String(payload.mode))) {
        return 'switch_proxy 需要 mode: direct | fixed_servers | system';
      }
      if (payload.mode === 'fixed_servers' && !payload.server) return 'fixed_servers 模式需要 server';
      return null;
    case 'switch_fingerprint':
      if (!payload?.templateId) return 'switch_fingerprint 需要 templateId';
      return null;
    case 'enable_snapshot':
      if (payload?.url && !/^https?:\/\//i.test(String(payload.url))) return 'enable_snapshot url 需为 http(s)';
      return null;
    default:
      // close_tab / clear_cache / logout / lock_browser 无必填参数
      return null;
  }
}

export async function POST(req: Request) {
  const admin = await authAdmin(req);
  if (admin instanceof Response) return admin;

  const body = await readJson<{
    deviceId?: string; userEmail?: string;
    cmd?: string; payload?: Record<string, unknown>;
  }>(req);
  const cmd = String(body?.cmd ?? '');
  if (!COMMANDS.has(cmd)) return err(CODE.BAD_REQUEST, '未知指令（白名单：8 种，见附录 E.1）');
  const payloadError = validatePayload(cmd, body?.payload);
  if (payloadError) return err(CODE.BAD_REQUEST, payloadError);

  const data: Record<string, unknown> = { cmd, payload: body?.payload ?? {} };

  let target = 'unknown';
  if (body?.deviceId) {
    const d = await q1<{ device_id: string; user_id: string; is_revoked: boolean }>(
      `SELECT device_id, user_id, is_revoked FROM user_devices WHERE device_id = $1`, [body.deviceId]
    );
    if (!d) return err(CODE.NOT_FOUND, '设备不存在');
    if (d.is_revoked) return err(CODE.NO_PERMISSION, '设备已吊销');
    await emitToWs({ type: 'command', deviceId: d.device_id, data });
    target = `device:${d.device_id}`;
  } else if (body?.userEmail) {
    const u = await q1<{ user_id: string; email: string }>(
      `SELECT user_id, email FROM users WHERE email = $1`, [String(body.userEmail).toLowerCase()]
    );
    if (!u) return err(CODE.NOT_FOUND, '用户不存在');
    await emitToWs({ type: 'command', userId: u.user_id, data });
    target = `user:${u.email}`;
  } else {
    return err(CODE.BAD_REQUEST, '需要 deviceId 或 userEmail 之一');
  }

  await adminAudit({
    adminUserId: admin.userId,
    operateType: 'device_remote_command',
    detail: { cmd, target, payload: body?.payload ?? {} },
    ip: clientIp(req)
  });
  return ok({ sent: true, cmd, target, note: '设备离线时指令不会重放；客户端上线后经 REST 兜底无此语义' });
}
