import { q, q1 } from '@/lib/db';
import { CODE, ok, err, readJson } from '@/lib/status';
import { authUser, require2faBound } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * POST /api/collab/join  body: { token }
 * 加入流程（服务端提示词 5.6.2）：token 存在与过期 → 登录校验（不允许游客）
 * → user_id 在 allowed_user_ids 白名单 → 通过后加入。
 */
export async function POST(req: Request) {
  const u = await authUser(req);
  if (u instanceof Response) return u;
  const t = await require2faBound(u);
  if (t) return t;

  const body = await readJson<{ token?: string }>(req);
  if (!body?.token) return err(CODE.BAD_REQUEST, '缺少 token');

  const s = await q1<{ session_id: string; token_expire_at: Date | null; is_active: boolean; allowed_user_ids: string[]; owner_user_id: string }>(
    `SELECT session_id, token_expire_at, is_active, allowed_user_ids, owner_user_id FROM collab_session WHERE share_token = $1`,
    [body.token]
  );
  if (!s || !s.is_active) return err(CODE.NOT_FOUND, '会话不存在或已结束');
  if (s.token_expire_at && new Date(s.token_expire_at).getTime() < Date.now())
    return err(CODE.BAD_REQUEST, '分享链接已过期');
  if (s.owner_user_id !== u.userId && !s.allowed_user_ids.includes(u.userId))
    return err(CODE.NO_PERMISSION, '你不在该会话的白名单中');

  await q(
    `INSERT INTO collab_participant (session_id, user_id, role) VALUES ($1, $2, 'viewer')
     ON CONFLICT DO NOTHING`,
    [s.session_id, u.userId]
  );
  return ok({ sessionId: s.session_id, role: 'viewer' });
}
