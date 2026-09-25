import { q, q1 } from '@/lib/db';
import { ok } from '@/lib/status';
import { authAdmin } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/** GET /api/admin/stats — 后台概览（用户/设备/存储/协作/审计计数） */
export async function GET(req: Request) {
  const admin = await authAdmin(req);
  if (admin instanceof Response) return admin;

  const users = await q1<{ n: string }>(`SELECT count(*) AS n FROM users`);
  const activeUsers = await q1<{ n: string }>(`SELECT count(*) AS n FROM users WHERE account_status='active'`);
  const devices = await q1<{ n: string }>(`SELECT count(*) AS n FROM user_devices WHERE is_revoked=false`);
  const storage = await q1<{ s: string }>(`SELECT COALESCE(SUM(used_bytes),0)::text AS s FROM user_cloud_usage`);
  const files = await q1<{ n: string }>(`SELECT count(*) AS n FROM user_file_meta`);
  const sessions = await q1<{ n: string }>(`SELECT count(*) AS n FROM collab_session WHERE is_active=true`);
  const audits = await q1<{ n: string }>(`SELECT count(*) AS n FROM admin_audit_log`);
  const recent = await q(
    `SELECT l.operate_type, l.operate_at, au.username AS admin_name, tu.username AS target_name
       FROM admin_audit_log l
       LEFT JOIN users au ON au.user_id = l.admin_user_id
       LEFT JOIN users tu ON tu.user_id = l.operate_target_user
      ORDER BY l.operate_at DESC LIMIT 10`
  );
  return ok({
    users: Number(users?.n ?? 0),
    activeUsers: Number(activeUsers?.n ?? 0),
    devices: Number(devices?.n ?? 0),
    storageBytes: Number(storage?.s ?? 0),
    files: Number(files?.n ?? 0),
    activeCollabSessions: Number(sessions?.n ?? 0),
    auditCount: Number(audits?.n ?? 0),
    recentAudits: recent.rows
  });
}
