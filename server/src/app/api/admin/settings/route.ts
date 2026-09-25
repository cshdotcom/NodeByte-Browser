import { q, q1 } from '@/lib/db';
import { CODE, ok, err, readJson } from '@/lib/status';
import { authAdmin } from '@/lib/auth';
import { adminAudit, clientIp } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/**
 * 系统设置（服务端提示词 5.8.4）：
 * GET  /api/admin/settings — enable_public_register / smtp_config / 默认组 / 默认配额 / 全局默认策略
 * PATCH /api/admin/settings { key, value } — 修改（写审计）
 */
const EDITABLE = new Set(['enable_public_register', 'default_quota_mb', 'default_group', 'smtp_config', 'global_policy', 'default_policy_sensitive_fields']);

export async function GET(req: Request) {
  const admin = await authAdmin(req);
  if (admin instanceof Response) return admin;
  const rows = await q(`SELECT setting_key, setting_value FROM system_setting`);
  const settings: Record<string, unknown> = {};
  for (const r of rows.rows) settings[r.setting_key] = r.setting_value;
  return ok({ settings });
}

export async function PATCH(req: Request) {
  const admin = await authAdmin(req);
  if (admin instanceof Response) return admin;
  const body = await readJson<{ key?: string; value?: unknown }>(req);
  if (!body?.key || !EDITABLE.has(body.key)) return err(CODE.BAD_REQUEST, '不允许修改该项');
  await q(
    `INSERT INTO system_setting (setting_key, setting_value) VALUES ($1, $2::jsonb)
     ON CONFLICT (setting_key) DO UPDATE SET setting_value = $2::jsonb`,
    [body.key, JSON.stringify(body.value)]
  );
  await adminAudit({ adminUserId: admin.userId, operateType: 'modify_system_setting', detail: { key: body.key }, ip: clientIp(req) });
  return ok(null, '已保存');
}
