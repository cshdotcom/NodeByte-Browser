import bcrypt from 'bcryptjs';
import { q, q1 } from '@/lib/db';
import { CODE, ok, err, readJson, rateLimit } from '@/lib/status';
import { userSecurityLog, clientIp } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/register  （服务端提示词 E.2）
 * body: { email, code, password, username? }
 * 校验验证码有效未过期 → 创建账号（默认组、有效期 null、继承组配额与策略、active）
 */
export async function POST(req: Request) {
  if (!rateLimit(`register:${clientIp(req)}`, 10, 60_000)) return err(CODE.RATE_LIMITED, '请求过于频繁');
  const body = await readJson<{ email?: string; code?: string; password?: string; username?: string }>(req);
  const email = body?.email?.trim().toLowerCase();
  const code = body?.code?.trim();
  const password = body?.password ?? '';
  if (!email || !code || password.length < 8) return err(CODE.BAD_REQUEST, '参数不完整或密码少于 8 位');

  const enabled = await q1<{ v: boolean }>(
    `SELECT (setting_value)::boolean AS v FROM system_setting WHERE setting_key='enable_public_register'`
  );
  if (!enabled?.v) return err(CODE.NO_PERMISSION, '注册已关闭');

  const v = await q1<{ code: string; expire_at: Date }>(
    `SELECT code, expire_at FROM email_verify_code WHERE email = $1 AND purpose = 'register'`,
    [email]
  );
  if (!v || v.code !== code) return err(CODE.BAD_REQUEST, '验证码错误');
  if (new Date(v.expire_at).getTime() < Date.now()) return err(CODE.BAD_REQUEST, '验证码已过期，请重新获取');

  const exists = await q1<{ user_id: string }>(`SELECT user_id FROM users WHERE email = $1`, [email]);
  if (exists) return err(CODE.CONFLICT, '邮箱已被注册');

  const hash = await bcrypt.hash(password, 10);
  const username = body?.username?.trim() || email.split('@')[0];
  const u = await q1<{ user_id: string }>(
    `INSERT INTO users (username, email, password_hash, group_id)
     VALUES ($1, $2, $3, (SELECT setting_value->>'groupId' FROM system_setting WHERE setting_key='default_group')::uuid)
     RETURNING user_id`,
    [username, email, hash]
  );
  if (u) {
    if (u.user_id) {
      const defGroup = await q1<{ group_id: string }>(`SELECT group_id FROM user_group ORDER BY created_at LIMIT 1`);
      if (defGroup) await q(`INSERT INTO user_group_member (user_id, group_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [u.user_id, defGroup.group_id]);
    }
    await userSecurityLog({ userId: u.user_id, eventType: 'self_register', ip: clientIp(req) });
  }
  await q(`DELETE FROM email_verify_code WHERE email = $1 AND purpose='register'`, [email]);
  return ok({ userId: u?.user_id }, '注册成功，请登录');
}
