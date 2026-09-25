import { q } from '@/lib/db';
import { ok } from '@/lib/status';
import { authAdmin } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/** GET /api/admin/audit?type=&q=&page= — 审计日志查询（append-only，不可改删） */
export async function GET(req: Request) {
  const admin = await authAdmin(req);
  if (admin instanceof Response) return admin;

  const url = new URL(req.url);
  const type = url.searchParams.get('type')?.trim() ?? '';
  const search = url.searchParams.get('q')?.trim() ?? '';
  const page = Math.max(1, Number(url.searchParams.get('page') ?? 1));
  const pageSize = Math.min(200, Math.max(1, Number(url.searchParams.get('pageSize') ?? 30)));

  const conds = ['1=1'];
  const params: unknown[] = [];
  if (type) { params.push(type); conds.push(`l.operate_type = $${params.length}`); }
  if (search) {
    params.push(`%${search}%`);
    conds.push(`(tu.username ILIKE $${params.length} OR au.username ILIKE $${params.length} OR l.operate_type ILIKE $${params.length})`);
  }
  const where = conds.join(' AND ');

  const total = await q1<{ n: string }>(
    `SELECT count(*) AS n FROM admin_audit_log l
       LEFT JOIN users tu ON tu.user_id = l.operate_target_user
       LEFT JOIN users au ON au.user_id = l.admin_user_id WHERE ${where}`, params
  );
  params.push(pageSize, (page - 1) * pageSize);
  const rows = await q(
    `SELECT l.*, au.username AS admin_name, tu.username AS target_name
       FROM admin_audit_log l
       LEFT JOIN users tu ON tu.user_id = l.operate_target_user
       LEFT JOIN users au ON au.user_id = l.admin_user_id
      WHERE ${where} ORDER BY l.operate_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return ok({ total: Number(total?.n ?? 0), page, pageSize, logs: rows.rows });
}
