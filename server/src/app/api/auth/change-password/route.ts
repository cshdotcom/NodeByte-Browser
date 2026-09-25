import bcrypt from 'bcryptjs';
import { q, q1 } from '@/lib/db';
import { CODE, ok, err, readJson } from '@/lib/status';
import { authUser } from '@/lib/auth';
import { userSecurityLog, clientIp } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/** POST /api/auth/change-password  body: { oldPassword, newPassword }（校验旧密码） */
export async function POST(req: Request) {
  const u = await authUser(req);
  if (u instanceof Response) return u;

  const body = await readJson<{ oldPassword?: string; newPassword?: string }>(req);
  if (!body?.oldPassword || !body?.newPassword || body.newPassword.length < 8)
    return err(CODE.BAD_REQUEST, '参数不完整或新密码少于 8 位');

  const cur = await q1<{ password_hash: string }>(`SELECT password_hash FROM users WHERE user_id = $1`, [u.userId]);
  if (!cur || !(await bcrypt.compare(body.oldPassword, cur.password_hash)))
    return err(CODE.UNAUTHORIZED, '旧密码错误');

  await q(`UPDATE users SET password_hash = $2 WHERE user_id = $1`, [u.userId, await bcrypt.hash(body.newPassword, 10)]);
  await userSecurityLog({ userId: u.userId, eventType: 'password_changed', ip: clientIp(req) });
  return ok(null, '密码已修改');
}
