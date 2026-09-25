import bcrypt from 'bcryptjs';
import { q, q1 } from '@/lib/db';
import { CODE, ok, err, readJson } from '@/lib/status';
import { authAdmin } from '@/lib/auth';
import { adminAudit, clientIp } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/**
 * GET  /api/admin/users — 列表（搜索 username/email；筛选 status/groupId/expired；分页）
 * POST /api/admin/users — 创建（用户名、邮箱全局唯一、初始密码、组、有效期 0=永久、独立配额、覆盖策略）
 */
export async function GET(req: Request) {
  const admin = await authAdmin(req);
  if (admin instanceof Response) return admin;

  const url = new URL(req.url);
  const search = url.searchParams.get('q')?.trim() ?? '';
  const status = url.searchParams.get('status') ?? '';
  const groupId = url.searchParams.get('groupId') ?? '';
  const expired = url.searchParams.get('expired') ?? '';
  const page = Math.max(1, Number(url.searchParams.get('page') ?? 1));
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get('pageSize') ?? 20)));

  const conds: string[] = ['1=1'];
  const params: unknown[] = [];
  if (search) {
    params.push(`%${search}%`);
    conds.push(`(u.username ILIKE $${params.length} OR u.email ILIKE $${params.length})`);
  }
  if (status) {
    params.push(status);
    conds.push(`u.account_status = $${params.length}`);
  }
  if (groupId) {
    params.push(groupId);
    conds.push(`u.group_id = $${params.length}::uuid`);
  }
  if (expired === 'true') conds.push(`(u.account_expire_at IS NOT NULL AND u.account_expire_at < now())`);
  if (expired === 'false') conds.push(`(u.account_expire_at IS NULL OR u.account_expire_at >= now())`);

  const where = conds.join(' AND ');
  const total = await q1<{ n: string }>(`SELECT count(*) AS n FROM users u WHERE ${where}`, params);
  params.push(pageSize, (page - 1) * pageSize);
  const rows = await q(
    `SELECT u.user_id, u.username, u.email, u.is_admin, u.account_status, u.account_expire_at,
            u.override_cloud_quota_mb, u.override_policy_json IS NOT NULL AS has_override, u.created_at, u.last_login_at,
            g.group_name, COALESCE(uo.used, 0) AS used_bytes
       FROM users u
       LEFT JOIN user_group g ON g.group_id = u.group_id
       LEFT JOIN user_cloud_usage uo ON uo.user_id = u.user_id
      WHERE ${where}
      ORDER BY u.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return ok({ total: Number(total?.n ?? 0), page, pageSize, users: rows.rows });
}

export async function POST(req: Request) {
  const admin = await authAdmin(req);
  if (admin instanceof Response) return admin;

  const body = await readJson<{
    username?: string; email?: string; password?: string; groupId?: string | null;
    accountValidDays?: number; overrideQuotaMb?: number | null; accountStatus?: string; overridePolicyJson?: unknown;
  }>(req);
  if (!body?.username?.trim() || !body?.email?.trim() || !body?.password || body.password.length < 8)
    return err(CODE.BAD_REQUEST, '用户名/邮箱/初始密码（>=8位）必填');

  const dup = await q1(`SELECT 1 AS x FROM users WHERE email = $1`, [body.email.trim().toLowerCase()]);
  if (dup) return err(CODE.CONFLICT, '邮箱已被注册');

  const expireAt = Number(body.accountValidDays ?? 0) > 0 ? new Date(Date.now() + Number(body.accountValidDays) * 86400_000) : null;
  const validStatus = ['active', 'disabled'].includes(body.accountStatus ?? '') ? body.accountStatus : 'active';

  const u = await q1<{ user_id: string; account_expire_at: Date | null }>(
    `INSERT INTO users (username, email, password_hash, group_id, account_expire_at, override_cloud_quota_mb, account_status, override_policy_json)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb) RETURNING user_id, account_expire_at`,
    [
      body.username.trim(), body.email.trim().toLowerCase(), await bcrypt.hash(body.password, 10),
      body.groupId || null, expireAt,
      body.overrideQuotaMb ?? null, validStatus,
      body.overridePolicyJson ? JSON.stringify(body.overridePolicyJson) : null
    ]
  );
  if (u && body.groupId) {
    await q(`INSERT INTO user_group_member (user_id, group_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [u.user_id, body.groupId]);
  }
  await adminAudit({
    adminUserId: admin.userId, targetUserId: u?.user_id ?? null, operateType: 'create_user',
    detail: { email: body.email, groupId: body.groupId }, ip: clientIp(req)
  });
  return ok({ userId: u?.user_id, accountExpireAt: u?.account_expire_at });
}
