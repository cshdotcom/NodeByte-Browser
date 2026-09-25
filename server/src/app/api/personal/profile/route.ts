import { q, q1 } from '@/lib/db';
import { CODE, ok, err, readJson } from '@/lib/status';
import { authUser, require2faBound } from '@/lib/auth';
import { userSecurityLog, clientIp } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/**
 * GET   /api/personal/profile — 个人资料
 * PATCH /api/personal/profile — 修改昵称；修改邮箱需原邮箱验证（第一版：验证密码后修改，邮箱验证码二期）
 */
export async function GET(req: Request) {
  const u = await authUser(req);
  if (u instanceof Response) return u;
  const r = await q1<{ username: string; email: string; avatar_object_key: string | null; created_at: Date; last_login_at: Date | null; totp_enabled: boolean; account_expire_at: Date | null }>(
    `SELECT username, email, avatar_object_key, created_at, last_login_at, totp_enabled, account_expire_at FROM users WHERE user_id = $1`,
    [u.userId]
  );
  return ok(r);
}

export async function PATCH(req: Request) {
  const u = await authUser(req);
  if (u instanceof Response) return u;
  const body = await readJson<{ username?: string; email?: string; password?: string }>(req);

  if (body?.email) {
    // 修改邮箱：校验密码（原邮箱验证码流程二期；此处密码强校验兜底）
    const bcrypt = (await import('bcryptjs')).default;
    const r = await q1<{ password_hash: string }>(`SELECT password_hash FROM users WHERE user_id = $1`, [u.userId]);
    if (!r || !(await bcrypt.compare(body.password ?? '', r.password_hash))) return err(CODE.UNAUTHORIZED, '密码错误');
    const dup = await q1(`SELECT 1 AS x FROM users WHERE email = $1 AND user_id <> $2`, [body.email.toLowerCase(), u.userId]);
    if (dup) return err(CODE.CONFLICT, '该邮箱已被使用');
    await q(`UPDATE users SET email = $2 WHERE user_id = $1`, [u.userId, body.email.toLowerCase()]);
    await userSecurityLog({ userId: u.userId, eventType: 'email_changed', ip: clientIp(req) });
  }
  if (body?.username) {
    await q(`UPDATE users SET username = $2 WHERE user_id = $1`, [u.userId, body.username.trim()]);
  }
  return ok(null, '已保存');
}
