import { q, q1 } from '@/lib/db';
import { CODE, ok, err } from '@/lib/status';
import { authUser, require2faBound } from '@/lib/auth';
import { checkQuota, addUsage } from '@/lib/quota';
import { BUCKET, presignGet, objectStat } from '@/lib/minio';
import { sha256Hex } from '@/lib/crypto';

export const dynamic = 'force-dynamic';

/**
 * 同步 API：/api/sync/[type]
 * type ∈ bookmarks | history | settings | cookie_sets | fingerprints | proxy | extensions | passwords | preferences
 *
 * 服务端铁律：body.blob 为客户端 AES-GCM 加密后的密文（Base64），服务端只存 MinIO + 元数据，永不解密。
 * 策略校验：CustomAllowSync=false 或 type ∈ CustomSyncDisabledTypes → 40303（后端同样校验，不能只靠客户端）。
 *
 * GET  ?since=<version>  → 列出该类型自版本之后的密文快照（带预签名下载 URL）
 * POST { lastVersion, blob, meta?, snapshotType? } → 配额校验 → 存 MinIO → 登记版本
 */

const SYNC_TYPES = new Set([
  'bookmarks', 'history', 'settings', 'cookie_sets', 'fingerprints', 'proxy', 'extensions', 'passwords', 'preferences'
]);

type Ctx = { params: { type: string } };

async function syncGuard(userId: string, groupId: string | null, overrideJson: Record<string, unknown> | null, dataType: string): Promise<Response | null> {
  const g = await q1<{ global: Record<string, unknown> }>(
    `SELECT setting_value AS global FROM system_setting WHERE setting_key='global_policy'`
  );
  const mandatory: Record<string, unknown> = {
    ...((g?.global as { mandatory?: Record<string, unknown> })?.mandatory ?? {})
  };
  if (groupId) {
    const gs = await q1<{ mj: Record<string, unknown> }>(
      `SELECT ps.mandatory_json AS mj FROM user_group ug JOIN policy_set ps ON ps.policy_set_id = ug.policy_set_id WHERE ug.group_id = $1`,
      [groupId]
    );
    Object.assign(mandatory, gs?.mj ?? {});
  }
  if (overrideJson?.mandatory) Object.assign(mandatory, overrideJson.mandatory);

  if (mandatory['CustomAllowSync'] === false) return err(CODE.NO_PERMISSION, '同步已被组织管理员关闭');
  const disabled = (mandatory['CustomSyncDisabledTypes'] as string[] | undefined) ?? [];
  if (disabled.includes(dataType)) return err(CODE.NO_PERMISSION, `该数据类型禁止同步: ${dataType}`);
  return null;
}

export async function GET(req: Request, ctx: Ctx) {
  const u = await authUser(req);
  if (u instanceof Response) return u;
  const t = await require2faBound(u);
  if (t) return t;

  const dataType = ctx.params.type;
  if (!SYNC_TYPES.has(dataType)) return err(CODE.BAD_REQUEST, `不支持的同步类型: ${dataType}`);
  const guard = await syncGuard(u.userId, u.groupId, u.overridePolicyJson, dataType);
  if (guard) return guard;

  const since = Number(new URL(req.url).searchParams.get('since') ?? 0);
  const rows = await q<{ snapshot_id: string; version: string; snapshot_type: string; minio_blob_key: string | null; size_bytes: string | number; created_at: Date }>(
    `SELECT snapshot_id, version, snapshot_type, minio_blob_key, size_bytes, created_at
       FROM sync_snapshot WHERE user_id = $1 AND data_type = $2 AND version > $3
      ORDER BY version ASC LIMIT 200`,
    [u.userId, dataType, since]
  );
  const items = [];
  for (const r of rows.rows) {
    items.push({
      snapshotId: r.snapshot_id,
      version: Number(r.version),
      snapshotType: r.snapshot_type,
      sizeBytes: Number(r.size_bytes),
      createdAt: r.created_at,
      downloadUrl: r.minio_blob_key ? await presignGet(BUCKET.sync, r.minio_blob_key).catch(() => null) : null
    });
  }
  const latest = await q1<{ v: string | null }>(
    `SELECT MAX(version)::text AS v FROM sync_snapshot WHERE user_id = $1 AND data_type = $2`,
    [u.userId, dataType]
  );
  return ok({ dataType, latestVersion: Number(latest?.v ?? 0), items });
}

export async function POST(req: Request, ctx: Ctx) {
  const u = await authUser(req);
  if (u instanceof Response) return u;
  const t = await require2faBound(u);
  if (t) return t;

  const dataType = ctx.params.type;
  if (!SYNC_TYPES.has(dataType)) return err(CODE.BAD_REQUEST, `不支持的同步类型: ${dataType}`);
  const guard = await syncGuard(u.userId, u.groupId, u.overridePolicyJson, dataType);
  if (guard) return guard;

  let body: { lastVersion?: number; blob?: string; meta?: Record<string, unknown>; snapshotType?: 'real_time_delta' | 'manual_backup' };
  try {
    body = await req.json();
  } catch {
    return err(CODE.BAD_REQUEST, '请求体必须是 JSON');
  }
  const blob = body.blob ?? '';
  const sizeBytes = Math.floor((blob.length * 3) / 4); // base64 近似
  const snapshotType = body.snapshotType === 'manual_backup' ? 'manual_backup' : 'real_time_delta';

  const prev = await q1<{ v: string | null }>(
    `SELECT MAX(version)::text AS v FROM sync_snapshot WHERE user_id = $1 AND data_type = $2`,
    [u.userId, dataType]
  );
  const lastVersion = Number(prev?.v ?? 0);
  const version = lastVersion + 1;

  // 配额校验（超限 41301）
  const quota = await checkQuota(u.userId, sizeBytes);
  if (!quota.allowed) return err(CODE.QUOTA_EXCEEDED, '存储空间已满');

  const objectKey = `${u.userId}/${dataType}/${version}-${sha256Hex(blob).slice(0, 16)}.bin`;
  // 密文经预签名 PUT 直传；服务端不接触明文
  const { presignPut } = await import('@/lib/minio');
  const uploadUrl = await presignPut(BUCKET.sync, objectKey).catch(() => null);
  if (!uploadUrl) return err(CODE.SERVER_ERROR, '对象存储不可用');

  // 直接登记（客户端直传完成后调用 confirm；此处同时支持服务端代理接收 blob 的简化模式）
  if (blob) {
    const { minio } = await import('@/lib/minio');
    const buf = Buffer.from(blob, 'base64');
    await minio().putObject(BUCKET.sync, objectKey, buf).catch(() => undefined);
  }

  await q(
    `INSERT INTO sync_snapshot (user_id, snapshot_type, data_type, version, delta_meta, minio_blob_key, size_bytes, expire_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)`,
    [
      u.userId, snapshotType, dataType, version,
      JSON.stringify({ ...(body.meta ?? {}), isClientEncrypted: true }),
      objectKey, sizeBytes,
      snapshotType === 'manual_backup' ? new Date(Date.now() + 90 * 86400_000) : new Date(Date.now() + 30 * 86400_000)
    ]
  );
  await addUsage(u.userId, sizeBytes);

  return ok({
    version,
    snapshotType,
    uploadUrl: blob ? undefined : uploadUrl,
    objectKey
  });
}
