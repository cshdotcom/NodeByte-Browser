import bcrypt from 'bcryptjs';
import { q, q1 } from '@/lib/db';
import { CODE, ok, err, readJson } from '@/lib/status';
import { authAdmin } from '@/lib/auth';
import { adminAudit, clientIp } from '@/lib/audit';
import { emitToWs } from '@/lib/push';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/users/[id]/actions — 用户敏感操作（全部落审计）
 * body: { action }
 *   ban / unban / disable / activate     — 状态切换（封禁强制全部设备下线）
 *   reset_password { newPassword }        — 重置为临时密码（不展示旧密码）
 *   reset_2fa                             — 强制重置/清空用户 2FA 凭证
 *   revoke_devices                        — 吊销全部设备
 *   set_quota { overrideQuotaMb }         — 改独立配额
 *   set_policy { overridePolicyJson }     — 编辑覆盖策略
 *   batch / api/admin/users 批量接口见列表页（批量禁用/改配额/下发策略）
 */
export async function POST(req: Request, ctx: { params: { id: string } }) {
  const admin = await authAdmin(req);
  if (admin instanceof Response) return admin;

  const body = await readJson<{ action?: string; newPassword?: string; overrideQuotaMb?: number; overridePolicyJson?: unknown }>(req);
  const target = await q1<{ user_id: string; account_status: string }>(`SELECT user_id, account_status FROM users WHERE user_id = $1`, [ctx.params.id]);
  if (!target) return err(CODE.NOT_FOUND, '用户不存在');

  switch (body?.action) {
    case 'ban':
    case 'disable':
    case 'activate': {
      const status = body.action === 'activate' ? 'active' : body.action === 'ban' ? 'banned' : 'disabled';
      await q(`UPDATE users SET account_status = $2 WHERE user_id = $1`, [ctx.params.id, status]);
      if (status === 'banned') {
        await q(`UPDATE user_devices SET is_revoked = true WHERE user_id = $1`, [ctx.params.id]);
        await emitToWs({ type: 'command', userId: ctx.params.id, data: { cmd: 'logout', reason: 'banned' } });
      }
      await adminAudit({
        adminUserId: admin.userId, targetUserId: ctx.params.id,
        operateType: status === 'banned' ? 'ban_user' : status === 'active' ? 'unban_user' : 'disable_account',
        ip: clientIp(req)
      });
      return ok({ status });
    }
    case 'reset_password': {
      if (!body.newPassword || body.newPassword.length < 8) return err(CODE.BAD_REQUEST, '临时密码至少 8 位');
      await q(`UPDATE users SET password_hash = $2 WHERE user_id = $1`, [ctx.params.id, await bcrypt.hash(body.newPassword, 10)]);
      await adminAudit({ adminUserId: admin.userId, targetUserId: ctx.params.id, operateType: 'reset_user_password', ip: clientIp(req) });
      return ok({ tempPassword: body.newPassword }, '密码已重置为临时密码');
    }
    case 'reset_2fa': {
      await q(`UPDATE users SET totp_enabled = false, totp_secret_encrypted = NULL WHERE user_id = $1`, [ctx.params.id]);
      await adminAudit({ adminUserId: admin.userId, targetUserId: ctx.params.id, operateType: 'reset_user_2fa', ip: clientIp(req) });
      return ok(null, '已强制重置用户 2FA（已写审计日志）');
    }
    case 'revoke_devices': {
      await q(`UPDATE user_devices SET is_revoked = true WHERE user_id = $1`, [ctx.params.id]);
      await emitToWs({ type: 'command', userId: ctx.params.id, data: { cmd: 'logout', reason: 'devices_revoked' } });
      await adminAudit({ adminUserId: admin.userId, targetUserId: ctx.params.id, operateType: 'revoke_device_admin', ip: clientIp(req) });
      return ok(null, '已吊销全部设备');
    }
    case 'set_quota': {
      await q(`UPDATE users SET override_cloud_quota_mb = $2 WHERE user_id = $1`, [ctx.params.id, body.overrideQuotaMb ?? null]);
      await adminAudit({ adminUserId: admin.userId, targetUserId: ctx.params.id, operateType: 'modify_user_quota', detail: { overrideQuotaMb: body.overrideQuotaMb }, ip: clientIp(req) });
      return ok(null, '配额已更新');
    }
    case 'set_policy': {
      await q(`UPDATE users SET override_policy_json = $2::jsonb WHERE user_id = $1`,
        [ctx.params.id, body.overridePolicyJson ? JSON.stringify(body.overridePolicyJson) : null]);
      await emitToWs({ type: 'policy_update', userId: ctx.params.id, data: {} });
      await adminAudit({ adminUserId: admin.userId, targetUserId: ctx.params.id, operateType: 'modify_user_override_policy', ip: clientIp(req) });
      return ok(null, '覆盖策略已更新');
    }
    default:
      return err(CODE.BAD_REQUEST, '未知操作');
  }
}
