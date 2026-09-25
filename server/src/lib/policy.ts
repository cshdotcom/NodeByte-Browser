import { q, q1 } from './db';

/**
 * 策略合并下发（服务端提示词 E.3）：
 *   用户 override_policy_json（不为 null 完全覆盖）
 *   > 用户组 policy_set(mandatory_json/recommended_json/sensitive_fields)
 *   > 全局默认策略（system_setting.global_policy）
 * 并附加 quota / forceInstallExtensions / policyVersion。
 */

export type MergedPolicy = {
  policyVersion: string;
  mandatory: Record<string, unknown>;
  recommended: Record<string, unknown>;
  sensitiveFields: string[];
  quota: { cloudTotalMb: number; cloudUsedMb: number };
  forceInstallExtensions: Array<{
    ext_id: string;
    source: 'cache_internal' | 'external_store' | 'package';
    download_url?: string;
    allow_uninstall: boolean;
  }>;
};

type UserRow = {
  user_id: string;
  email: string;
  group_id: string | null;
  override_policy_json: Record<string, unknown> | null;
};

export async function getGlobalPolicy(): Promise<{ mandatory: Record<string, unknown>; recommended: Record<string, unknown>; sensitiveFields: string[] }> {
  const g = await q1<{ global_policy: Record<string, unknown> }>(
    `SELECT setting_value AS "global_policy" FROM system_setting WHERE setting_key='global_policy'`
  );
  const s = await q1<{ fields: string[] }>(
    `SELECT setting_value AS fields FROM system_setting WHERE setting_key='default_policy_sensitive_fields'`
  );
  const gp = (g?.global_policy ?? {}) as { mandatory?: Record<string, unknown>; recommended?: Record<string, unknown> };
  return {
    mandatory: gp.mandatory ?? {},
    recommended: gp.recommended ?? {},
    sensitiveFields: s?.fields ?? []
  };
}

export async function getGroupPolicy(groupId: string | null): Promise<{
  mandatory: Record<string, unknown>;
  recommended: Record<string, unknown>;
  sensitiveFields: string[];
} | null> {
  if (!groupId) return null;
  const r = await q1<{ mandatory_json: Record<string, unknown>; recommended_json: Record<string, unknown>; sensitive_fields: string[] }>(
    `SELECT ps.mandatory_json, ps.recommended_json, ps.sensitive_fields
       FROM user_group ug JOIN policy_set ps ON ps.policy_set_id = ug.policy_set_id
      WHERE ug.group_id = $1 AND ug.policy_set_id IS NOT NULL`,
    [groupId]
  );
  if (!r) return null;
  return { mandatory: r.mandatory_json ?? {}, recommended: r.recommended_json ?? {}, sensitiveFields: r.sensitive_fields ?? [] };
}

/** 用户独立策略完全覆盖（提示词 5.3.2：不为 null 直接返回） */
export async function buildMergedPolicy(user: UserRow): Promise<MergedPolicy> {
  const [global, group] = await Promise.all([getGlobalPolicy(), getGroupPolicy(user.group_id)]);

  let mandatory = { ...global.mandatory, ...(group?.mandatory ?? {}) };
  let recommended = { ...global.recommended, ...(group?.recommended ?? {}) };
  const sensitive = new Set<string>([...(global.sensitiveFields ?? []), ...(group?.sensitiveFields ?? [])]);

  if (user.override_policy_json && typeof user.override_policy_json === 'object') {
    const ov = user.override_policy_json as {
      mandatory?: Record<string, unknown>;
      recommended?: Record<string, unknown>;
      sensitiveFields?: string[];
    };
    if (ov.mandatory) mandatory = { ...mandatory, ...ov.mandatory };
    if (ov.recommended) recommended = { ...recommended, ...ov.recommended };
    for (const f of ov.sensitiveFields ?? []) sensitive.add(f);
  }

  // 配额：优先级 用户独立 > 组 > 全局默认（quota.ts 的 getEffectiveQuotaMb）
  const { getEffectiveQuotaMb, getUsedBytes } = await import('./quota');
  const totalMb = await getEffectiveQuotaMb(user.user_id);
  const usedBytes = await getUsedBytes(user.user_id);

  // 强制扩展：组/用户绑定（mode 2/3）
  const forceInstallExtensions = await listForceInstallExtensions(user.user_id, user.group_id);

  return {
    policyVersion: `v-${new Date().toISOString().slice(0, 10)}-${(await policyStamp()).slice(0, 8)}`,
    mandatory,
    recommended,
    sensitiveFields: [...sensitive],
    quota: { cloudTotalMb: totalMb, cloudUsedMb: Math.round((usedBytes / 1024 / 1024) * 100) / 100 },
    forceInstallExtensions
  };
}

async function policyStamp(): Promise<string> {
  const r = await q1<{ n: string }>(
    `SELECT COALESCE(SUM(hashtext(COALESCE(mandatory_json::text,'') || COALESCE(recommended_json::text,'')))::text, '0') AS n FROM policy_set`
  );
  return String(Math.abs(Number(r?.n ?? 0)) || 0);
}

async function listForceInstallExtensions(
  userId: string,
  groupId: string | null
): Promise<MergedPolicy['forceInstallExtensions']> {
  const rows = await q<{ ext_id: string; source: string; download_url: string | null; allow_uninstall: boolean }>(
    `SELECT ext_id, source, download_url, allow_uninstall
       FROM forced_extension
      WHERE (target_user_id = $1 OR ($2::uuid IS NOT NULL AND target_group_id = $2))
        AND is_active = true`,
    [userId, groupId]
  ).catch(() => ({ rows: [] as Array<{ ext_id: string; source: string; download_url: string | null; allow_uninstall: boolean }> }));

  return rows.rows.map((r) => ({
    ext_id: r.ext_id,
    source: (r.source as 'cache_internal' | 'external_store' | 'package') ?? 'cache_internal',
    download_url: r.download_url ?? undefined,
    allow_uninstall: r.allow_uninstall
  }));
}
