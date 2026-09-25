import { Client } from 'minio';

/**
 * MinIO / S3 对象存储。
 * 桶规划（服务端提示词 5.11.3）：
 *   drop-files / screenshots / sync-blobs / extension-pool / doc-snapshots / recordings / avatars
 * 全部私有桶，下载走预签名 URL。
 */

let client: Client | null = null;

export function minio(): Client {
  if (client) return client;
  client = new Client({
    endPoint: process.env.MINIO_ENDPOINT || 'localhost',
    port: Number(process.env.MINIO_PORT || 9000),
    useSSL: String(process.env.MINIO_USE_SSL || 'false') === 'true',
    accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
    secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin'
  });
  return client;
}

export const BUCKET = {
  drop: process.env.MINIO_BUCKET_DROP || 'drop-files',
  shots: process.env.MINIO_BUCKET_SHOTS || 'screenshots',
  sync: process.env.MINIO_BUCKET_SYNC || 'sync-blobs',
  ext: process.env.MINIO_BUCKET_EXT || 'extension-pool',
  docs: process.env.MINIO_BUCKET_DOCS || 'doc-snapshots',
  rec: process.env.MINIO_BUCKET_REC || 'recordings',
  avatar: process.env.MINIO_BUCKET_AVATAR || 'avatars'
} as const;

export async function ensureBuckets(): Promise<void> {
  const m = minio();
  for (const b of Object.values(BUCKET)) {
    const exists = await m.bucketExists(b).catch(() => false);
    if (!exists) await m.makeBucket(b, 'us-east-1').catch(() => undefined);
  }
}

/** 预签名 PUT（客户端直传 MinIO，经后端校验配额后签发） */
export function presignPut(bucket: string, key: string, expiresSec = 3600): Promise<string> {
  return minio().presignedPutObject(bucket, key, expiresSec);
}

/** 预签名 GET（下载） */
export function presignGet(bucket: string, key: string, expiresSec = 3600): Promise<string> {
  return minio().presignedGetObject(bucket, key, expiresSec);
}

export function removeObject(bucket: string, key: string): Promise<void> {
  return minio().removeObject(bucket, key).then(() => undefined);
}

export function objectStat(bucket: string, key: string): Promise<{ size: number } | null> {
  return minio()
    .statObject(bucket, key)
    .then((s) => ({ size: s.size }))
    .catch(() => null);
}
