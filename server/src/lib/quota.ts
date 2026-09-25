import { q, q1 } from './db';

/**
 * 配额体系（服务端提示词 5.2.4 / E.4）：
 * 优先级：用户独立 override_cloud_quota_mb > 用户组 cloud_drop_quota_mb > 全局默认 default_quota_mb
 * 超限返回业务码 41301「存储空间已满」。
 */

export async function getEffectiveQuotaMb(userId: string): Promise<number> {
  const u = await q1<{ override_cloud_quota_mb: number | null; group_id: string | null }>(
    `SELECT override_cloud_quota_mb, group_id FROM users WHERE user_id = $1`,
    [userId]
  );
  if (u?.override_cloud_quota_mb != null) return u.override_cloud_quota_mb;
  if (u?.group_id) {
    const g = await q1<{ cloud_drop_quota_mb: number }>(
      `SELECT cloud_drop_quota_mb FROM user_group WHERE group_id = $1`,
      [u.group_id]
    );
    if (g) return g.cloud_drop_quota_mb;
  }
  const d = await q1<{ v: number }>(
    `SELECT (setting_value)::int AS v FROM system_setting WHERE setting_key='default_quota_mb'`
  );
  return d?.v ?? 10240;
}

export async function getUsedBytes(userId: string): Promise<number> {
  const r = await q1<{ used_bytes: string | number }>(
    `SELECT used_bytes FROM user_cloud_usage WHERE user_id = $1`,
    [userId]
  );
  return Number(r?.used_bytes ?? 0);
}

export type QuotaCheck = { allowed: boolean; totalMb: number; usedBytes: number };

export async function checkQuota(userId: string, additionalBytes: number): Promise<QuotaCheck> {
  const [totalMb, usedBytes] = await Promise.all([getEffectiveQuotaMb(userId), getUsedBytes(userId)]);
  const allowed = usedBytes + additionalBytes <= totalMb * 1024 * 1024;
  return { allowed, totalMb, usedBytes };
}

/** 上传后累加用量；删除后传负数扣减 */
export async function addUsage(userId: string, deltaBytes: number): Promise<void> {
  await q(
    `INSERT INTO user_cloud_usage (user_id, used_bytes, last_update)
     VALUES ($1, GREATEST($2, 0), now())
     ON CONFLICT (user_id) DO UPDATE SET used_bytes = GREATEST(user_cloud_usage.used_bytes + $2, 0), last_update = now()`,
    [userId, deltaBytes]
  );
}
