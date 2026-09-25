import { q, q1 } from '@/lib/db';
import { CODE, ok, err, readJson } from '@/lib/status';
import { authUser, require2faBound } from '@/lib/auth';
import { emitToWs } from '@/lib/push';
import { adminAudit, clientIp } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/**
 * POST /api/drop/sessions/[id]/revoke — 撤销分享的会话上下文（服务端提示词 5.5.3）
 * 撤销只能回收本次分发记录；接收方已复制/转发的副本无法回收（UI 明示风险）。
 * body: { messageId }（device_push_message.msg_id）
 */
export async function POST(req: Request, ctx: { params: { id: string } }) {
  const u = await authUser(req);
  if (u instanceof Response) return u;
  const t = await require2faBound(u);
  if (t) return t;

  const body = await readJson<{ messageId?: string }>(req);
  const msgId = body?.messageId || ctx.params.id;

  const msg = await q1<{ sender_user_id: string }>(
    `SELECT sender_user_id FROM device_push_message WHERE msg_id = $1 AND send_type = 'session_context'`,
    [msgId]
  );
  if (!msg || (msg.sender_user_id !== u.userId && !u.isAdmin)) return err(CODE.NOT_FOUND, '分享记录不存在');

  await q(`UPDATE device_push_message SET is_session_revoked = true, revoked_at = now() WHERE msg_id = $1`, [msgId]);
  await q(`UPDATE user_shared_session_store SET is_effective = false WHERE source_msg_id = $1`, [msgId]);

  // WebSocket 实时推送撤销通知（客户端：该会话置灰不可选、移入历史归档）
  const receivers = await q<{ owner_user_id: string }>(
    `SELECT DISTINCT owner_user_id FROM user_shared_session_store WHERE source_msg_id = $1`,
    [msgId]
  );
  for (const r of receivers.rows) {
    await emitToWs({ type: 'session_revoked', userId: r.owner_user_id, data: { sharedSessionId: msgId } });
  }

  await adminAudit({
    adminUserId: u.userId,
    operateType: 'share_session_revoke',
    detail: { messageId: msgId },
    ip: clientIp(req)
  });
  return ok({ revoked: true, hint: '仅回收本次分发记录，接收方已复制的副本无法回收' });
}
