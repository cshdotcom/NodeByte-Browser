import { q1 } from '@/lib/db';
import { CODE, ok, err, readJson } from '@/lib/status';
import { authUser } from '@/lib/auth';
import { clientIp, userSecurityLog } from '@/lib/audit';
import {
  synthesize,
  DEFAULT_TTS_SETTINGS,
  type TtsSettings,
  type TtsRequest,
  type TtsProviderConfig,
} from '@/lib/tts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * TTS 朗读代理（用户需求：客户端先走后端，后端再连后台配置的 TTS 上游）
 *
 * POST /api/tts  body: { text, voice?, speed?, format? }
 * 返回：音频二进制流（audio/mpeg | audio/ogg | audio/wav）
 *
 * 登录用户可用；策略 NodeByteTtsEnabled=false 时 40303；
 * 单次 ≤ NodeByteTtsMaxChars（默认 3000 字符，后台 tts_config.maxChars 可调）。
 * 上游（Edge TTS 自托管 / Azure / OpenAI 兼容）地址与密钥仅存服务端。
 */
async function loadSettings(): Promise<TtsSettings> {
  const row = await q1<{ setting_value: unknown }>(
    `SELECT setting_value FROM system_setting WHERE setting_key = 'tts_config'`
  );
  if (!row) return DEFAULT_TTS_SETTINGS;
  const v = row.setting_value as Partial<TtsSettings>;
  return {
    enabled: typeof v.enabled === 'boolean' ? v.enabled : DEFAULT_TTS_SETTINGS.enabled,
    providers: Array.isArray(v.providers) ? (v.providers as TtsProviderConfig[]) : DEFAULT_TTS_SETTINGS.providers,
    maxChars: typeof v.maxChars === 'number' && v.maxChars > 0 ? v.maxChars : DEFAULT_TTS_SETTINGS.maxChars,
    auditLog: typeof v.auditLog === 'boolean' ? v.auditLog : DEFAULT_TTS_SETTINGS.auditLog,
    defaultVoice: typeof v.defaultVoice === 'string' && v.defaultVoice ? v.defaultVoice : DEFAULT_TTS_SETTINGS.defaultVoice,
    defaultFormat: v.defaultFormat === 'ogg' || v.defaultFormat === 'wav' ? v.defaultFormat : 'mp3',
  };
}

export async function GET(req: Request) {
  // 音色/配置元信息（不含上游地址密钥）——供阅读器 UI 展示音色选择
  const settings = await loadSettings();
  if (!settings.enabled) return err(CODE.NO_PERMISSION, 'TTS 朗读已被管理员关闭');
  const voices = Array.from(new Set([
    settings.defaultVoice,
    'zh-CN-XiaoxiaoNeural', 'zh-CN-YunxiNeural', 'zh-CN-YunyangNeural',
    'zh-CN-XiaoyiNeural', 'en-US-AriaNeural', 'en-US-GuyNeural', 'ja-JP-NanamiNeural',
  ]));
  return ok({ voices, defaultVoice: settings.defaultVoice, defaultFormat: settings.defaultFormat, maxChars: settings.maxChars });
}

export async function POST(req: Request) {
  const settings = await loadSettings();
  if (!settings.enabled) return err(CODE.NO_PERMISSION, 'TTS 朗读已被管理员关闭');

  const u = await authUser(req);
  const userId = u instanceof Response ? null : u.userId;

  const body = await readJson<TtsRequest>(req);
  if (!body?.text) return err(CODE.BAD_REQUEST, 'text 必填');
  if (typeof body.text !== 'string' || body.text.length > settings.maxChars) {
    return err(CODE.BAD_REQUEST, `单次合成不超过 ${settings.maxChars} 字符`);
  }

  try {
    const result = await synthesize(body, settings);
    if (settings.auditLog && userId) {
      await userSecurityLog({
        userId,
        eventType: 'tts_synthesize',
        detail: {
          provider: result.provider,
          fingerprint: body.text.slice(0, 0) || undefined, // 不记录原文
          bytes: result.audio.byteLength,
          voice: body.voice ?? settings.defaultVoice,
          chars: body.text.length,
        },
        ip: clientIp(req),
      });
    }
    return new Response(result.audio, {
      status: 200,
      headers: {
        'Content-Type': result.contentType,
        'Content-Length': String(result.audio.byteLength),
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    const msg = e instanceof AggregateError
      ? `${e.message}: ${e.errors.map((x) => (x as Error).message).join(' | ')}`
      : (e instanceof Error ? e.message : String(e));
    return err(CODE.SERVER_ERROR, `TTS 合成失败：${msg}`);
  }
}
