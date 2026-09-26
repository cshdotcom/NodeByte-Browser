import { q1 } from '@/lib/db';
import { CODE, ok, err, readJson } from '@/lib/status';
import { authAdmin } from '@/lib/auth';
import { adminAudit, clientIp } from '@/lib/audit';
import {
  DEFAULT_TTS_SETTINGS,
  TTS_META,
  ALL_TTS_TYPES,
  type TtsSettings,
  type TtsProviderConfig,
  type TtsProviderType,
} from '@/lib/tts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * 管理后台 - TTS 朗读配置（先连后端 → 后台配置 → TTS 上游）
 *
 * GET  /api/admin/tts-config  — 当前配置 + provider 元信息
 * PUT  /api/admin/tts-config  — 覆盖保存（密钥脱敏回显，留空 = 保留原密钥）
 */

function validate(v: unknown): TtsSettings | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Partial<TtsSettings>;
  if (typeof o.enabled !== 'boolean') return null;
  if (typeof o.maxChars !== 'number' || o.maxChars < 100 || o.maxChars > 10000) return null;
  if (typeof o.auditLog !== 'boolean') return null;
  if (typeof o.defaultVoice !== 'string' || !o.defaultVoice) return null;
  if (o.defaultFormat !== 'mp3' && o.defaultFormat !== 'ogg' && o.defaultFormat !== 'wav') return null;

  const providers: TtsProviderConfig[] = [];
  if (Array.isArray(o.providers)) {
    for (const p of o.providers) {
      if (!p || typeof p !== 'object') return null;
      const c = p as Partial<TtsProviderConfig>;
      if (!c.provider || !ALL_TTS_TYPES.includes(c.provider as TtsProviderType)) return null;
      if (typeof c.weight !== 'number' || c.weight < 0 || c.weight > 10000) return null;
      if (typeof c.enabled !== 'boolean') return null;
      if (c.endpoint !== undefined && c.endpoint !== '' && (typeof c.endpoint !== 'string' || !/^https?:\/\//.test(c.endpoint))) return null;
      for (const k of ['apiKey', 'region', 'model', 'voice'] as const) {
        if (c[k] !== undefined && typeof c[k] !== 'string') return null;
      }
      providers.push({
        provider: c.provider as TtsProviderType,
        endpoint: c.endpoint?.trim() || undefined,
        apiKey: c.apiKey || undefined,
        region: c.region || undefined,
        model: c.model || undefined,
        voice: c.voice || undefined,
        weight: c.weight,
        enabled: c.enabled,
      });
    }
  }
  return { enabled: o.enabled, providers, maxChars: o.maxChars, auditLog: o.auditLog, defaultVoice: o.defaultVoice, defaultFormat: o.defaultFormat };
}

export async function GET(req: Request) {
  const admin = await authAdmin(req);
  if (admin instanceof Response) return admin;
  const row = await q1<{ setting_value: unknown }>(
    `SELECT setting_value FROM system_setting WHERE setting_key = 'tts_config'`
  );
  const settings = row ? validate(row.setting_value) ?? DEFAULT_TTS_SETTINGS : DEFAULT_TTS_SETTINGS;
  return ok({
    settings: {
      ...settings,
      providers: settings.providers.map((p) => ({ ...p, apiKey: p.apiKey ? '••••••••(已配置)' : undefined })),
    },
    meta: TTS_META,
    types: ALL_TTS_TYPES,
  });
}

export async function PUT(req: Request) {
  const admin = await authAdmin(req);
  if (admin instanceof Response) return admin;
  const body = await readJson<TtsSettings>(req);
  const validated = validate(body);
  if (!validated) return err(CODE.BAD_REQUEST, 'TTS 配置格式不合法');

  // 密钥合并（同 provider 匹配继承）
  const oldRow = await q1<{ setting_value: unknown }>(
    `SELECT setting_value FROM system_setting WHERE setting_key = 'tts_config'`
  );
  const oldCfg = oldRow ? validate(oldRow.setting_value) : null;
  if (oldCfg) {
    for (const p of validated.providers) {
      if (!p.apiKey) {
        const old = oldCfg.providers.find((x) => x.provider === p.provider && (x.region ?? '') === (p.region ?? ''));
        if (old) p.apiKey = old.apiKey;
      }
    }
  }

  await q1(
    `INSERT INTO system_setting (setting_key, setting_value) VALUES ('tts_config', $1::jsonb)
     ON CONFLICT (setting_key) DO UPDATE SET setting_value = $1::jsonb`,
    [JSON.stringify(validated)]
  );
  await adminAudit({
    adminUserId: admin.userId,
    operateType: 'modify_system_setting',
    detail: { key: 'tts_config', enabled: validated.enabled, providersCount: validated.providers.length },
    ip: clientIp(req),
  });
  return ok(null, 'TTS 配置已保存');
}
