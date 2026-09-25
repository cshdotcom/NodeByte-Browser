import { q, q1 } from '@/lib/db';
import { CODE, ok, err, readJson } from '@/lib/status';
import { authAdmin } from '@/lib/auth';
import { adminAudit, clientIp } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/**
 * GET  /api/admin/groups — 用户组列表（含成员数、配额、绑定策略集名）
 * POST /api/admin/groups — 创建（组名、描述、云存储配额、绑定策略集）
 * PATCH /api/admin/groups — 修改 { groupId, ... }
 * POST /api/admin/groups { action:'set_features', groupId, features: {allow_sync:true,...} } — 功能黑白名单
 */
export async function GET(req: Request) {
  const admin = await authAdmin(req);
  if (admin instanceof Response) return admin;
  const rows = await q(
    `SELECT g.*, ps.name AS policy_set_name,
            (SELECT count(*) FROM user_group_member m WHERE m.group_id = g.group_id) AS member_count,
            (SELECT jsonb_object_agg(f.feature_key, f.enabled) FROM user_group_feature_policy f WHERE f.group_id = g.group_id) AS features
       FROM user_group g LEFT JOIN policy_set ps ON ps.policy_set_id = g.policy_set_id
      ORDER BY g.created_at`
  );
  return ok({ groups: rows.rows });
}

export async function POST(req: Request) {
  const admin = await authAdmin(req);
  if (admin instanceof Response) return admin;

  const body = await readJson<{
    action?: 'create' | 'set_features'; groupName?: string; description?: string;
    cloudDropQuotaMb?: number; policySetId?: string | null; groupId?: string; features?: Record<string, boolean>;
  }>(req);

  if (body?.action === 'set_features') {
    if (!body.groupId || !body.features) return err(CODE.BAD_REQUEST, '缺少 groupId/features');
    for (const [key, enabled] of Object.entries(body.features)) {
      await q(
        `INSERT INTO user_group_feature_policy (group_id, feature_key, enabled) VALUES ($1, $2, $3)
         ON CONFLICT (group_id, feature_key) DO UPDATE SET enabled = $3`,
        [body.groupId, key, Boolean(enabled)]
      );
    }
    await adminAudit({ adminUserId: admin.userId, targetUserId: null, operateType: 'modify_group', detail: { setFeatures: body.groupId }, ip: clientIp(req) });
    return ok(null, '功能黑白名单已更新');
  }

  if (!body?.groupName?.trim()) return err(CODE.BAD_REQUEST, '组名必填');
  const g = await q1<{ group_id: string }>(
    `INSERT INTO user_group (group_name, description, cloud_drop_quota_mb, policy_set_id)
     VALUES ($1, $2, $3, $4) RETURNING group_id`,
    [body.groupName.trim(), body.description ?? null, Math.max(0, Number(body.cloudDropQuotaMb ?? 1024)), body.policySetId || null]
  );
  await adminAudit({ adminUserId: admin.userId, operateType: 'create_group', detail: { groupName: body.groupName }, ip: clientIp(req) });
  return ok({ groupId: g?.group_id });
}
