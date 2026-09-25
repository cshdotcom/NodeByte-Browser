/**
 * NodeByte All-in-One —— 七个业务桶初始化（supervisord 一次性任务）
 * 等 RustFS（S3 兼容，minio SDK 客户端直连）就绪（最多 ~120s）→ 逐个建桶 → 退出码 0
 */
import { createRequire } from 'node:module';

const require = createRequire('/app/tools/package.json');
const { Client } = require('minio');

const ENDPOINT = process.env.MINIO_ENDPOINT || '127.0.0.1';
const PORT = Number(process.env.MINIO_PORT || 9000);
const USE_SSL = String(process.env.MINIO_USE_SSL || 'false') === 'true';
const ACCESS_KEY = process.env.MINIO_ROOT_USER || process.env.MINIO_ACCESS_KEY || 'nodebyte';
const SECRET_KEY = process.env.MINIO_ROOT_PASSWORD || process.env.MINIO_SECRET_KEY || '';

// 与 server/src/lib/minio.ts BUCKET 一致
const BUCKETS = [
  'drop-files', 'screenshots', 'sync-blobs',
  'extension-pool', 'doc-snapshots', 'recordings', 'avatars'
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function makeClient() {
  return new Client({
    endPoint: ENDPOINT, port: PORT, useSSL: USE_SSL,
    accessKey: ACCESS_KEY, secretKey: SECRET_KEY,
  });
}

async function ready(mc) {
  await mc.listBuckets();
}

let mc = await makeClient();
for (let i = 1; i <= 40; i++) {
  try {
    await ready(mc);
    console.log(`[bucket-init] S3 storage ready at ${ENDPOINT}:${PORT}`);
    break;
  } catch (e) {
    if (i === 40) {
      console.error('[bucket-init] S3 storage not reachable, giving up:', e.message);
      process.exit(1);
    }
    await sleep(3000);
  }
}

for (const b of BUCKETS) {
  try {
    const exists = await mc.bucketExists(b).catch(() => false);
    if (!exists) {
      await mc.makeBucket(b, 'us-east-1');
      console.log(`[bucket-init] created bucket: ${b}`);
    } else {
      console.log(`[bucket-init] bucket exists: ${b}`);
    }
  } catch (e) {
    console.error(`[bucket-init] bucket ${b} failed:`, e.message);
    process.exit(1);
  }
}
console.log('[bucket-init] all buckets ready');
