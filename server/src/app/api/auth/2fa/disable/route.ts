import bcrypt from 'bcryptjs';
import { q, q1 } from '@/lib/db';
import { CODE, ok, err, readJson } from '@/lib/status';
import { authUser } from '@/lib/auth';
import { aesGcmDecrypt, totpVerify } from '@/lib/crypto';
import { userSecurityLog, clientIp } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/2fa/disable  body: { password, code }
 * 解绑 2FA 需密码 + 有效验证码（服务端提示词 5.1.5）。
 */
export async function POST(req: Request) {
  const u = await authUser(req);
  if (u instanceof Response) return u;

  const body = await readJson<{ password?: string; code?: string }>(req);
  if (!body?.password || !body?.code) return err(CODE.BAD_REQUEST, '需要密码与验证码');

  const r = await q1<{ password_hash: string; totp_enabled: boolean; totp_secret_encrypted: string | null }>(
    `SELECT password_hash, totp_enabled, totp_secret_encrypted FROM users WHERE user_id = $1`,
    [u.userId]
  );
  if (!r || !r.totp_enabled) return err(CODE.BAD_REQUEST, '未绑定 2FA');
  if (!(await bcrypt.compare(body.password, r.password_hash))) return err(CODE.UNAUTHORIZED, '密码错误');
  const secret = r.totp_secret_encrypted ? aesGcmDecrypt(r.totp_secret_encrypted) : null;
  if (!secret || !totpVerify(secret, body.code)) return err(CODE.UNAUTHORIZED, '验证码错误');

  await q(`UPDATE users SET totp_enabled = false, totp_secret_encrypted = NULL WHERE user_id = $1`, [u.userId]);
  await userSecurityLog({ userId: u.userId, eventType: '2fa_disabled', ip: clientIp(req) });
  return ok(null, '2FA 已解绑');
}
