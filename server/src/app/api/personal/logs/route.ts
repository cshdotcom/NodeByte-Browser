import { q } from '@/lib/db';
import { ok } from '@/lib/status';
import { authUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/personal/logs?type=security|sync&limit=100
 * 账号安全日志（登录/改密/2FA 变更）与同步/DROP 历史（同表分事件类型）。
 */
export async function GET(req: Request) {
  const u = await authUser(req);
  if (u instanceof Response) return u;
  const type = new URL(req.url).searchParams.get('type') ?? 'security';
  const limit = Math.min(Number(new URL(req.url).searchParams.get('limit') ?? 100), 300);

  const rows = await q(
    `SELECT log_id, event_type, detail, ip_address, created_at
       FROM user_security_log WHERE user_id = $1 AND event_type LIKE $2
      ORDER BY created_at DESC LIMIT $3`,
    [u.userId, type === 'sync' ? 'sync%' : '%', limit]
  );
  return ok({ logs: rows.rows });
}
