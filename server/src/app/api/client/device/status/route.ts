import { q } from '@/lib/db';
import { CODE, ok, err, readJson } from '@/lib/status';
import { authUser, require2faBound } from '@/lib/auth';
import { emitToWs } from '@/lib/push';

export const dynamic = 'force-dynamic';

/**
 * POST /api/client/device/status  （或 WebSocket device_status，REST 落库通道）
 * body 见服务端提示词 7.4：activeTab / openTabs / proxy / fingerprintTemplateId
 * 上报后落库 user_devices.last_status + last_online_at。
 */
export async function POST(req: Request) {
  const u = await authUser(req);
  if (u instanceof Response) return u;
  const t = await require2faBound(u);
  if (t) return t;

  const body = await readJson<{
    deviceId?: string; activeTab?: { title?: string; url?: string; favicon?: string };
    openTabs?: Array<{ title?: string; url?: string; active?: boolean }>;
    proxy?: { mode?: string; server?: string };
    fingerprintTemplateId?: string;
  }>(req);
  const deviceId = body?.deviceId || u.jwtPayload.deviceId;
  if (!deviceId) return err(CODE.BAD_REQUEST, '缺少 deviceId');

  await q(
    `UPDATE user_devices SET last_online_at = now(), last_status = $2::jsonb WHERE device_id = $1 AND user_id = $3`,
    [deviceId, JSON.stringify(body ?? {}), u.userId]
  );
  // 管理端/其他设备可通过信令通道感知（此处不回传任何敏感内容）
  await emitToWs({ type: 'push_message', userId: u.userId, data: { pushType: 'device_status_ack', payload: { deviceId } } });
  return ok({ received: true, at: new Date().toISOString() });
}
