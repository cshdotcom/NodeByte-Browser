import { q1 } from '@/lib/db';
import { CODE, ok, err } from '@/lib/status';
import { authUser, require2faBound } from '@/lib/auth';
import { BUCKET, presignGet } from '@/lib/minio';

export const dynamic = 'force-dynamic';

/** GET /api/drop/files/[id] — 返回预签名下载 URL；客户端密文提示「服务端无法解密」 */
export async function GET(req: Request, ctx: { params: { id: string } }) {
  const u = await authUser(req);
  if (u instanceof Response) return u;
  const t = await require2faBound(u);
  if (t) return t;

  const meta = await q1<{ owner_user_id: string; minio_object_key: string; file_type: string; file_name: string; is_encrypted_client_side: boolean }>(
    `SELECT owner_user_id, minio_object_key, file_type, file_name, is_encrypted_client_side FROM user_file_meta WHERE file_id = $1`,
    [ctx.params.id]
  );
  if (!meta || (meta.owner_user_id !== u.userId && !u.isAdmin)) return err(404, '文件不存在');

  const bucket =
    meta.file_type === 'screenshot' ? BUCKET.shots :
    meta.file_type === 'avatar' ? BUCKET.avatar :
    meta.file_type === 'sync_extension_crx' ? BUCKET.ext : BUCKET.drop;

  const url = await presignGet(bucket, meta.minio_object_key).catch(() => null);
  if (!url) return err(500, '对象存储不可用');
  return ok({
    fileName: meta.file_name,
    downloadUrl: url,
    isEncryptedClientSide: meta.is_encrypted_client_side,
    hint: meta.is_encrypted_client_side ? '该文件为客户端加密密文，服务端无法解密，下载后也不能查看内容' : null
  });
}
