import { q, q1 } from '@/lib/db';
import { CODE, ok, err, readJson } from '@/lib/status';
import { authUser } from '@/lib/auth';
import { aesGcmDecrypt, totpVerify } from '@/lib/crypto';
import { userSecurityLog, clientIp } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/** POST /api/auth/2fa/enable  body: { code } — 校验 TOTP 后正式绑定 */
export async function POST(req: Request) {
  const u = await authUser(req);
  if (u instanceof Response) return u;

  const body = await readJson<{ code?: string }>(req);
  if (!body?.code) return err(CODE.BAD_REQUEST, '请输入验证码');

  const r = await q1<{ totp_secret_encrypted: string | null }>(
    `SELECT totp_secret_encrypted FROM users WHERE user_id = $1`,
    [u.userId]
  );
  const secret = r?.totp_secret_encrypted ? aesGcmDecrypt(r.totp_secret_encrypted) : null;
  if (!secret) return err(CODE.BAD_REQUEST, '请先调用 setup 生成密钥');
  if (!totpVerify(secret, body.code)) return err(CODE.UNAUTHORIZED, '验证码错误，请重试');

  await q(`UPDATE users SET totp_enabled = true WHERE user_id = $1`, [u.userId]);
  await userSecurityLog({ userId: u.userId, eventType: '2fa_enabled', ip: clientIp(req) });
  return ok(null, '2FA 绑定成功');
}
