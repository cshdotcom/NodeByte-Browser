import { q, q1 } from '@/lib/db';
import { CODE, ok, err, readJson } from '@/lib/status';
import { authUser, require2faBound } from '@/lib/auth';
import { emitToWs } from '@/lib/push';

export const dynamic = 'force-dynamic';

/**
 * GET    /api/collab/sessions/[id] — 会话详情（含在线参与者）
 * PATCH  /api/collab/sessions/[id] — 发起方管控（服务端提示词 5.6.5）
 *        body: { action: 'mute'|'unmute'|'disable_camera'|'revoke_control'|'kick'|'mute_all'|'camera_all'|'end'
 *                      |'grant_control'|'set_mode', participantId?, mode? }
 * DELETE /api/collab/sessions/[id] — 销毁会话
 * 全部变更后广播 participant_update / collab_ended，SFU 按库状态切断轨道。
 */
export async function GET(req: Request, ctx: { params: { id: string } }) {
  const u = await authUser(req);
  if (u instanceof Response) return u;
  const s = await q1(`SELECT * FROM collab_session WHERE session_id = $1`, [ctx.params.id]);
  if (!s) return err(CODE.NOT_FOUND, '会话不存在');
  const isOwner = (s as { owner_user_id: string }).owner_user_id === u.userId;
  const member = await q1(`SELECT 1 AS ok FROM collab_participant WHERE session_id = $1 AND user_id = $2`, [ctx.params.id, u.userId]);
  if (!isOwner && !member) return err(CODE.NO_PERMISSION, '无权查看该会话');

  const participants = await q(
    `SELECT p.participant_id, p.user_id, us.username, us.email, p.role, p.is_muted, p.is_camera_disabled,
            p.allow_send_audio, p.allow_send_video, p.is_kicked, p.join_at
       FROM collab_participant p JOIN users us ON us.user_id = p.user_id
      WHERE p.session_id = $1 AND p.leave_at IS NULL ORDER BY p.join_at`,
    [ctx.params.id]
  );
  return ok({ session: s, isOwner, participants: participants.rows });
}

export async function PATCH(req: Request, ctx: { params: { id: string } }) {
  const u = await authUser(req);
  if (u instanceof Response) return u;

  const s = await q1<{ owner_user_id: string; is_active: boolean }>(
    `SELECT owner_user_id, is_active FROM collab_session WHERE session_id = $1`, [ctx.params.id]
  );
  if (!s || !s.is_active) return err(CODE.NOT_FOUND, '会话不存在或已结束');
  if (s.owner_user_id !== u.userId) return err(CODE.NO_PERMISSION, '仅发起方可执行管控操作');

  const body = await readJson<{ action?: string; participantId?: string; mode?: 'preempt' | 'parallel' }>(req);
  const pid = body?.participantId;

  const broadcast = async () => {
    const ps = await q(`SELECT * FROM collab_participant WHERE session_id = $1 AND leave_at IS NULL`, [ctx.params.id]);
    await emitToWs({ type: 'collab', userId: s.owner_user_id, data: { kind: 'participant_update', sessionId: ctx.params.id, participants: ps.rows } });
  };

  switch (body?.action) {
    case 'mute':
    case 'unmute': {
      await q(`UPDATE collab_participant SET is_muted = $2, allow_send_audio = $3 WHERE participant_id = $1`, [pid, body.action === 'mute', body.action !== 'mute']);
      await emitToWs({ type: 'collab', userId: u.userId, data: { kind: 'media_permission', sessionId: ctx.params.id, participantId: pid, allowAudio: body.action !== 'mute' } });
      break;
    }
    case 'disable_camera': {
      await q(`UPDATE collab_participant SET is_camera_disabled = true, allow_send_video = false WHERE participant_id = $1`, [pid]);
      await emitToWs({ type: 'collab', userId: u.userId, data: { kind: 'media_permission', sessionId: ctx.params.id, participantId: pid, allowVideo: false } });
      break;
    }
    case 'revoke_control': {
      await q(`UPDATE collab_participant SET role = 'viewer' WHERE participant_id = $1`, [pid]);
      break;
    }
    case 'grant_control': {
      await q(`UPDATE collab_participant SET role = 'controller' WHERE participant_id = $1`, [pid]);
      await emitToWs({ type: 'collab', userId: u.userId, data: { kind: 'control_grant', sessionId: ctx.params.id, participantId: pid, mode: body.mode ?? 'preempt' } });
      break;
    }
    case 'kick': {
      await q(`UPDATE collab_participant SET is_kicked = true, leave_at = now() WHERE participant_id = $1`, [pid]);
      const kicked = await q1<{ user_id: string }>(`SELECT user_id FROM collab_participant WHERE participant_id = $1`, [pid]);
      if (kicked) await emitToWs({ type: 'collab', userId: kicked.user_id, data: { kind: 'collab_ended', sessionId: ctx.params.id, reason: 'kicked' } });
      break;
    }
    case 'mute_all': {
      await q(`UPDATE collab_participant SET is_muted = true, allow_send_audio = false WHERE session_id = $1 AND user_id <> $2`, [ctx.params.id, u.userId]);
      break;
    }
    case 'camera_all': {
      await q(`UPDATE collab_participant SET is_camera_disabled = true, allow_send_video = false WHERE session_id = $1 AND user_id <> $2`, [ctx.params.id, u.userId]);
      break;
    }
    case 'end': {
      await q(`UPDATE collab_session SET is_active = false WHERE session_id = $1`, [ctx.params.id]);
      const ps = await q(`SELECT user_id FROM collab_participant WHERE session_id = $1 AND leave_at IS NULL`, [ctx.params.id]);
      for (const p of ps.rows) await emitToWs({ type: 'collab', userId: p.user_id, data: { kind: 'collab_ended', sessionId: ctx.params.id, reason: 'ended_by_owner' } });
      return ok({ ended: true });
    }
    default:
      return err(CODE.BAD_REQUEST, '未知操作');
  }
  await broadcast();
  return ok({ done: true });
}

export async function DELETE(req: Request, ctx: { params: { id: string } }) {
  const u = await authUser(req);
  if (u instanceof Response) return u;
  const s = await q1<{ owner_user_id: string }>(`SELECT owner_user_id FROM collab_session WHERE session_id = $1`, [ctx.params.id]);
  if (!s) return err(CODE.NOT_FOUND, '会话不存在');
  if (s.owner_user_id !== u.userId) return err(CODE.NO_PERMISSION, '仅发起方可销毁会话');
  await q(`UPDATE collab_session SET is_active = false WHERE session_id = $1`, [ctx.params.id]);
  await emitToWs({ type: 'collab', userId: u.userId, data: { kind: 'collab_ended', sessionId: ctx.params.id, reason: 'destroyed' } });
  return ok({ destroyed: true });
}
