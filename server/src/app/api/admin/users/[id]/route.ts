import bcrypt from 'bcryptjs';
import { q, q1 } from '@/lib/db';
import { CODE, ok, err, readJson } from '@/lib/status';
import { authAdmin } from '@/lib/auth';
import { adminAudit, clientIp } from '@/lib/audit';
import { emitToWs } from '@/lib/push';

export const dynamic = 'force-dynamic';

/**
 * GET    /api/admin/users/[id] — 用户详情（资料/组/设备/文件统计）
 * PATCH  /api/admin/users/[id] — 修改资料/组/有效期/配额/覆盖策略/状态
 * DELETE /api/admin/users/[id] — 删除用户（高危二次确认 + 级联删除，body.confirm 必须 true）
 */
type Ctx = { params: { id: string } };

export async function GET(req: Request, ctx: Ctx) {
  const admin = await authAdmin(req);
  if (admin instanceof Response) return admin;
  const u = await q1(
    `SELECT u.*, g.group_name, COALESCE(uo.used,0) AS used_bytes,
            (SELECT count(*) FROM user_devices d WHERE d.user_id = u.user_id) AS device_count,
            (SELECT count(*) FROM user_file_meta f WHERE f.owner_user_id = u.user_id) AS file_count
       FROM users u LEFT JOIN user_group g ON g.group_id = u.group_id
       LEFT JOIN user_cloud_usage uo ON uo.user_id = u.user_id
      WHERE u.user_id = $1`,
    [ctx.params.id]
  );
  if (!u) return err(CODE.NOT_FOUND, '用户不存在');
  return ok(u);
}

export async function PATCH(req: Request, ctx: Ctx) {
  const admin = await authAdmin(req);
  if (admin instanceof Response) return admin;

  const body = await readJson<{
    username?: string; groupId?: string | null; accountStatus?: 'active' | 'disabled' | 'banned';
    accountValidDays?: number | null; overrideQuotaMb?: number | null; overridePolicyJson?: unknown | null;
  }>(req);
  const target = await q1<{ user_id: string }>(`SELECT user_id FROM users WHERE user_id = $1`, [ctx.params.id]);
  if (!target) return err(CODE.NOT_FOUND, '用户不存在');

  if (body?.username) await q(`UPDATE users SET username = $2 WHERE user_id = $1`, [ctx.params.id, body.username.trim()]);
  if (body?.groupId !== undefined) {
    await q(`UPDATE users SET group_id = $2 WHERE user_id = $1`, [ctx.params.id, body.groupId || null]);
    if (body.groupId) await q(`INSERT INTO user_group_member (user_id, group_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [ctx.params.id, body.groupId]);
  }
  if (body?.accountStatus) {
    await q(`UPDATE users SET account_status = $2 WHERE user_id = $1`, [ctx.params.id, body.accountStatus]);
    if (body.accountStatus === 'banned') {
      // 封禁：全部设备强制吊销下线；禁用：已登录设备不强制下线（提示词 5.1.3）
      await q(`UPDATE user_devices SET is_revoked = true WHERE user_id = $1`, [ctx.params.id]);
      await emitToWs({ type: 'command', userId: ctx.params.id, data: { cmd: 'logout', reason: 'banned' } });
    }
  }
  if (body?.accountValidDays !== undefined) {
    const expireAt = body.accountValidDays && body.accountValidDays > 0 ? new Date(Date.now() + body.accountValidDays * 86400_000) : null;
    await q(`UPDATE users SET account_expire_at = $2 WHERE user_id = $1`, [ctx.params.id, expireAt]);
  }
  if (body?.overrideQuotaMb !== undefined) {
    await q(`UPDATE users SET override_cloud_quota_mb = $2 WHERE user_id = $1`, [ctx.params.id, body.overrideQuotaMb]);
  }
  if (body?.overridePolicyJson !== undefined) {
    await q(`UPDATE users SET override_policy_json = $2::jsonb WHERE user_id = $1`,
      [ctx.params.id, body.overridePolicyJson ? JSON.stringify(body.overridePolicyJson) : null]);
  }

  await adminAudit({
    adminUserId: admin.userId, targetUserId: ctx.params.id, operateType: 'modify_user_info',
    detail: { patch: Object.keys(body ?? {}) }, ip: clientIp(req)
  });
  return ok(null, '已保存');
}

export async function DELETE(req: Request, ctx: Ctx) {
  const admin = await authAdmin(req);
  if (admin instanceof Response) return admin;
  const body = await readJson<{ confirm?: boolean }>(req);
  if (!body?.confirm) return err(CODE.BAD_REQUEST, '删除用户为高危操作，需二次确认（confirm=true）');
  if (ctx.params.id === admin.userId) return err(CODE.BAD_REQUEST, '不能删除自己');

  await q(`DELETE FROM users WHERE user_id = $1`, [ctx.params.id]);
  await adminAudit({
    adminUserId: admin.userId, targetUserId: ctx.params.id, operateType: 'delete_user',
    detail: { cascade: true }, ip: clientIp(req)
  });
  return ok({ deleted: true });
}
