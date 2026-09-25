import { q, q1 } from '@/lib/db';
import { CODE, ok, err } from '@/lib/status';
import { authUser, require2faBound } from '@/lib/auth';
import { emitToWs } from '@/lib/push';
import { userSecurityLog, clientIp } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/**
 * GET    /api/personal/devices — 已登录设备列表
 * DELETE /api/personal/devices?deviceId=xxx — 远程吊销设备会话（吊销后信令下发强制下线）
 */
export async function GET(req: Request) {
  const u = await authUser(req);
  if (u instanceof Response) return u;
  const rows = await q(
    `SELECT device_id, device_name, device_fingerprint, last_online_at, is_revoked, created_at
       FROM user_devices WHERE user_id = $1 ORDER BY last_online_at DESC NULLS LAST`,
    [u.userId]
  );
  return ok({ devices: rows.rows });
}

export async function DELETE(req: Request) {
  const u = await authUser(req);
  if (u instanceof Response) return u;
  const deviceId = new URL(req.url).searchParams.get('deviceId') ?? '';
  const d = await q1<{ user_id: string }>(`SELECT user_id FROM user_devices WHERE device_id = $1`, [deviceId]);
  if (!d || d.user_id !== u.userId) return err(CODE.NOT_FOUND, '设备不存在');

  await q(`UPDATE user_devices SET is_revoked = true WHERE device_id = $1`, [deviceId]);
  await emitToWs({ type: 'command', deviceId, data: { cmd: 'logout', reason: 'revoked_by_user' } });
  await userSecurityLog({ userId: u.userId, eventType: 'device_revoked', detail: { deviceId }, ip: clientIp(req) });
  return ok({ revoked: true });
}
