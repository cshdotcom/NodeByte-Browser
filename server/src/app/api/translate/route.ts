import { q1 } from '@/lib/db';
import { CODE, ok, err, readJson } from '@/lib/status';
import { authUser } from '@/lib/auth';
import { clientIp, userSecurityLog } from '@/lib/audit';
import {
  translate,
  listProviders,
  sanitizeProviders,
  COMMON_LANGUAGES,
  DEFAULT_SETTINGS,
  type TranslateSettings,
  type TranslateRequest,
  type ProviderConfig,
} from '@/lib/translate';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * 翻译 API（用户需求：开源免费翻译 API）
 *
 * GET  /api/translate              — 返回支持语言列表 + 当前可用 provider 列表（脱敏）
 * POST /api/translate              — 翻译文本（登录用户可用；未登录但管理员开启公共翻译时也可）
 *   body: { text, source?, target, format? }
 *
 * 服务端聚合多供应商（LibreTranslate / Lingva / MyMemory / DeepLX），自动降级；
 * 管理员可通过 /api/admin/translate-config 配置自定义实例与启用开关。
 */
async function loadSettings(): Promise<TranslateSettings> {
  const row = await q1<{ setting_value: unknown }>(
    `SELECT setting_value FROM system_setting WHERE setting_key = 'translate_config'`
  );
  if (!row) return DEFAULT_SETTINGS;
  const v = row.setting_value as Partial<TranslateSettings>;
  return {
    enabled: typeof v.enabled === 'boolean' ? v.enabled : DEFAULT_SETTINGS.enabled,
    providers: Array.isArray(v.providers) ? (v.providers as ProviderConfig[]) : DEFAULT_SETTINGS.providers,
    cacheTtlHours: typeof v.cacheTtlHours === 'number' ? v.cacheTtlHours : DEFAULT_SETTINGS.cacheTtlHours,
    auditLog: typeof v.auditLog === 'boolean' ? v.auditLog : DEFAULT_SETTINGS.auditLog,
    defaultTarget: typeof v.defaultTarget === 'string' && v.defaultTarget ? v.defaultTarget : DEFAULT_SETTINGS.defaultTarget,
  };
}

export async function GET(req: Request) {
  // 列表接口：登录用户可见；非登录但服务端开启 enabled 也可（用于浏览器侧边栏首屏展示语言列表）
  const settings = await loadSettings();
  if (!settings.enabled) return err(CODE.NO_PERMISSION, '翻译功能已被管理员关闭');
  return ok({
    languages: COMMON_LANGUAGES,
    defaultTarget: settings.defaultTarget,
    providers: sanitizeProviders(listProviders(settings)),
  });
}

export async function POST(req: Request) {
  const settings = await loadSettings();
  if (!settings.enabled) return err(CODE.NO_PERMISSION, '翻译功能已被管理员关闭');

  // 鉴权：浏览器端要求登录用户
  const u = await authUser(req);
  const userId = u instanceof Response ? null : u.userId;

  const body = await readJson<TranslateRequest>(req);
  if (!body?.text || !body.target) return err(CODE.BAD_REQUEST, 'text 与 target 必填');
  if (typeof body.text !== 'string' || body.text.length > 5000) {
    return err(CODE.BAD_REQUEST, '单次翻译文本不超过 5000 字符（避免烧公共实例配额）');
  }

  try {
    const result = await translate(body, settings);
    if (settings.auditLog && userId) {
      await userSecurityLog({
        userId,
        eventType: 'translate_text',
        detail: {
          provider: result.provider,
          endpoint: result.endpoint,
          source: result.detectedSource ?? body.source ?? 'auto',
          target: body.target,
          cached: result.cached,
          length: body.text.length,
        },
        ip: clientIp(req),
      });
    }
    return ok(result);
  } catch (e) {
    const msg = e instanceof AggregateError
      ? `${e.message}: ${e.errors.map((x) => (x as Error).message).join(' | ')}`
      : (e instanceof Error ? e.message : String(e));
    return err(CODE.SERVER_ERROR, `翻译失败：${msg}`);
  }
}
