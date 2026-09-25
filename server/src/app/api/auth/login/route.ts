import bcrypt from 'bcryptjs';
import { q, q1 } from '@/lib/db';
import { CODE, ok, err, readJson, rateLimit } from '@/lib/status';
import { jwtSign } from '@/lib/crypto';
import { userSecurityLog, clientIp } from '@/lib/audit';
import { getRequire2fa } from '@/lib/policy2fa';
import { emitToWs } from '@/lib/push';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/login
 * body: { identifier, password, totpCode?, deviceId?, deviceName?, deviceFingerprint? }
 * 流程（服务端提示词 E.1）：存在性 → bcrypt → 状态/有效期 → TOTP → 签发 JWT → 登记设备
 * 返回业务码：0 成功；40301 需绑定 2FA（require2faBind=true）；40302 禁用/封禁/过期；401 凭证错误
 */
export async function POST(req: Request) {
  const ip = clientIp(req);
  if (!rateLimit(`login:${ip}`, 20, 60_000)) return err(CODE.RATE_LIMITED, '尝试过于频繁，请稍后再试');

  const body = await readJson<{
    identifier?: string; password?: string; totpCode?: string;
    deviceId?: string; deviceName?: string; deviceFingerprint?: string;
  }>(req);
  const identifier = body?.identifier?.trim();
  const password = body?.password ?? '';
  if (!identifier || !password) return err(CODE.BAD_REQUEST, '请输入账号与密码');

  const u = await q1<{
    user_id: string; email: string; username: string; password_hash: string; is_admin: boolean;
    group_id: string | null; account_status: 'active' | 'disabled' | 'banned';
    account_expire_at: Date | null; totp_enabled: boolean; totp_secret_encrypted: string | null;
  }>(`SELECT * FROM users WHERE email = $1 OR username = $1`, [identifier]);

  if (!u || !(await bcrypt.compare(password, u.password_hash))) {
    if (u) await userSecurityLog({ userId: u.user_id, eventType: 'login_failed', ip });
    return err(CODE.UNAUTHORIZED, '账号或密码错误');
  }
  if (u.account_status === 'banned' || u.account_status === 'disabled') {
    return err(CODE.ACCOUNT_DISABLED, u.account_status === 'banned' ? '账号已封禁' : '账号已禁用');
  }
  if (u.account_expire_at && new Date(u.account_expire_at).getTime() < Date.now()) {
    return err(CODE.ACCOUNT_DISABLED, '账号已过期');
  }

  // 2FA 已绑定 → 必须校验 TOTP（服务端校时窗口 ±1，RFC-6238）
  if (u.totp_enabled) {
    const code = body?.totpCode?.trim();
    if (!code) return err(CODE.UNAUTHORIZED, '请输入两步验证码（TOTP）', 200, { needTotp: true });
    const { aesGcmDecrypt, totpVerify } = await import('@/lib/crypto');
    const secret = u.totp_secret_encrypted ? aesGcmDecrypt(u.totp_secret_encrypted) : null;
    if (!secret || !totpVerify(secret, code)) {
      await userSecurityLog({ userId: u.user_id, eventType: 'totp_failed', ip });
      return err(CODE.UNAUTHORIZED, '两步验证码错误', 200, { needTotp: true });
    }
  }

  const deviceId = body?.deviceId || crypto.randomUUID();
  await q(
    `INSERT INTO user_devices (device_id, user_id, device_name, device_fingerprint, last_online_at, is_revoked)
     VALUES ($1, $2, $3, $4, now(), false)
     ON CONFLICT (device_id) DO UPDATE SET last_online_at = now(), is_revoked = false`,
    [deviceId, u.user_id, body?.deviceName ?? 'Web', body?.deviceFingerprint ?? '']
  );
  await q(`UPDATE users SET last_login_at = now() WHERE user_id = $1`, [u.user_id]);

  // 强制 2FA 策略：已登录但未绑定 → 40301 语义（require2faBind=true），客户端强制跳转绑定页
  const require2fa = await getRequire2fa(u.user_id);
  if (require2fa && !u.totp_enabled) {
    const preJwt = jwtSign({ sub: u.user_id, deviceId, admin: u.is_admin }, 60 * 30);
    await userSecurityLog({ userId: u.user_id, eventType: 'login_need_bind_2fa', ip });
    return ok({ jwt: preJwt, deviceId, userId: u.user_id, email: u.email, username: u.username, require2faBind: true });
  }

  const jwt = jwtSign({ sub: u.user_id, deviceId, admin: u.is_admin }, 60 * 60 * 24 * 7);
  await userSecurityLog({ userId: u.user_id, eventType: 'login_success', detail: { deviceId }, ip });
  await emitToWs({ type: 'push_message', userId: u.user_id, data: { pushType: 'notice', payload: { text: '账号在新设备登录' } } });

  const resp = ok({
    jwt, deviceId, userId: u.user_id, email: u.email, username: u.username,
    isAdmin: u.is_admin, require2faBind: false
  });
  // Web 前台 httpOnly cookie（浏览器客户端走 Bearer，Web 走 cookie）
  resp.headers.append('Set-Cookie', `nb_token=${encodeURIComponent(jwt)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`);
  return resp;
}
