import { q1 } from '@/lib/db';
import { CODE, ok, err, readJson } from '@/lib/status';
import { authAdmin } from '@/lib/auth';
import { adminAudit, clientIp } from '@/lib/audit';
import {
  DEFAULT_SETTINGS,
  DEFAULT_PROVIDERS,
  type TranslateSettings,
  type ProviderConfig,
  type TranslateProvider,
} from '@/lib/translate';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * 管理后台 - 翻译配置（用户需求：开源免费翻译 API）
 *
 * GET  /api/admin/translate-config  — 读取当前配置（含 apiKey，仅管理员可见）
 * PUT  /api/admin/translate-config  — 整体覆盖配置
 *   body: TranslateSettings
 *
 * 配置存于 system_setting.translate_config（jsonb）：
 *   {
 *     enabled: bool,
 *     providers: ProviderConfig[],  // 为空时用 DEFAULT_PROVIDERS
 *     cacheTtlHours: number,
 *     auditLog: bool,
 *     defaultTarget: string
 *   }
 */

const VALID_PROVIDERS: ReadonlySet<TranslateProvider> = new Set([
  'libretranslate', 'lingva', 'mymemory', 'deeplx',
]);

function validateSettings(v: unknown): TranslateSettings | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Partial<TranslateSettings>;
  if (typeof o.enabled !== 'boolean') return null;
  if (typeof o.cacheTtlHours !== 'number' || o.cacheTtlHours < 0 || o.cacheTtlHours > 24 * 30) return null;
  if (typeof o.auditLog !== 'boolean') return null;
  if (typeof o.defaultTarget !== 'string' || !o.defaultTarget) return null;

  let providers: ProviderConfig[] = [];
  if (Array.isArray(o.providers)) {
    for (const p of o.providers) {
      if (!p || typeof p !== 'object') return null;
      const cfg = p as ProviderConfig;
      if (!VALID_PROVIDERS.has(cfg.provider)) return null;
      if (typeof cfg.endpoint !== 'string' || !/^https?:\/\//.test(cfg.endpoint)) return null;
      if (typeof cfg.weight !== 'number' || cfg.weight < 0) return null;
      if (cfg.apiKey !== undefined && typeof cfg.apiKey !== 'string') return null;
      providers.push({
        provider: cfg.provider,
        endpoint: cfg.endpoint,
        weight: cfg.weight,
        apiKey: cfg.apiKey || undefined,
      });
    }
  }
  return {
    enabled: o.enabled,
    providers,
    cacheTtlHours: o.cacheTtlHours,
    auditLog: o.auditLog,
    defaultTarget: o.defaultTarget,
  };
}

export async function GET(req: Request) {
  const admin = await authAdmin(req);
  if (admin instanceof Response) return admin;

  const row = await q1<{ setting_value: unknown }>(
    `SELECT setting_value FROM system_setting WHERE setting_key = 'translate_config'`
  );
  const settings = row ? validateSettings(row.setting_value) ?? DEFAULT_SETTINGS : DEFAULT_SETTINGS;
  return ok({ settings, defaults: DEFAULT_PROVIDERS });
}

export async function PUT(req: Request) {
  const admin = await authAdmin(req);
  if (admin instanceof Response) return admin;

  const body = await readJson<TranslateSettings>(req);
  const validated = validateSettings(body);
  if (!validated) return err(CODE.BAD_REQUEST, '配置格式不合法');

  await q1(
    `INSERT INTO system_setting (setting_key, setting_value) VALUES ('translate_config', $1::jsonb)
     ON CONFLICT (setting_key) DO UPDATE SET setting_value = $1::jsonb`,
    [JSON.stringify(validated)]
  );

  await adminAudit({
    adminUserId: admin.userId,
    operateType: 'modify_system_setting',
    detail: {
      key: 'translate_config',
      enabled: validated.enabled,
      providersCount: validated.providers.length,
      defaultTarget: validated.defaultTarget,
    },
    ip: clientIp(req),
  });

  return ok(null, '翻译配置已保存');
}
