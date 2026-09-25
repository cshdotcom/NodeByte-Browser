import { q, q1 } from '@/lib/db';
import { CODE, ok, err, readJson } from '@/lib/status';
import { authAdmin } from '@/lib/auth';
import { adminAudit, clientIp } from '@/lib/audit';
import { emitToWs } from '@/lib/push';

export const dynamic = 'force-dynamic';

/**
 * 策略集 CRUD（可视化编辑器后端）：
 * GET   /api/admin/policy-sets
 * POST  /api/admin/policy-sets        { name, mandatory, recommended, sensitiveFields }
 * PATCH /api/admin/policy-sets        { policySetId, name?, mandatory?, recommended?, sensitiveFields? }
 * DELETE /api/admin/policy-sets?id=   （未绑定组时才可删）
 * 保存后向受影响组用户广播 policy_update。
 */
export async function GET(req: Request) {
  const admin = await authAdmin(req);
  if (admin instanceof Response) return admin;
  const rows = await q(`SELECT *, (SELECT count(*) FROM user_group g WHERE g.policy_set_id = policy_set.policy_set_id) AS group_count FROM policy_set ORDER BY created_at DESC`);
  return ok({ policySets: rows.rows });
}

export async function POST(req: Request) {
  const admin = await authAdmin(req);
  if (admin instanceof Response) return admin;
  const body = await readJson<{ name?: string; mandatory?: Record<string, unknown>; recommended?: Record<string, unknown>; sensitiveFields?: string[] }>(req);
  if (!body?.name?.trim()) return err(CODE.BAD_REQUEST, '策略集名称必填');
  const r = await q1<{ policy_set_id: string }>(
    `INSERT INTO policy_set (name, mandatory_json, recommended_json, sensitive_fields)
     VALUES ($1, $2::jsonb, $3::jsonb, $4) RETURNING policy_set_id`,
    [body.name.trim(), JSON.stringify(body.mandatory ?? {}), JSON.stringify(body.recommended ?? {}), body.sensitiveFields ?? []]
  );
  await adminAudit({ adminUserId: admin.userId, operateType: 'create_policy_set', detail: { name: body.name }, ip: clientIp(req) });
  return ok({ policySetId: r?.policy_set_id });
}

export async function PATCH(req: Request) {
  const admin = await authAdmin(req);
  if (admin instanceof Response) return admin;
  const body = await readJson<{
    policySetId?: string; name?: string; mandatory?: Record<string, unknown>;
    recommended?: Record<string, unknown>; sensitiveFields?: string[];
  }>(req);
  if (!body?.policySetId) return err(CODE.BAD_REQUEST, '缺少 policySetId');

  await q(
    `UPDATE policy_set SET
       name = COALESCE($2, name),
       mandatory_json = COALESCE($3::jsonb, mandatory_json),
       recommended_json = COALESCE($4::jsonb, recommended_json),
       sensitive_fields = COALESCE($5, sensitive_fields)
     WHERE policy_set_id = $1`,
    [body.policySetId, body.name ?? null, body.mandatory ? JSON.stringify(body.mandatory) : null,
     body.recommended ? JSON.stringify(body.recommended) : null, body.sensitiveFields ?? null]
  );
  // 通知绑定该策略集的用户重拉策略
  const users = await q<{ user_id: string }>(
    `SELECT DISTINCT u.user_id FROM users u JOIN user_group g ON g.group_id = u.group_id WHERE g.policy_set_id = $1`,
    [body.policySetId]
  );
  for (const row of users.rows) await emitToWs({ type: 'policy_update', userId: row.user_id, data: {} });

  await adminAudit({ adminUserId: admin.userId, operateType: 'modify_policy_set', detail: { policySetId: body.policySetId }, ip: clientIp(req) });
  return ok(null, '策略集已保存并通知在线设备');
}

export async function DELETE(req: Request) {
  const admin = await authAdmin(req);
  if (admin instanceof Response) return admin;
  const id = new URL(req.url).searchParams.get('id') ?? '';
  const bound = await q1<{ n: string }>(`SELECT count(*) AS n FROM user_group WHERE policy_set_id = $1`, [id]);
  if (Number(bound?.n ?? 0) > 0) return err(CODE.CONFLICT, '该策略集仍被用户组绑定，请先解绑');
  await q(`DELETE FROM policy_set WHERE policy_set_id = $1`, [id]);
  await adminAudit({ adminUserId: admin.userId, operateType: 'delete_policy_set', detail: { policySetId: id }, ip: clientIp(req) });
  return ok({ deleted: true });
}
