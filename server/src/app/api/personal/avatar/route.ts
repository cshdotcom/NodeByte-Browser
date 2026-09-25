import { q, q1 } from '@/lib/db';
import { CODE, ok, err, readJson } from '@/lib/status';
import { authUser, require2faBound } from '@/lib/auth';
import { BUCKET, presignPut, presignGet, removeObject } from '@/lib/minio';
import { addUsage, checkQuota } from '@/lib/quota';
import { randomToken } from '@/lib/crypto';

export const dynamic = 'force-dynamic';

/**
 * 头像（占用个人配额，特殊元数据文件 file_type=avatar，不在普通文件列表展示）：
 * GET   /api/personal/avatar — 头像预签名 URL
 * POST  /api/personal/avatar { fileName, size } — 预签名上传
 * PATCH /api/personal/avatar { fileId } — 确认并绑定
 * DELETE /api/personal/avatar — 删除
 */
export async function GET(req: Request) {
  const u = await authUser(req);
  if (u instanceof Response) return u;
  const r = await q1<{ avatar_object_key: string | null }>(
    `SELECT avatar_object_key FROM users WHERE user_id = $1`, [u.userId]
  );
  if (!r?.avatar_object_key) return err(CODE.NOT_FOUND, '未设置头像');
  const url = await presignGet(BUCKET.avatar, r.avatar_object_key).catch(() => null);
  if (!url) return err(500, '对象存储不可用');
  return ok({ url });
}

export async function POST(req: Request) {
  const u = await authUser(req);
  if (u instanceof Response) return u;
  const t = await require2faBound(u);
  if (t) return t;

  const body = await readJson<{ fileName?: string; size?: number }>(req);
  const size = Math.max(0, Number(body?.size ?? 0));
  const quota = await checkQuota(u.userId, size);
  if (!quota.allowed) return err(CODE.QUOTA_EXCEEDED, '存储空间已满');

  const key = `${u.userId}/avatar-${randomToken(8)}`;
  const url = await presignPut(BUCKET.avatar, key).catch(() => null);
  if (!url) return err(500, '对象存储不可用');
  const rec = await q1<{ file_id: string }>(
    `INSERT INTO user_file_meta (owner_user_id, file_name, minio_object_key, file_size_bytes, file_type)
     VALUES ($1, $2, $3, $4, 'avatar') RETURNING file_id`,
    [u.userId, body?.fileName ?? 'avatar', key, size]
  );
  return ok({ fileId: rec?.file_id, uploadUrl: url });
}

export async function PATCH(req: Request) {
  const u = await authUser(req);
  if (u instanceof Response) return u;
  const body = await readJson<{ fileId?: string }>(req);
  const meta = await q1<{ owner_user_id: string; minio_object_key: string; file_size_bytes: string | number }>(
    `SELECT owner_user_id, minio_object_key, file_size_bytes FROM user_file_meta WHERE file_id = $1 AND file_type = 'avatar'`,
    [body?.fileId ?? '']
  );
  if (!meta || meta.owner_user_id !== u.userId) return err(CODE.NOT_FOUND, '文件不存在');

  const old = await q1<{ avatar_object_key: string | null }>(`SELECT avatar_object_key FROM users WHERE user_id = $1`, [u.userId]);
  await q(`UPDATE users SET avatar_object_key = $2 WHERE user_id = $1`, [u.userId, meta.minio_object_key]);
  await addUsage(u.userId, Number(meta.file_size_bytes));
  if (old?.avatar_object_key && old.avatar_object_key !== meta.minio_object_key) {
    const oldSize = await q1<{ s: string | number }>(
      `SELECT COALESCE(SUM(file_size_bytes),0) AS s FROM user_file_meta WHERE minio_object_key = $1 AND file_type = 'avatar' AND file_id <> $2`,
      [old.avatar_object_key, body?.fileId ?? '']
    );
    await removeObject(BUCKET.avatar, old.avatar_object_key).catch(() => undefined);
    await addUsage(u.userId, -Number(oldSize?.s ?? 0));
    await q(`DELETE FROM user_file_meta WHERE minio_object_key = $1 AND file_type='avatar' AND file_id <> $2`, [old.avatar_object_key, body?.fileId ?? '']);
  }
  return ok({ avatarUrl: '/api/personal/avatar' });
}

export async function DELETE(req: Request) {
  const u = await authUser(req);
  if (u instanceof Response) return u;
  const r = await q1<{ avatar_object_key: string | null }>(`SELECT avatar_object_key FROM users WHERE user_id = $1`, [u.userId]);
  if (r?.avatar_object_key) {
    const sz = await q1<{ s: string | number }>(
      `SELECT COALESCE(SUM(file_size_bytes),0) AS s FROM user_file_meta WHERE minio_object_key = $1 AND file_type = 'avatar'`, [r.avatar_object_key]
    );
    await removeObject(BUCKET.avatar, r.avatar_object_key).catch(() => undefined);
    await addUsage(u.userId, -Number(sz?.s ?? 0));
    await q(`DELETE FROM user_file_meta WHERE minio_object_key = $1 AND file_type='avatar'`, [r.avatar_object_key]);
    await q(`UPDATE users SET avatar_object_key = NULL WHERE user_id = $1`, [u.userId]);
  }
  return ok({ deleted: true });
}
