import { q, q1 } from '@/lib/db';
import { CODE, ok, err, readJson } from '@/lib/status';
import { authUser, require2faBound, requireFeature } from '@/lib/auth';
import { randomToken } from '@/lib/crypto';
import { userSecurityLog, clientIp } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/**
 * GET  /api/collab/sessions — 我发起/我参与的协作会话
 * POST /api/collab/sessions — 创建会话（服务端提示词 5.6.1）
 *   body: { expireHours: 1|24|0(永久), allowMulti?, maxParticipants?, permissions? }
 *   生成 share_token + 短链接；会话创建/加入/保存/过期销毁全部审计。
 */
export async function GET(req: Request) {
  const u = await authUser(req);
  if (u instanceof Response) return u;
  const t = await require2faBound(u);
  if (t) return t;

  const owned = await q(
    `SELECT s.*, (SELECT count(*) FROM collab_participant p WHERE p.session_id = s.session_id AND p.leave_at IS NULL AND NOT p.is_kicked) AS online_count
       FROM collab_session s WHERE s.owner_user_id = $1 AND s.is_active = true ORDER BY s.created_at DESC`,
    [u.userId]
  );
  const joined = await q(
    `SELECT s.session_id, s.share_token, s.token_expire_at, s.is_active, s.created_at, su.username AS owner_name, p.role
       FROM collab_session s
       JOIN collab_participant p ON p.session_id = s.session_id AND p.user_id = $1
       JOIN users su ON su.user_id = s.owner_user_id
      WHERE s.is_active = true ORDER BY s.created_at DESC`,
    [u.userId]
  );
  return ok({ owned: owned.rows, joined: joined.rows });
}

export async function POST(req: Request) {
  const u = await authUser(req);
  if (u instanceof Response) return u;
  const t = await require2faBound(u);
  if (t) return t;
  const gate = await requireFeature(u, 'allow_collab_invite');
  if (gate) return gate;

  const body = await readJson<{
    expireHours?: number; allowMulti?: boolean; maxParticipants?: number;
    permissions?: { allowView?: boolean; allowControl?: boolean; allowGuest?: boolean };
  }>(req);
  const expireHours = Number(body?.expireHours ?? 24);
  const token = randomToken(18);
  const expireAt = expireHours > 0 ? new Date(Date.now() + expireHours * 3600_000) : null;

  const s = await q1<{ session_id: string; share_token: string }>(
    `INSERT INTO collab_session
       (owner_user_id, share_token, token_expire_at, permissions_json, allow_multi_participant, session_max_participants)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6) RETURNING session_id, share_token`,
    [
      u.userId, token, expireAt,
      JSON.stringify({
        allowView: body?.permissions?.allowView ?? true,
        allowControl: body?.permissions?.allowControl ?? false,
        allowGuest: false // 游客默认关闭（提示词 5.6.1）
      }),
      Boolean(body?.allowMulti), Math.max(1, Number(body?.maxParticipants ?? 1))
    ]
  );
  await userSecurityLog({ userId: u.userId, eventType: 'collab_created', detail: { sessionId: s?.session_id }, ip: clientIp(req) });
  return ok({
    sessionId: s?.session_id,
    shareToken: s?.share_token,
    shareUrl: `/collab/join?token=${s?.share_token}`,
    expireAt
  });
}
