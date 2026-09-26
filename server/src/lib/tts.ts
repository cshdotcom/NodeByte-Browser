/**
 * TTS 朗读引擎（后端代理 + 后台可配上游）
 * =====================================================================
 * 用户需求「可塑性」系列改造：电子书/PDF 朗读原先由客户端直连 Edge TTS
 * 公有云，现改为：客户端 → POST /api/tts → 后台配置的 TTS 上游。
 *
 *   浏览器（电子书阅读器 / PDF 阅读模式朗读）
 *        │ ① 登录态 JWT + POST /api/tts { text, voice?, speed?, format? }
 *        ▼
 *   NodeByte 服务端（唯一出口）
 *        │ ② 策略 NodeByteTtsEnabled / NodeByteTtsMaxChars
 *        │ ③ 按后台 TTS 配置（tts_config）调用上游
 *        ▼
 *   TTS 上游 ×3：
 *     1) edge_tts_server — 自托管 Edge TTS HTTP 服务（docker 一键起，免费无限，
 *        推荐：ghcr.io eitherlab/edge-tts-server 或 wuhongsheng/edge-tts-server）
 *     2) azure_speech   — Azure 语音服务 F0 免费 50 万字/月（key + region）
 *     3) openai_speech  — OpenAI 兼容 /audio/speech（ChatGPT TTS / 本地 openedai-speech 等）
 *
 * 音频以流式（arrayBuffer）转发给客户端，Content-Type 按 format（mp3/ogg/wav）。
 * 全部零第三方依赖。
 */

import { createHash } from 'node:crypto';

export type TtsProviderType = 'edge_tts_server' | 'azure_speech' | 'openai_speech';

export const ALL_TTS_TYPES: readonly TtsProviderType[] = ['edge_tts_server', 'azure_speech', 'openai_speech'];

export const TTS_META: Record<TtsProviderType, {
  label: string;
  license: string;
  keyShape: 'none' | 'apiKey' | 'keyRegion' | 'keyModel';
  defaultEndpoint: string;
  freeTier: string;
  defaultVoice: string;
}> = {
  edge_tts_server: {
    label: 'Edge TTS 自托管 HTTP 服务（免费无限）',
    license: '依赖 Edge 公有云免费语音',
    keyShape: 'none',
    defaultEndpoint: 'http://127.0.0.1:3000',
    freeTier: '自托管免费（Docker 一键起）',
    defaultVoice: 'zh-CN-XiaoxiaoNeural',
  },
  azure_speech: {
    label: 'Azure 语音服务（官方）',
    license: 'Azure F0 免费层',
    keyShape: 'keyRegion',
    defaultEndpoint: 'https://api.cognitive.microsoft.com',
    freeTier: 'F0 50 万字/月免费',
    defaultVoice: 'zh-CN-XiaoxiaoNeural',
  },
  openai_speech: {
    label: 'OpenAI 兼容 TTS（/audio/speech）',
    license: '按量付费 / 本地自托管',
    keyShape: 'keyModel',
    defaultEndpoint: 'https://api.openai.com/v1',
    freeTier: '本地 openedai-speech 免费',
    defaultVoice: 'alloy',
  },
};

export interface TtsProviderConfig {
  provider: TtsProviderType;
  endpoint?: string;
  apiKey?: string;    // azure key / openai key
  region?: string;    // azure region（如 eastasia）
  model?: string;     // openai tts 模型（tts-1 / tts-1-hd / 本地模型名）
  voice?: string;     // 默认音色
  weight: number;
  enabled: boolean;
}

export interface TtsSettings {
  enabled: boolean;
  providers: TtsProviderConfig[];
  maxChars: number;           // 单次合成字符上限
  auditLog: boolean;
  defaultVoice: string;       // 全局默认音色（zh-CN-XiaoxiaoNeural）
  defaultFormat: 'mp3' | 'ogg' | 'wav';
}

export const DEFAULT_TTS_SETTINGS: TtsSettings = {
  enabled: true,
  providers: [
    { provider: 'edge_tts_server', endpoint: 'http://127.0.0.1:3000', weight: 10, enabled: true, voice: 'zh-CN-XiaoxiaoNeural' },
    { provider: 'azure_speech', weight: 20, enabled: false, region: 'eastasia', voice: 'zh-CN-XiaoxiaoNeural' },
    { provider: 'openai_speech', weight: 30, enabled: false, model: 'tts-1', voice: 'alloy' },
  ],
  maxChars: 3000,
  auditLog: false,
  defaultVoice: 'zh-CN-XiaoxiaoNeural',
  defaultFormat: 'mp3',
};

export interface TtsRequest {
  text: string;
  voice?: string;    // 缺省用 provider/全局默认
  speed?: number;    // 0.5~2.0
  format?: 'mp3' | 'ogg' | 'wav';
}

export interface TtsResult {
  audio: ArrayBuffer;
  contentType: string;
  provider: TtsProviderType;
  endpoint: string;
}

const REQUEST_TIMEOUT_MS = 30000;

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function ep(cfg: TtsProviderConfig, fallback: string): string {
  return (cfg.endpoint && cfg.endpoint.trim()) || fallback;
}

const CONTENT_TYPES: Record<string, string> = {
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
};

/** 自托管 Edge TTS HTTP 服务（POST /tts {text, voice, format} → audio） */
async function ttsEdgeServer(cfg: TtsProviderConfig, req: TtsRequest, format: string): Promise<TtsResult> {
  const base = ep(cfg, TTS_META.edge_tts_server.defaultEndpoint).replace(/\/$/, '');
  const voice = req.voice || cfg.voice || TTS_META.edge_tts_server.defaultVoice;
  const r = await fetchWithTimeout(`${base}/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: req.text, voice, format }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const buf = await r.arrayBuffer();
  if (buf.byteLength < 100) throw new Error('audio too short (upstream error?)');
  return { audio: buf, contentType: CONTENT_TYPES[format] ?? 'audio/mpeg', provider: 'edge_tts_server', endpoint: base };
}

/** Azure 语音服务 REST（SSML + 输出音频） */
async function ttsAzure(cfg: TtsProviderConfig, req: TtsRequest, format: string): Promise<TtsResult> {
  if (!cfg.apiKey) throw new Error('缺少 apiKey（Azure Speech 密钥）');
  const region = cfg.region || 'eastasia';
  const base = ep(cfg, TTS_META.azure_speech.defaultEndpoint);
  const voice = req.voice || cfg.voice || TTS_META.azure_speech.defaultVoice;
  const rate = req.speed && req.speed !== 1 ? `${Math.round((req.speed - 1) * 100)}%` : '0%';
  // SSML 转义最小集
  const esc = req.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const ssml = `<speak version='1.0' xml:lang='zh-CN'><voice name='${voice}'><prosody rate='${rate}'>${esc}</prosody></voice></speak>`;
  const outFormat = format === 'ogg' ? 'ogg-48khz-16bit-mono-opus' : format === 'wav' ? 'riff-24khz-16bit-mono-pcm' : 'audio-24khz-48kbitrate-mono-mp3';
  const r = await fetchWithTimeout(`${base.replace(/\/$/, '')}/sts/v1.0/issueToken`, {
    method: 'POST',
    headers: { 'Ocp-Apim-Subscription-Key': cfg.apiKey, 'Content-Length': '0' },
  }, 10000);
  if (!r.ok) throw new Error(`token HTTP ${r.status}（key/region 检查）`);
  const token = await r.text();
  const tr = await fetchWithTimeout(`${base.replace(/\/$/, '')}/cognitiveservices/v1`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': outFormat,
      'User-Agent': 'NodeByteServer',
    },
    body: ssml,
  });
  if (!tr.ok) throw new Error(`HTTP ${tr.status}`);
  const buf = await tr.arrayBuffer();
  if (buf.byteLength < 100) throw new Error('audio too short');
  return { audio: buf, contentType: CONTENT_TYPES[format] ?? 'audio/mpeg', provider: 'azure_speech', endpoint: base };
}

/** OpenAI 兼容 /audio/speech */
async function ttsOpenAI(cfg: TtsProviderConfig, req: TtsRequest, format: string): Promise<TtsResult> {
  const base = ep(cfg, TTS_META.openai_speech.defaultEndpoint).replace(/\/$/, '');
  const voice = req.voice || cfg.voice || TTS_META.openai_speech.defaultVoice;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
  // OpenAI TTS 输出格式只支持 mp3/opus/aac/flac；ogg → opus
  const respFormat = format === 'ogg' ? 'opus' : format === 'wav' ? 'wav' : 'mp3';
  const r = await fetchWithTimeout(`${base}/audio/speech`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: cfg.model || 'tts-1',
      voice,
      input: req.text,
      speed: req.speed && req.speed >= 0.25 && req.speed <= 4 ? req.speed : 1.0,
      response_format: respFormat,
    }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const buf = await r.arrayBuffer();
  if (buf.byteLength < 100) throw new Error('audio too short');
  const ct = respFormat === 'opus' ? 'audio/ogg' : respFormat === 'wav' ? 'audio/wav' : 'audio/mpeg';
  return { audio: buf, contentType: ct, provider: 'openai_speech', endpoint: base };
}

const TTS_ADAPTERS: Record<TtsProviderType, (cfg: TtsProviderConfig, req: TtsRequest, fmt: string) => Promise<TtsResult>> = {
  edge_tts_server: ttsEdgeServer,
  azure_speech: ttsAzure,
  openai_speech: ttsOpenAI,
};

/** 按后台配置依次尝试合成；全部失败抛 AggregateError */
export async function synthesize(req: TtsRequest, settings: TtsSettings): Promise<TtsResult> {
  if (!settings.enabled) throw new Error('TTS 朗读已被管理员关闭（NodeByteTtsEnabled=false）');
  if (!req.text || !req.text.trim()) throw new Error('text 必填');
  if (req.text.length > settings.maxChars) {
    throw new Error(`单次合成不超过 ${settings.maxChars} 字符（NodeByteTtsMaxChars）`);
  }
  const format = req.format ?? settings.defaultFormat;
  const providers = [...(settings.providers || [])].filter((p) => p.enabled !== false).sort((a, b) => a.weight - b.weight);
  if (providers.length === 0) throw new Error('后台未配置任何启用的 TTS 上游');

  const errors: string[] = [];
  for (const cfg of providers) {
    try {
      return await TTS_ADAPTERS[cfg.provider](cfg, req, format);
    } catch (e) {
      errors.push(`${cfg.provider}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  throw new AggregateError(errors.map((m) => new Error(m)), `所有 TTS 上游均失败：${errors.join(' | ')}`);
}

/** 管理员一键测试（合成 "你好，NodeByte。" 返回字节数与延迟） */
export async function testTtsProvider(cfg: TtsProviderConfig): Promise<{ ok: boolean; detail: string; bytes?: number; latencyMs?: number }> {
  const meta = TTS_META[cfg.provider];
  if (!meta) return { ok: false, detail: '未知 TTS 类型' };
  const started = Date.now();
  try {
    const r = await TTS_ADAPTERS[cfg.provider](cfg, { text: '你好，NodeByte 浏览器。' }, 'mp3');
    return { ok: true, detail: `连通成功（${meta.label}）`, bytes: r.audio.byteLength, latencyMs: Date.now() - started };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e), latencyMs: Date.now() - started };
  }
}

/** 朗读文本指纹（审计用，不存原文） */
export function textFingerprint(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);
}
