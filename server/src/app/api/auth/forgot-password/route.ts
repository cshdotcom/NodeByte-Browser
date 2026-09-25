import bcrypt from 'bcryptjs';
import { q, q1 } from '@/lib/db';
import { CODE, ok, err, readJson, rateLimit } from '@/lib/status';
import { userSecurityLog, clientIp } from '@/lib/audit';
import { randomToken, sha256Hex, totpVerify, aesGcmDecrypt } from '@/lib/crypto';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/forgot-password （服务端提示词 5.1.6）
 *
 * mode=A（密码遗忘但 2FA 可用）：{ mode:'A', identifier, totpCode } → 校验 TOTP → 直接重置（返回 resetToken）
 * mode=B（密码与 2FA 全丢）：{ mode:'B', email } → 发送邮箱验证链接，进入 48 小时冷静期
 *   { mode:'B', token } → 查询冷静期状态（服务端控制时间，前端不可控）
 *   { mode:'B', token, confirm:true } → 冷静期结束二次确认 → 允许重置并清空旧 2FA
 */
const COOLING_MS = 48 * 60 * 60 * 1000;

export async function POST(req: Request) {
  if (!rateLimit(`forgot:${clientIp(req)}`, 15, 60_000)) return err(CODE.RATE_LIMITED, '请求过于频繁');
  const body = await readJson<{ mode?: 'A' | 'B'; identifier?: string; email?: string; totpCode?: string; token?: string; confirm?: boolean; newPassword?: string }>(req);
  const ip = clientIp(req);

  // ---------------- 方式 A：账号 + TOTP 码重置 ----------------
  if (body?.mode === 'A') {
    const u = await q1<{ user_id: string; totp_enabled: boolean; totp_secret_encrypted: string | null }>(
      `SELECT user_id, totp_enabled, totp_secret_encrypted FROM users WHERE email = $1 OR username = $1`,
      [body.identifier?.trim() ?? '']
    );
    if (!u || !u.totp_enabled || !u.totp_secret_encrypted) return err(CODE.BAD_REQUEST, '账号未启用 2FA，请使用方式 B');
    const secret = aesGcmDecrypt(u.totp_secret_encrypted);
    if (!secret || !totpVerify(secret, body.totpCode ?? '')) return err(CODE.UNAUTHORIZED, '两步验证码错误');
    const resetToken = randomToken(24);
    await q(
      `INSERT INTO password_reset_request (user_id, method, token, stage, ready_at, expire_at)
       VALUES ($1, 'totp', $2, 'ready', now(), now() + interval '30 minutes')`,
      [u.user_id, sha256Hex(resetToken)]
    );
    await userSecurityLog({ userId: u.user_id, eventType: 'forgot_password_A_verified', ip });
    return ok({ resetToken, expiresInMinutes: 30 });
  }

  // ---------------- 方式 B：邮箱链接 + 48h 冷静期 ----------------
  if (body?.mode === 'B') {
    if (!body.token) {
      const email = body.email?.trim().toLowerCase() ?? '';
      const u = await q1<{ user_id: string }>(`SELECT user_id FROM users WHERE email = $1`, [email]);
      // 防枚举：无论存在与否都返回成功
      if (u) {
        const token = randomToken(24);
        await q(
          `INSERT INTO password_reset_request (user_id, method, token, stage, expire_at)
           VALUES ($1, 'email_cooling', $2, 'cooling', now() + interval '72 hours')`,
          [u.user_id, sha256Hex(token)]
        );
        console.log(`[forgot-password-B] link for ${email}: /forgot-password?token=${token} (48h cooling)`);
      }
      return ok({ started: true, coolingHours: 48 });
    }

    const r = await q1<{ request_id: string; user_id: string; stage: string; created_at: Date; ready_at: Date | null }>(
      `SELECT request_id, user_id, stage, created_at, ready_at FROM password_reset_request
        WHERE token = $1 AND method = 'email_cooling' AND stage IN ('cooling','ready') AND expire_at > now()`,
      [sha256Hex(body.token)]
    );
    if (!r) return err(CODE.BAD_REQUEST, '链接无效或已过期');

    if (!body.confirm) {
      const elapsed = Date.now() - new Date(r.created_at).getTime();
      const remainingMs = Math.max(COOLING_MS - elapsed, 0);
      if (remainingMs > 0) {
        return ok({ stage: 'cooling', remainingHours: Math.ceil(remainingMs / 3600000) }, '冷静期内（48 小时，服务端控制）');
      }
      if (r.stage !== 'ready') {
        await q(`UPDATE password_reset_request SET stage='ready', ready_at=now() WHERE request_id=$1`, [r.request_id]);
      }
      return ok({ stage: 'ready' }, '冷静期已结束，请二次确认以重置密码');
    }

    // 二次确认 → 允许重置并清空旧 2FA
    const elapsed = Date.now() - new Date(r.created_at).getTime();
    if (elapsed < COOLING_MS) return err(CODE.BAD_REQUEST, '冷静期未结束（48 小时，服务端控制）');
    const resetToken = randomToken(24);
    await q(`UPDATE password_reset_request SET stage='done' WHERE request_id=$1`, [r.request_id]);
    await q(
      `INSERT INTO password_reset_request (user_id, method, token, stage, ready_at, expire_at)
       VALUES ($1, 'email_cooling', $2, 'ready', now(), now() + interval '30 minutes')`,
      [r.user_id, sha256Hex(resetToken)]
    );
    await q(`UPDATE users SET totp_enabled = false, totp_secret_encrypted = NULL WHERE user_id = $1`, [r.user_id]);
    await userSecurityLog({ userId: r.user_id, eventType: 'forgot_password_B_confirmed_2fa_cleared', ip });
    return ok({ resetToken, expiresInMinutes: 30 });
  }

  return err(CODE.BAD_REQUEST, '未知模式');
}
