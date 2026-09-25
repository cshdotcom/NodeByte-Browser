import { q, q1 } from '@/lib/db';
import { CODE, ok, err } from '@/lib/status';
import { authUser, require2faBound } from '@/lib/auth';
import { emitToWs } from '@/lib/push';

export const dynamic = 'force-dynamic';

/**
 * GET  /api/drop/messages?limit=50 — 当前用户的 Drop 消息（发送/接收）
 * POST /api/drop/messages — 发送文本消息/笔记：{ text, targetEmails?, targetDeviceIds? }
 *   targetEmails 支持逗号/空格分隔批量；不存在的邮箱明确报错（不存在的返回 invalidEmails）。
 */
export async function GET(req: Request) {
  const u = await authUser(req);
  if (u instanceof Response) return u;
  const t = await require2faBound(u);
  if (t) return t;

  const limit = Math.min(Number(new URL(req.url).searchParams.get('limit') ?? 50), 200);
  const rows = await q(
    `SELECT m.msg_id, m.sender_user_id, su.username AS sender_name, m.send_type, m.payload,
            m.target_device_ids, m.target_user_emails, m.is_session_revoked, m.created_at
       FROM device_push_message m
       JOIN users su ON su.user_id = m.sender_user_id
      WHERE m.sender_user_id = $1
         OR m.target_user_emails @> ARRAY[$2::text]
         OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(m.target_user_emails::jsonb) e(el) WHERE e.el = $2)
      ORDER BY m.created_at DESC LIMIT $3`,
    [u.userId, u.email, limit]
  );
  return ok({ messages: rows.rows });
}

export async function POST(req: Request) {
  const u = await authUser(req);
  if (u instanceof Response) return u;
  const t = await require2faBound(u);
  if (t) return t;

  const body = (await req.json().catch(() => null)) as {
    text?: string; targetEmails?: string; targetDeviceIds?: string[];
  } | null;
  if (!body?.text) return err(CODE.BAD_REQUEST, '消息内容不能为空');

  const emails = parseEmails(body.targetEmails ?? '');
  let invalidEmails: string[] = [];
  let targetIds: string[] = body.targetDeviceIds ?? [];
  if (emails.length > 0) {
    const found = await q<{ email: string; user_id: string }>(
      `SELECT email, user_id FROM users WHERE email = ANY($1)`, [emails]
    );
    invalidEmails = emails.filter((e) => !found.rows.some((f) => f.email === e));
    if (invalidEmails.length === emails.length && targetIds.length === 0)
      return err(CODE.NOT_FOUND, `以下邮箱不存在系统账号，无法发送: ${invalidEmails.join(', ')}`);
    // 文本消息对目标用户各生成一条推送
    for (const row of found.rows) {
      await q(
        `INSERT INTO device_push_message (sender_user_id, send_type, payload, target_user_emails)
         VALUES ($1, 'text', $2::jsonb, $3)`,
        [u.userId, JSON.stringify({ text: body.text, from: u.email }), JSON.stringify([row.email])]
      );
      await emitToWs({ type: 'push_message', userId: row.user_id, data: { pushType: 'text', payload: { text: body.text, from: u.email } } });
    }
  }

  // 自留一份（同账号其他设备可见）
  const msg = await q1<{ msg_id: string }>(
    `INSERT INTO device_push_message (sender_user_id, send_type, payload, target_device_ids, target_user_emails)
     VALUES ($1, 'text', $2::jsonb, $3, $4) RETURNING msg_id`,
    [u.userId, JSON.stringify({ text: body.text }), targetIds, JSON.stringify(emails)]
  );
  return ok({ msgId: msg?.msg_id, invalidEmails });
}

function parseEmails(input: string): string[] {
  return [...new Set(input.split(/[,;\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean))];
}
