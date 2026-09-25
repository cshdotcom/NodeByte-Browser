import { authUser, require2faBound } from '@/lib/auth';
import { ok, err, CODE } from '@/lib/status';
import { q, q1 } from '@/lib/db';
import { aesGcmDecrypt } from '@/lib/crypto';

export const dynamic = 'force-dynamic';

/**
 * 导入数据下发通道（浏览器客户端 ↔ 服务端契约，docs/data-import.md）：
 *
 * GET  /api/sync/imported?limit=500
 *   → 返回当前账号「待下发导入区」全部条目（按类型分组，含 batchId）。
 *     密码字段服务端解密后经 TLS 交付给账号本人（登录态 + 2FA 绑定态强校验），
 *     客户端收到后立即转为本地端到端加密数据（AES-GCM 主密钥）。
 *
 * POST { action: 'ack', batchIds: string[] }
 *   → 客户端确认已合并到本地后，删除服务端副本（收敛为零明文、零副本驻留）。
 */
export async function GET(req: Request) {
  const u = await authUser(req);
  if (u instanceof Response) return u;
  const t = await require2faBound(u);
  if (t) return t;

  const limit = Math.min(2000, Math.max(1, Number(new URL(req.url).searchParams.get('limit') ?? 500)));

  const pw = await q<{ id: string; batch_id: string; origin: string; name: string; url: string; username: string; password_enc: string; imported_at: Date }>(
    `SELECT id, batch_id, origin, name, url, username, password_enc, imported_at
       FROM user_imported_passwords WHERE user_id=$1 ORDER BY imported_at ASC LIMIT $2`,
    [u.userId, limit]
  );
  const bm = await q<{ id: string; batch_id: string; title: string; url: string; folder: string; date_added: Date | null; imported_at: Date }>(
    `SELECT id, batch_id, title, url, folder, date_added, imported_at
       FROM user_imported_bookmarks WHERE user_id=$1 ORDER BY imported_at ASC LIMIT $2`,
    [u.userId, limit]
  );
  const hs = await q<{ id: string; batch_id: string; url: string; title: string; visited_at: Date | null; visit_count: number; imported_at: Date }>(
    `SELECT id, batch_id, url, title, visited_at, visit_count, imported_at
       FROM user_imported_history WHERE user_id=$1 ORDER BY imported_at ASC LIMIT $2`,
    [u.userId, limit]
  );

  return ok({
    passwords: pw.rows.map((r) => ({
      id: r.id, batchId: r.batch_id, origin: r.origin, name: r.name, url: r.url,
      username: r.username, password: aesGcmDecrypt(r.password_enc) ?? '', importedAt: r.imported_at
    })),
    bookmarks: bm.rows.map((r) => ({
      id: r.id, batchId: r.batch_id, title: r.title, url: r.url, folder: r.folder, dateAdded: r.date_added, importedAt: r.imported_at
    })),
    history: hs.rows.map((r) => ({
      id: r.id, batchId: r.batch_id, url: r.url, title: r.title, visitedAt: r.visited_at, visitCount: r.visit_count, importedAt: r.imported_at
    }))
  });
}

export async function POST(req: Request) {
  const u = await authUser(req);
  if (u instanceof Response) return u;
  const t = await require2faBound(u);
  if (t) return t;

  let body: { action?: string; batchIds?: string[] };
  try {
    body = (await req.json()) as { action?: string; batchIds?: string[] };
  } catch {
    return err(CODE.BAD_REQUEST, '请求体必须是 JSON');
  }
  if (body.action !== 'ack' || !Array.isArray(body.batchIds) || body.batchIds.length === 0) {
    return err(CODE.BAD_REQUEST, '需要 { action: "ack", batchIds: [...] }');
  }

  const ids = body.batchIds.filter((x) => typeof x === 'string' && x.length > 0);
  await q(`DELETE FROM user_imported_passwords WHERE user_id=$1 AND batch_id = ANY($2::uuid[])`, [u.userId, ids]);
  await q(`DELETE FROM user_imported_bookmarks  WHERE user_id=$1 AND batch_id = ANY($2::uuid[])`, [u.userId, ids]);
  await q(`DELETE FROM user_imported_history    WHERE user_id=$1 AND batch_id = ANY($2::uuid[])`, [u.userId, ids]);
  // 批次全部清空后移除批次记录
  await q(
    `DELETE FROM import_batch b WHERE b.batch_id = ANY($1::uuid[])
       AND NOT EXISTS (SELECT 1 FROM user_imported_passwords p WHERE p.batch_id=b.batch_id)
       AND NOT EXISTS (SELECT 1 FROM user_imported_bookmarks  m WHERE m.batch_id=b.batch_id)
       AND NOT EXISTS (SELECT 1 FROM user_imported_history    h WHERE h.batch_id=b.batch_id)`,
    [ids]
  );
  return ok({ acked: ids.length });
}

/** HEAD 支持：客户端探测是否有待下发数据 */
export async function HEAD() {
  const n = await q1<{ c: string }>(
    `SELECT (SELECT COUNT(*) FROM user_imported_passwords) + (SELECT COUNT(*) FROM user_imported_bookmarks)
           + (SELECT COUNT(*) FROM user_imported_history) AS c`
  ).catch(() => null);
  return new Response(null, { status: 200, headers: { 'x-pending': String(n?.c ?? 0) } });
}
