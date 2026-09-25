import { q1 } from './db';

/**
 * CustomRequire2FA 策略读取（用户 override > 组策略集 > 全局默认）。
 * 与 policy.ts 拆分避免循环依赖。
 */
export async function getRequire2fa(userId: string): Promise<boolean> {
  const u = await q1<{ override_policy_json: { mandatory?: Record<string, unknown> } | null; group_id: string | null }>(
    `SELECT override_policy_json, group_id FROM users WHERE user_id = $1`,
    [userId]
  );
  if (u?.override_policy_json?.mandatory && 'CustomRequire2FA' in u.override_policy_json.mandatory) {
    return Boolean(u.override_policy_json.mandatory['CustomRequire2FA']);
  }
  if (u?.group_id) {
    const g = await q1<{ flag: boolean }>(
      `SELECT (ps.mandatory_json->>'CustomRequire2FA')::boolean AS flag
         FROM user_group ug JOIN policy_set ps ON ps.policy_set_id = ug.policy_set_id
        WHERE ug.group_id = $1 AND ps.mandatory_json ? 'CustomRequire2FA'`,
      [u.group_id]
    );
    if (g && g.flag != null) return g.flag;
  }
  const d = await q1<{ flag: boolean }>(
    `SELECT (setting_value->'mandatory'->>'CustomRequire2FA')::boolean AS flag
       FROM system_setting WHERE setting_key='global_policy'`
  );
  return Boolean(d?.flag);
}
