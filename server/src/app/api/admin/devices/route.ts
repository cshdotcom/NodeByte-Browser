import { q } from '@/lib/db';
import { ok } from '@/lib/status';
import { authAdmin } from '@/lib/auth';
import { adminAudit, clientIp } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/devices — 全量设备列表（管理员「设备与远程指令」面板数据源）
 * 返回：设备 ID / 名称 / 所属用户 / 最后在线 / last_status（activeTab、openTabs、
 * proxy、fingerprintTemplateId —— 客户端 device_status 上报的快照）/ 吊销状态。
 * 在线判定：last_online_at 距今 90 秒内视为在线（device_status 上报间隔 30s）。
 */
export async function GET(req: Request) {
  const admin = await authAdmin(req);
  if (admin instanceof Response) return admin;

  const rows = await q(
    `SELECT d.device_id, d.device_name, d.device_fingerprint, d.last_online_at, d.last_status,
            d.is_revoked, d.created_at,
            u.user_id, u.username, u.email,
            (d.last_online_at IS NOT NULL AND d.last_online_at > now() - interval '90 seconds') AS online
       FROM user_devices d
       JOIN users u ON u.user_id = d.user_id
      ORDER BY online DESC, d.last_online_at DESC NULLS LAST
      LIMIT 500`
  );
  await adminAudit({
    adminUserId: admin.userId,
    operateType: 'device_list_viewed',
    detail: { count: rows.rows.length },
    ip: clientIp(req)
  });
  return ok({
    devices: rows.rows.map((r: Record<string, unknown>) => ({
      ...r,
      last_status: typeof r.last_status === 'string' ? safeParse(r.last_status as string) : r.last_status
    }))
  });
}

function safeParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return {}; }
}
