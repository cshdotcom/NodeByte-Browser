import { q, q1 } from '@/lib/db';
import { CODE, ok, err, readJson } from '@/lib/status';
import { authUser, require2faBound, requireFeature } from '@/lib/auth';
import { BUCKET, presignPut, presignGet } from '@/lib/minio';
import { randomToken } from '@/lib/crypto';
import { emitToWs } from '@/lib/push';
import { userSecurityLog, clientIp } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/**
 * Cookie 登录上下文分享（高危，服务端提示词 5.5.3；明文 Cookie 绝不入库）：
 * GET  /api/drop/sessions — 我收到/我发出的会话列表
 * POST /api/drop/sessions
 *   step=create: { step:'create', displayName?, noteTag?, targetEmails } → 校验发送方密码（body.password）
 *                → 生成上传 URL（接收客户端加密包）→ 消息与映射在 confirm 时落库
 *   step=confirm:{ step:'confirm', sessionId } → 确认上传完成，生成推送消息 + user_shared_session_store
 */
export async function GET(req: Request) {
  const u = await authUser(req);
  if (u instanceof Response) return u;
  const t = await require2faBound(u);
  if (t) return t;

  const received = await q(
    `SELECT s.shared_session_id, s.sender_user_id, su.username AS sender_name, s.display_name, s.note_tag,
            s.is_effective, s.received_at, m.is_session_revoked
       FROM user_shared_session_store s
       LEFT JOIN device_push_message m ON m.msg_id = s.source_msg_id
       LEFT JOIN users su ON su.user_id = s.sender_user_id
      WHERE s.owner_user_id = $1 ORDER BY s.received_at DESC`,
    [u.userId]
  );
  return ok({ received: received.rows });
}

export async function POST(req: Request) {
  const u = await authUser(req);
  if (u instanceof Response) return u;
  const t = await require2faBound(u);
  if (t) return t;

  const body = await readJson<{
    step?: 'create' | 'confirm'; displayName?: string; noteTag?: string;
    targetEmails?: string; password?: string; sessionId?: string;
  }>(req);

  // 会话分享功能开关（用户组黑白名单）
  const share = await requireFeature(u, 'allow_share_session_context');
  if (share) return share;

  if (body?.step === 'confirm') {
    const s = await q1<{ owner_user_id: string; minio_encrypted_key: string; display_name: string | null; note_tag: string | null }>(
      `SELECT * FROM pending_share_sessions WHERE session_id = $1 AND sender_user_id = $2`,
      [body.sessionId ?? '', u.userId]
    ).catch(() => null);
    if (!s) return err(404, '分享会话不存在');

    const emails = (await q1<{ emails: string[] }>(`SELECT target_emails AS emails FROM pending_share_sessions WHERE session_id = $1`, [body.sessionId ?? '']))?.emails ?? [];
    const found = await q<{ email: string; user_id: string }>(`SELECT email, user_id FROM users WHERE email = ANY($1)`, [emails]);
    const msg = await q1<{ msg_id: string }>(
      `INSERT INTO device_push_message (sender_user_id, send_type, payload, target_user_emails, is_client_encrypted)
       VALUES ($1, 'session_context', $2::jsonb, $3, true) RETURNING msg_id`,
      [u.userId, JSON.stringify({ objectKey: s.minio_encrypted_key, displayName: s.display_name, noteTag: s.note_tag }), JSON.stringify(emails)]
    );
    for (const row of found.rows) {
      await q(
        `INSERT INTO user_shared_session_store (owner_user_id, source_msg_id, sender_user_id, display_name, note_tag, minio_encrypted_key)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [row.user_id, msg?.msg_id, u.userId, s.display_name, s.note_tag, s.minio_encrypted_key]
      );
      await emitToWs({ type: 'push_message', userId: row.user_id, data: { pushType: 'session_context', payload: { from: u.email, displayName: s.display_name } } });
    }
    await q(`DELETE FROM pending_share_sessions WHERE session_id = $1`, [body.sessionId]);
    await userSecurityLog({ userId: u.userId, eventType: 'share_session_context', detail: { targets: emails }, ip: clientIp(req) });
    return ok({ delivered: found.rows.length, invalidEmails: emails.filter((e) => !found.rows.some((f) => f.email === e)) });
  }

  // step=create：强制校验本机账号密码（服务端提示词 5.5.3：发送前强制校验）
  const bcrypt = (await import('bcryptjs')).default;
  const r = await q1<{ password_hash: string }>(`SELECT password_hash FROM users WHERE user_id = $1`, [u.userId]);
  if (!r || !(await bcrypt.compare(body?.password ?? '', r.password_hash)))
    return err(401, '密码校验失败：分享登录上下文前必须验证账号密码');

  const emails = [...new Set((body?.targetEmails ?? '').split(/[,;\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean))];
  if (emails.length === 0) return err(400, '请提供目标用户邮箱');
  const exists = await q<{ email: string }>(`SELECT email FROM users WHERE email = ANY($1)`, [emails]);
  const invalid = emails.filter((e) => !exists.rows.some((f) => f.email === e));
  if (invalid.length > 0) return err(400, `以下邮箱不存在系统账号，无法邀请: ${invalid.join(', ')}`);

  const objectKey = `${u.userId}/shared-session/${randomToken(16)}.bin`;
  const uploadUrl = await presignPut(BUCKET.sync, objectKey).catch(() => null);
  if (!uploadUrl) return err(500, '对象存储不可用');

  await q1(
    `INSERT INTO pending_share_sessions (session_id, sender_user_id, display_name, note_tag, minio_encrypted_key, target_emails)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [crypto.randomUUID(), u.userId, body?.displayName ?? null, body?.noteTag ?? null, objectKey, emails]
  );
  return ok({ sessionId: (await q1<{ session_id: string }>(`SELECT session_id FROM pending_share_sessions WHERE sender_user_id=$1 ORDER BY created_at DESC LIMIT 1`, [u.userId]))?.session_id, uploadUrl });
}
