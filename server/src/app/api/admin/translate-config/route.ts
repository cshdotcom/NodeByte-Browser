import { q1 } from '@/lib/db';
import { CODE, ok, err, readJson } from '@/lib/status';
import { authAdmin } from '@/lib/auth';
import { adminAudit, clientIp } from '@/lib/audit';
import {
  DEFAULT_SETTINGS,
  DEFAULT_PROVIDERS,
  PROVIDER_META,
  ALL_PROVIDER_TYPES,
  type TranslateSettings,
  type ProviderConfig,
  type ProviderType,
} from '@/lib/translate';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * 管理后台 - 翻译配置（用户需求：后台可配置多种接口和所有常用的翻译 API）
 *
 * GET  /api/admin/translate-config  — 读取当前配置 + 全部 provider 元信息（UI 渲染用）
 * PUT  /api/admin/translate-config  — 整体覆盖配置（providers[] 支持全部 15 种类型）
 *
 * providers[] 每项字段（按类型部分字段可省略）：
 *   { provider, endpoint?, apiKey?, appId?, region?, model?, weight, enabled }
 * 密钥仅存服务端 system_setting（jsonb），客户端/浏览器永远拿不到。
 */

function validateSettings(v: unknown): TranslateSettings | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Partial<TranslateSettings>;
  if (typeof o.enabled !== 'boolean') return null;
  if (typeof o.cacheTtlHours !== 'number' || o.cacheTtlHours < 0 || o.cacheTtlHours > 24 * 30) return null;
  if (typeof o.auditLog !== 'boolean') return null;
  if (typeof o.defaultTarget !== 'string' || !o.defaultTarget) return null;

  const providers: ProviderConfig[] = [];
  if (Array.isArray(o.providers)) {
    for (const p of o.providers) {
      if (!p || typeof p !== 'object') return null;
      const c = p as Partial<ProviderConfig>;
      if (!c.provider || !ALL_PROVIDER_TYPES.includes(c.provider)) return null;
      if (typeof c.weight !== 'number' || c.weight < 0 || c.weight > 10000) return null;
      if (typeof c.enabled !== 'boolean') return null;
      if (c.endpoint !== undefined && c.endpoint !== '' && (typeof c.endpoint !== 'string' || !/^https?:\/\//.test(c.endpoint))) return null;
      // 凭据按形状校验（保存时宽松——允许留空由测试按钮暴露问题；仅校验类型）
      // 注意：留空的密钥由 PUT 的「密钥合并」逻辑从旧配置继承（脱敏回显后无需重输）
      for (const k of ['apiKey', 'appId', 'appSecret', 'region', 'model'] as const) {
        if (c[k] !== undefined && typeof c[k] !== 'string') return null;
      }
      providers.push({
        provider: c.provider as ProviderType,
        endpoint: c.endpoint?.trim() || undefined,
        apiKey: c.apiKey || c.appSecret || undefined,
        appId: c.appId || undefined,
        region: c.region || undefined,
        model: c.model || undefined,
        weight: c.weight,
        enabled: c.enabled,
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
  return ok({
    settings: {
      ...settings,
      providers: settings.providers.map((p) => ({ ...p, apiKey: p.apiKey ? '••••••••(已配置)' : undefined })),
    },
    defaults: DEFAULT_PROVIDERS,
    meta: PROVIDER_META,
    types: ALL_PROVIDER_TYPES,
  });
}

export async function PUT(req: Request) {
  const admin = await authAdmin(req);
  if (admin instanceof Response) return admin;

  const body = await readJson<TranslateSettings>(req);
  const validated = validateSettings(body);
  if (!validated) return err(CODE.BAD_REQUEST, '配置格式不合法（provider 类型 / weight / 凭据字段）');

  // 密钥合并：前端回显时密钥脱敏（••…），留空提交 = 保留原密钥。
  // 匹配规则：同 provider 类型 + 同 appId（同一实例），继承旧 apiKey/region/model。
  const oldRow = await q1<{ setting_value: unknown }>(
    `SELECT setting_value FROM system_setting WHERE setting_key = 'translate_config'`
  );
  const oldCfg = oldRow ? validateSettings(oldRow.setting_value) : null;
  if (oldCfg) {
    for (const p of validated.providers) {
      if (!p.apiKey) {
        const old = oldCfg.providers.find(
          (x) => x.provider === p.provider && (x.appId ?? '') === (p.appId ?? '')
        );
        if (old) p.apiKey = old.apiKey;
      }
    }
  }

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
      providerTypes: validated.providers.map((p) => p.provider),
      defaultTarget: validated.defaultTarget,
    },
    ip: clientIp(req),
  });

  return ok(null, '翻译配置已保存（已在浏览器端即时生效）');
}
