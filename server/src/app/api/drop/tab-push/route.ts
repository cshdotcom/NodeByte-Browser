import { q, q1 } from '@/lib/db';
import { CODE, ok, err, readJson } from '@/lib/status';
import { authUser, require2faBound } from '@/lib/auth';
import { emitToWs } from '@/lib/push';
import { userSecurityLog, clientIp } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/**
 * POST /api/drop/tab-push  标签页推送（客户端提示词 5.4.3 / 服务端 5.5.2）
 * body: { url, title, targetDeviceIds?, targetEmails? }
 * 邮箱按逗号/空格分割、trim、去重、校验存在性，不存在的邮箱返回具体报错。
 */
export async function POST(req: Request) {
  const u = await authUser(req);
  if (u instanceof Response) return u;
  const t = await require2faBound(u);
  if (t) return t;

  const body = await readJson<{ url?: string; title?: string; targetDeviceIds?: string[]; targetEmails?: string }>(req);
  if (!body?.url) return err(CODE.BAD_REQUEST, '缺少 url');
  const emails = [...new Set((body.targetEmails ?? '').split(/[,;\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean))];
  const deviceIds = body.targetDeviceIds ?? [];

  let invalidEmails: string[] = [];
  if (emails.length > 0) {
    const found = await q<{ email: string; user_id: string }>(`SELECT email, user_id FROM users WHERE email = ANY($1)`, [emails]);
    invalidEmails = emails.filter((e) => !found.rows.some((f) => f.email === e));
    for (const row of found.rows) {
      await q(
        `INSERT INTO device_push_message (sender_user_id, send_type, payload, target_user_emails)
         VALUES ($1, 'tab_page', $2::jsonb, $3)`,
        [u.userId, JSON.stringify({ url: body.url, title: body.title ?? '', from: u.email }), JSON.stringify([row.email])]
      );
      await emitToWs({ type: 'push_message', userId: row.user_id, data: { pushType: 'tab_page', payload: { url: body.url, title: body.title ?? '', from: u.email } } });
    }
  }

  await q(
    `INSERT INTO device_push_message (sender_user_id, send_type, payload, target_device_ids)
     VALUES ($1, 'tab_page', $2::jsonb, $3)`,
    [u.userId, JSON.stringify({ url: body.url, title: body.title ?? '' }), deviceIds]
  );
  for (const d of deviceIds) {
    await emitToWs({ type: 'push_message', deviceId: d, data: { pushType: 'tab_page', payload: { url: body.url, title: body.title ?? '', from: u.email } } });
  }
  await userSecurityLog({ userId: u.userId, eventType: 'push_tab', detail: { emails, deviceIds }, ip: clientIp(req) });
  return ok({ invalidEmails, deliveredDevices: deviceIds.length });
}
