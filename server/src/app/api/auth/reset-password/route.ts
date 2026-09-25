import bcrypt from 'bcryptjs';
import { q, q1 } from '@/lib/db';
import { CODE, ok, err, readJson } from '@/lib/status';
import { userSecurityLog, clientIp } from '@/lib/audit';
import { sha256Hex } from '@/lib/crypto';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/reset-password  body: { resetToken, newPassword }
 * 凭 forgot-password 签发的 resetToken（30 分钟有效）重置密码。
 */
export async function POST(req: Request) {
  const body = await readJson<{ resetToken?: string; newPassword?: string }>(req);
  if (!body?.resetToken || !body.newPassword || body.newPassword.length < 8)
    return err(CODE.BAD_REQUEST, '参数不完整或密码少于 8 位');

  const r = await q1<{ request_id: string; user_id: string }>(
    `SELECT request_id, user_id FROM password_reset_request
      WHERE token = $1 AND stage = 'ready' AND expire_at > now()`,
    [sha256Hex(body.resetToken)]
  );
  if (!r) return err(CODE.BAD_REQUEST, '重置凭证无效或已过期');

  const hash = await bcrypt.hash(body.newPassword, 10);
  await q(`UPDATE users SET password_hash = $2 WHERE user_id = $1`, [r.user_id, hash]);
  await q(`UPDATE password_reset_request SET stage='done' WHERE request_id=$1`, [r.request_id]);
  // 全部设备强制下线：吊销设备 + 清理（离线设备下次 API 拒绝）
  await q(`UPDATE user_devices SET is_revoked = true WHERE user_id = $1`, [r.user_id]);
  await userSecurityLog({ userId: r.user_id, eventType: 'password_reset_via_forgot', ip: clientIp(req) });
  return ok(null, '密码已重置，请使用新密码登录');
}
