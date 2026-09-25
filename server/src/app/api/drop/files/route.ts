import { q, q1 } from '@/lib/db';
import { CODE, ok, err, readJson } from '@/lib/status';
import { authUser, require2faBound, requireFeature } from '@/lib/auth';
import { checkQuota, addUsage } from '@/lib/quota';
import { BUCKET, presignPut, presignGet, removeObject } from '@/lib/minio';
import { randomToken } from '@/lib/crypto';
import { emitToWs } from '@/lib/push';

export const dynamic = 'force-dynamic';

/**
 * Drop 文件（服务端提示词 5.5 / E.4）：
 * GET  /api/drop/files?type=drop_file — 文件列表（头像等特殊元数据文件不在普通列表展示）
 * POST /api/drop/files { fileName, size, fileType, isEncrypted } — 配额校验 → 预签名 PUT → 待确认
 *      { action:'confirm', fileId } — 直传完成确认，登记元数据并累加用量
 */
export async function GET(req: Request) {
  const u = await authUser(req);
  if (u instanceof Response) return u;
  const t = await require2faBound(u);
  if (t) return t;

  const fileType = new URL(req.url).searchParams.get('type');
  const params: unknown[] = [u.userId];
  let where = `owner_user_id = $1 AND file_type <> 'avatar'`;
  if (fileType) {
    params.push(fileType);
    where += ` AND file_type = $2`;
  }
  const rows = await q(
    `SELECT file_id, file_name, file_size_bytes, file_type, is_encrypted_client_side, created_at
       FROM user_file_meta WHERE ${where} ORDER BY created_at DESC LIMIT 200`,
    params
  );
  return ok({ files: rows.rows });
}

export async function POST(req: Request) {
  const u = await authUser(req);
  if (u instanceof Response) return u;
  const t = await require2faBound(u);
  if (t) return t;
  const f = await requireFeature(u, 'allow_drop_file_screenshot');
  if (f) return f;

  const body = await readJson<{
    action?: 'create' | 'confirm';
    fileName?: string; size?: number; fileType?: string; isEncrypted?: boolean;
    fileId?: string;
  }>(req);

  if (body?.action === 'confirm') {
    if (!body.fileId) return err(CODE.BAD_REQUEST, '缺少 fileId');
    const meta = await q1<{ file_id: string; owner_user_id: string; minio_object_key: string; file_size_bytes: string | number; is_confirmed?: boolean }>(
      `SELECT file_id, owner_user_id, minio_object_key, file_size_bytes FROM user_file_meta WHERE file_id = $1`,
      [body.fileId]
    );
    if (!meta || meta.owner_user_id !== u.userId) return err(CODE.NOT_FOUND, '文件不存在');
    const { objectStat } = await import('@/lib/minio');
    const bucket = bucketOf((await q1<{ file_type: string }>(`SELECT file_type FROM user_file_meta WHERE file_id=$1`, [body.fileId]))?.file_type ?? 'drop_file');
    const stat = await objectStat(bucket, meta.minio_object_key);
    if (!stat) return err(CODE.BAD_REQUEST, '尚未检测到上传的文件内容');
    await addUsage(u.userId, Number(meta.file_size_bytes));
    return ok({ confirmed: true, sizeBytes: stat.size });
  }

  const fileName = body?.fileName?.trim();
  const size = Math.max(0, Number(body?.size ?? 0));
  const fileType = ['drop_file', 'screenshot', 'sync_extension_crx', 'sync_blob', 'user_backup_export', 'note_file', 'avatar']
    .includes(body?.fileType ?? '') ? body!.fileType! : 'drop_file';
  if (!fileName) return err(CODE.BAD_REQUEST, '缺少 fileName');

  // 配额校验：超限 41301「存储空间已满」
  const quota = await checkQuota(u.userId, size);
  if (!quota.allowed) return err(CODE.QUOTA_EXCEEDED, '存储空间已满，拒绝上传');

  const objectKey = `${u.userId}/${randomToken(8)}/${fileName}`;
  const bucket = bucketOf(fileType);
  const uploadUrl = await presignPut(bucket, objectKey).catch(() => null);
  if (!uploadUrl) return err(CODE.SERVER_ERROR, '对象存储不可用');

  const rec = await q1<{ file_id: string }>(
    `INSERT INTO user_file_meta (owner_user_id, file_name, minio_object_key, file_size_bytes, file_type, is_encrypted_client_side, group_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING file_id`,
    [u.userId, fileName, objectKey, size, fileType, Boolean(body?.isEncrypted), u.groupId]
  );
  return ok({ fileId: rec?.file_id, uploadUrl, bucket });
}

export async function DELETE(req: Request) {
  const u = await authUser(req);
  if (u instanceof Response) return u;
  const fileId = new URL(req.url).searchParams.get('fileId') ?? '';
  const meta = await q1<{ owner_user_id: string; minio_object_key: string; file_size_bytes: string | number; file_type: string }>(
    `SELECT owner_user_id, minio_object_key, file_size_bytes, file_type FROM user_file_meta WHERE file_id = $1`,
    [fileId]
  );
  if (!meta || meta.owner_user_id !== u.userId) return err(CODE.NOT_FOUND, '文件不存在');
  await removeObject(bucketOf(meta.file_type), meta.minio_object_key).catch(() => undefined);
  await q(`DELETE FROM user_file_meta WHERE file_id = $1`, [fileId]);
  await addUsage(u.userId, -Number(meta.file_size_bytes));
  return ok({ deleted: true });
}

function bucketOf(fileType: string): string {
  switch (fileType) {
    case 'screenshot': return BUCKET.shots;
    case 'sync_blob': return BUCKET.sync;
    case 'sync_extension_crx': return BUCKET.ext;
    case 'avatar': return BUCKET.avatar;
    case 'user_backup_export': return BUCKET.sync;
    default: return BUCKET.drop;
  }
}
