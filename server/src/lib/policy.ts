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
  /** 生效中的指令（客户端按 valueType 应用为强制配置） */
  directives: Array<{
    id: string;
    key: string;
    valueType: 'switch' | 'text' | 'number' | 'json' | 'search_engine';
    value: unknown;
    scope: 'global' | 'group' | 'user';
  }>;
  /** 近 30 天撤销的指令：客户端收到后删除本地强制配置（开关恢复默认 / 地址清空 / 搜索引擎回编译默认） */
  revoked: Array<{
    id: string;
    key: string;
    valueType: 'switch' | 'text' | 'number' | 'json' | 'search_engine';
    revokedAt: string;
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

  // 策略指令（可撤销）：生效指令按 优先级合并进 mandatory（指令最高），
  // 近 30 天撤销的指令随 revoked 下发，客户端删除本地强制配置。
  const { active, revoked } = await listDirectives(user.user_id, user.group_id);
  for (const d of active) mandatory = { ...mandatory, [d.key]: d.value };

  return {
    policyVersion: `v-${new Date().toISOString().slice(0, 10)}-${(await policyStamp()).slice(0, 8)}`,
    mandatory,
    recommended,
    sensitiveFields: [...sensitive],
    quota: { cloudTotalMb: totalMb, cloudUsedMb: Math.round((usedBytes / 1024 / 1024) * 100) / 100 },
    forceInstallExtensions,
    directives: active,
    revoked
  };
}

/** 生效指令 + 近 30 天撤销指令（合并顺序：全局 < 组 < 用户，与策略一致） */
async function listDirectives(
  userId: string,
  groupId: string | null
): Promise<{
  active: MergedPolicy['directives'];
  revoked: MergedPolicy['revoked'];
}> {
  const rows = await q<{
    directive_id: string; scope: string; key: string; value_type: string;
    value_json: unknown; revoked_at: Date | null; is_active: boolean;
  }>(
    `SELECT directive_id, scope, key, value_type, value_json, revoked_at, is_active
       FROM policy_directive
      WHERE is_active = true AND (
              scope = 'global'
           OR (scope = 'group'  AND scope_id = $2::uuid)
           OR (scope = 'user'   AND scope_id = $1::uuid)
            )
      ORDER BY CASE scope WHEN 'global' THEN 0 WHEN 'group' THEN 1 ELSE 2 END, created_at ASC`,
    [userId, groupId]
  ).catch(() => ({ rows: [] as never[] }));

  const revokedRows = await q<{
    directive_id: string; key: string; value_type: string; revoked_at: Date;
  }>(
    `SELECT directive_id, key, value_type, revoked_at
       FROM policy_directive
      WHERE is_active = false AND revoked_at IS NOT NULL AND revoked_at > now() - interval '30 days'
        AND (scope = 'global'
          OR (scope = 'group' AND scope_id = $2::uuid)
          OR (scope = 'user'  AND scope_id = $1::uuid))
      ORDER BY revoked_at DESC LIMIT 100`,
    [userId, groupId]
  ).catch(() => ({ rows: [] as never[] }));

  const cast = (t: string) =>
    (['switch', 'text', 'number', 'json', 'search_engine'].includes(t) ? t : 'text') as MergedPolicy['directives'][number]['valueType'];

  return {
    active: rows.rows.map((d) => ({
      id: d.directive_id,
      key: d.key,
      valueType: cast(d.value_type),
      value: d.value_json ?? null,
      scope: (d.scope as 'global' | 'group' | 'user') ?? 'global'
    })),
    revoked: revokedRows.rows.map((d) => ({
      id: d.directive_id,
      key: d.key,
      valueType: cast(d.value_type),
      revokedAt: new Date(d.revoked_at).toISOString()
    }))
  };
}

async function policyStamp(): Promise<string> {
  const r = await q1<{ n: string }>(
    `SELECT COALESCE(SUM(hashtext(COALESCE(mandatory_json::text,'') || COALESCE(recommended_json::text,'')))::text, '0') AS n FROM policy_set`
  );
  const d = await q1<{ n: string }>(
    `SELECT COALESCE(SUM(hashtext(key || value_type::text || COALESCE(value_json::text,'') || is_active::text || COALESCE(revoked_at::text,'')))::text, '0') AS n
       FROM policy_directive`
  ).catch(() => null);
  return String((Math.abs(Number(r?.n ?? 0)) || 0) + (Math.abs(Number(d?.n ?? 0)) || 0));
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
