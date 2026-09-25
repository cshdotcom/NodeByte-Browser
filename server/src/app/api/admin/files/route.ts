import bcrypt from 'bcryptjs';
import { q, q1 } from '@/lib/db';
import { CODE, ok, err, readJson } from '@/lib/status';
import { authAdmin } from '@/lib/auth';
import { BUCKET, presignGet, removeObject } from '@/lib/minio';
import { adminAudit, clientIp } from '@/lib/audit';
import { randomToken } from '@/lib/crypto';

export const dynamic = 'force-dynamic';

/**
 * 文件管理 + 管理员二次鉴权（服务端提示词 5.8.2 / E.5）：
 * POST /api/admin/files { action:'verify', password, targetUserId|null } → admin_session（15 分钟，绑定 target，不能跨用户）
 * GET  /api/admin/files?targetUserId=xx&type=&q=&page=  （Header x-admin-session 必须）
 * GET  /api/admin/files?download=fileId  → 预签名 URL（密文文件明示无法解密）
 * DELETE /api/admin/files?fileId=xx
 */
export async function POST(req: Request) {
  const admin = await authAdmin(req);
  if (admin instanceof Response) return admin;
  const body = await readJson<{ action?: string; password?: string; targetUserId?: string | null }>(req);

  if (body?.action !== 'verify') return err(CODE.BAD_REQUEST, '未知操作');
  const r = await q1<{ password_hash: string }>(`SELECT password_hash FROM users WHERE user_id = $1`, [admin.userId]);
  if (!r || !(await bcrypt.compare(body.password ?? '', r.password_hash))) {
    await adminAudit({ adminUserId: admin.userId, targetUserId: body.targetUserId ?? null, operateType: 'admin_verify', detail: { ok: false }, ip: clientIp(req) });
    return err(CODE.UNAUTHORIZED, '管理员密码错误');
  }
  const s = await q1<{ id: string; valid_until: Date }>(
    `INSERT INTO admin_session (admin_user_id, target_user_id, valid_until)
     VALUES ($1, $2, now() + interval '15 minutes') RETURNING id, valid_until`,
    [admin.userId, body.targetUserId || null]
  );
  await adminAudit({ adminUserId: admin.userId, targetUserId: body.targetUserId ?? null, operateType: 'admin_verify', detail: { ok: true }, ip: clientIp(req) });
  return ok({ adminSessionId: s?.id, validUntil: s?.valid_until }, '二次鉴权通过（15 分钟有效）');
}

export async function GET(req: Request) {
  const admin = await authAdmin(req);
  if (admin instanceof Response) return admin;

  const url = new URL(req.url);
  const download = url.searchParams.get('download');

  // 下载：需要有效二次鉴权会话（全局搜索时 target_user_id=null 的会话）
  if (download) {
    const meta = await q1<{ owner_user_id: string; minio_object_key: string; file_type: string; file_name: string; is_encrypted_client_side: boolean }>(
      `SELECT owner_user_id, minio_object_key, file_type, file_name, is_encrypted_client_side FROM user_file_meta WHERE file_id = $1`, [download]
    );
    if (!meta) return err(CODE.NOT_FOUND, '文件不存在');
    const s = await q1<{ id: string; target_user_id: string | null; valid_until: Date }>(
      `SELECT id, target_user_id, valid_until FROM admin_session WHERE id = $1 AND admin_user_id = $2 AND valid_until > now()`,
      [url.searchParams.get('adminSession') ?? '', admin.userId]
    );
    if (!s || (meta.owner_user_id !== s.target_user_id && s.target_user_id !== null))
      return err(CODE.NO_PERMISSION, '二次鉴权会话与目标用户不匹配');

    const bucket = meta.file_type === 'screenshot' ? BUCKET.shots : meta.file_type === 'avatar' ? BUCKET.avatar :
      meta.file_type === 'sync_extension_crx' ? BUCKET.ext : meta.file_type === 'sync_blob' ? BUCKET.sync : BUCKET.drop;
    const u = await presignGet(bucket, meta.minio_object_key).catch(() => null);
    await adminAudit({ adminUserId: admin.userId, targetUserId: meta.owner_user_id, operateType: 'download_file', targetFileId: download, ip: clientIp(req) });
    return ok({
      downloadUrl: u,
      isEncryptedClientSide: meta.is_encrypted_client_side,
      hint: meta.is_encrypted_client_side ? '服务端无法解密，下载后也不能查看内容' : null
    });
  }

  const targetUserId = url.searchParams.get('targetUserId');
  const fileType = url.searchParams.get('type') ?? '';
  const search = url.searchParams.get('q')?.trim() ?? '';
  const page = Math.max(1, Number(url.searchParams.get('page') ?? 1));
  const pageSize = 20;

  const conds = ['1=1'];
  const params: unknown[] = [];
  if (targetUserId) { params.push(targetUserId); conds.push(`f.owner_user_id = $${params.length}::uuid`); }
  if (fileType) { params.push(fileType); conds.push(`f.file_type = $${params.length}`); }
  if (search) { params.push(`%${search}%`); conds.push(`f.file_name ILIKE $${params.length}`); }
  const where = conds.join(' AND ');

  const total = await q1<{ n: string }>(`SELECT count(*) AS n FROM user_file_meta f WHERE ${where}`, params);
  params.push(pageSize, (page - 1) * pageSize);
  const rows = await q(
    `SELECT f.file_id, f.file_name, f.file_size_bytes, f.file_type, f.is_encrypted_client_side, f.created_at,
            u.username, u.email
       FROM user_file_meta f JOIN users u ON u.user_id = f.owner_user_id
      WHERE ${where} ORDER BY f.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return ok({ total: Number(total?.n ?? 0), page, files: rows.rows });
}

export async function DELETE(req: Request) {
  const admin = await authAdmin(req);
  if (admin instanceof Response) return admin;
  const url = new URL(req.url);
  const fileId = url.searchParams.get('fileId') ?? '';
  const meta = await q1<{ owner_user_id: string; minio_object_key: string; file_size_bytes: string | number; file_type: string }>(
    `SELECT owner_user_id, minio_object_key, file_size_bytes, file_type FROM user_file_meta WHERE file_id = $1`, [fileId]
  );
  if (!meta) return err(CODE.NOT_FOUND, '文件不存在');

  const s = await q1<{ target_user_id: string | null; valid_until: Date }>(
    `SELECT target_user_id, valid_until FROM admin_session WHERE id = $1 AND admin_user_id = $2 AND valid_until > now()`,
    [url.searchParams.get('adminSession') ?? '', admin.userId]
  );
  if (!s || (meta.owner_user_id !== s.target_user_id && s.target_user_id !== null))
    return err(CODE.NO_PERMISSION, '需要对该用户有效的二次鉴权会话');

  const bucket = meta.file_type === 'screenshot' ? BUCKET.shots : meta.file_type === 'avatar' ? BUCKET.avatar :
    meta.file_type === 'sync_extension_crx' ? BUCKET.ext : meta.file_type === 'sync_blob' ? BUCKET.sync : BUCKET.drop;
  await removeObject(bucket, meta.minio_object_key).catch(() => undefined);
  await q(`DELETE FROM user_file_meta WHERE file_id = $1`, [fileId]);
  await q(
    `UPDATE user_cloud_usage SET used_bytes = GREATEST(used_bytes - $2, 0) WHERE user_id = $1`,
    [meta.owner_user_id, Number(meta.file_size_bytes)]
  );
  await adminAudit({ adminUserId: admin.userId, targetUserId: meta.owner_user_id, operateType: 'delete_file', targetFileId: fileId, ip: clientIp(req) });
  return ok({ deleted: true });
}
