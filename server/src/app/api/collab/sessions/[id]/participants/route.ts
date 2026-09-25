import { q, q1 } from '@/lib/db';
import { CODE, ok, err, readJson } from '@/lib/status';
import { authUser, require2faBound } from '@/lib/auth';
import { emitToWs } from '@/lib/push';

export const dynamic = 'force-dynamic';

/**
 * POST /api/collab/sessions/[id]/participants （服务端提示词 7.3）
 * body: { inviteEmails: "a@test.com, b@test.com c@test.com", role?: 'viewer'|'controller' }
 * 只接受完整邮箱（逗号/空格分隔批量），无用户搜索；邮箱不存在返回明确报错。
 * PATCH — 协作者媒体申请（request_audio_publish / request_video_publish）：
 * body: { request: 'audio' | 'video' } → 通知发起方审批（服务端为唯一权威，见 E.6）
 */
export async function POST(req: Request, ctx: { params: { id: string } }) {
  const u = await authUser(req);
  if (u instanceof Response) return u;
  const t = await require2faBound(u);
  if (t) return t;

  const s = await q1<{ owner_user_id: string; is_active: boolean; allowed_user_ids: string[] }>(
    `SELECT owner_user_id, is_active, allowed_user_ids FROM collab_session WHERE session_id = $1`, [ctx.params.id]
  );
  if (!s || !s.is_active) return err(CODE.NOT_FOUND, '会话不存在或已结束');
  if (s.owner_user_id !== u.userId) return err(CODE.NO_PERMISSION, '仅发起方可邀请');

  const body = await readJson<{ inviteEmails?: string; role?: 'viewer' | 'controller' }>(req);
  const emails = [...new Set((body?.inviteEmails ?? '').split(/[,;\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean))];
  if (emails.length === 0) return err(CODE.BAD_REQUEST, '请提供邀请邮箱');

  const found = await q<{ email: string; user_id: string }>(`SELECT email, user_id FROM users WHERE email = ANY($1)`, [emails]);
  const invalidEmails = emails.filter((e) => !found.rows.some((f) => f.email === e));
  let added = 0;
  for (const row of found.rows) {
    if (s.allowed_user_ids.includes(row.user_id)) continue;
    await q(`UPDATE collab_session SET allowed_user_ids = allowed_user_ids || $2::uuid WHERE session_id = $1`, [ctx.params.id, row.user_id]);
    await q(
      `INSERT INTO collab_participant (session_id, user_id, role) VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [ctx.params.id, row.user_id, body?.role ?? 'viewer']
    );
    await emitToWs({ type: 'push_message', userId: row.user_id, data: { pushType: 'collab_invite', payload: { sessionId: ctx.params.id, from: u.email } } });
    added += 1;
  }
  return ok({ added, invalidEmails });
}

export async function PATCH(req: Request, ctx: { params: { id: string } }) {
  const u = await authUser(req);
  if (u instanceof Response) return u;

  const s = await q1<{ owner_user_id: string; is_active: boolean }>(
    `SELECT owner_user_id, is_active FROM collab_session WHERE session_id = $1`, [ctx.params.id]
  );
  if (!s || !s.is_active) return err(CODE.NOT_FOUND, '会话不存在或已结束');

  const body = await readJson<{ request?: 'audio' | 'video'; approve?: boolean; participantId?: string }>(req);

  // 发起方审批：直接改库（服务端为唯一权威）
  if (body?.approve !== undefined) {
    if (s.owner_user_id !== u.userId) return err(CODE.NO_PERMISSION, '仅发起方可审批');
    await q(
      `UPDATE collab_participant SET allow_send_audio = $2, allow_send_video = $3 WHERE participant_id = $1`,
      [body.participantId, body.request === 'audio' ? body.approve : undefined, body.request === 'video' ? body.approve : undefined]
    );
    const p = await q1<{ user_id: string }>(`SELECT user_id FROM collab_participant WHERE participant_id = $1`, [body.participantId]);
    if (p) {
      await emitToWs({
        type: 'collab', userId: p.user_id,
        data: { kind: 'media_permission', sessionId: ctx.params.id, allowAudio: body.request === 'audio' ? body.approve : undefined, allowVideo: body.request === 'video' ? body.approve : undefined }
      });
    }
    return ok({ approved: body.approve });
  }

  // 协作者申请开麦/开摄像头：通知发起方弹窗审批（即使本地硬件已打开，未放行不得建立上传轨道）
  const bodyReq = body?.request;
  if (bodyReq !== 'audio' && bodyReq !== 'video') return err(CODE.BAD_REQUEST, 'request 必须是 audio 或 video');
  const me = await q1<{ participant_id: string }>(
    `SELECT participant_id FROM collab_participant WHERE session_id = $1 AND user_id = $2 AND leave_at IS NULL`,
    [ctx.params.id, u.userId]
  );
  if (!me) return err(CODE.NO_PERMISSION, '你不在该会话中');
  await emitToWs({
    type: 'collab', userId: s.owner_user_id,
    data: { kind: 'media_request', sessionId: ctx.params.id, participantId: me.participant_id, request: bodyReq, from: u.email }
  });
  return ok({ requested: bodyReq, pendingApproval: true });
}
