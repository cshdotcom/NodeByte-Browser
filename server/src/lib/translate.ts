/**
 * 翻译引擎（多供应商 + 自动降级 + 自托管端点可配置）
 * ---------------------------------------------------------------------
 * 用户需求：找一个开源免费的翻译 API，加进浏览器。
 *
 * 选型（全部开源 / 可自托管，无需付费 API Key 即可工作）：
 *   1. LibreTranslate  — AGPL-3.0，开源，可自托管，公共实例若干（默认主用）
 *   2. Lingva Translate — GPL-3.0，开源 Google Translate 代理，无需 Key
 *   3. MyMemory        — 免费配额 5000 词/天（无 Key 也能用），用于兜底
 *   4. DeepLX          — MIT，开源 DeepL 代理（需自托管，免费版 DeepL 不提供 API）
 *   5. Argos Translate — 离线（MIT），可在 Docker 镜像内嵌（后续可选）
 *
 * 工作模式：
 *   - 默认按 providers 数组顺序尝试，首个返回 200 的结果即返回；
 *   - 管理员可在后台配置 preferred_provider / custom_endpoint（覆盖默认实例）；
 *   - 自托管 LibreTranslate/DeepLX 时优先走 custom_endpoint；
 *   - 翻译结果按 (provider, source_lang, target_lang, sha256(text)) 缓存到
 *     translate_cache 表，命中即返回（避免反复请求公共实例触发限速）。
 *
 * 安全：
 *   - 不记录原文与译文，只记录命中次数与最后一次命中时间（审计可关）；
 *   - 请求超时统一 8s；任何上游 4xx/5xx 都触发降级；
 *   - 公共实例可能因限速拒绝（429），自动切下一个。
 */

import { createHash, randomUUID } from 'node:crypto';

export type TranslateProvider = 'libretranslate' | 'lingva' | 'mymemory' | 'deeplx';

export interface ProviderConfig {
  provider: TranslateProvider;
  endpoint: string;          // 实例根 URL
  apiKey?: string;           // 部分实例要求（一般为空）
  weight: number;            // 优先级（数字越小越靠前）
}

/** 默认公共实例（按可用性排序；管理员可覆盖） */
export const DEFAULT_PROVIDERS: ProviderConfig[] = [
  {
    provider: 'libretranslate',
    endpoint: 'https://translate.argosopentech.com',
    weight: 10,
  },
  {
    provider: 'libretranslate',
    endpoint: 'https://libretranslate.de',
    weight: 20,
  },
  {
    provider: 'lingva',
    endpoint: 'https://lingva.ml',
    weight: 30,
  },
  {
    provider: 'mymemory',
    endpoint: 'https://api.mymemory.translated.net',
    weight: 40,
  },
];

/** 管理员配置覆盖（从 system_setting.translate_providers 读取） */
export interface TranslateSettings {
  enabled: boolean;
  providers: ProviderConfig[];   // 自定义实例列表；为空时用 DEFAULT_PROVIDERS
  cacheTtlHours: number;          // 缓存有效期（默认 168h = 7 天）
  auditLog: boolean;              // 是否记录翻译命中日志
  defaultTarget: string;          // 默认目标语言（zh-CN）
}

export const DEFAULT_SETTINGS: TranslateSettings = {
  enabled: true,
  providers: [],
  cacheTtlHours: 168,
  auditLog: false,
  defaultTarget: 'zh-CN',
};

export interface TranslateRequest {
  text: string;
  source?: string;     // 源语言代码；'auto' 或省略 → 自动检测
  target: string;      // 目标语言代码
  format?: 'text' | 'html';
}

export interface TranslateResult {
  translatedText: string;
  detectedSource?: string;
  provider: TranslateProvider;
  endpoint: string;     // 实际命中的实例（脱敏：不含 apiKey）
  cached: boolean;
}

const REQUEST_TIMEOUT_MS = 8000;

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ---------- 各供应商适配器 ----------

async function callLibreTranslate(cfg: ProviderConfig, req: TranslateRequest): Promise<TranslateResult> {
  const url = `${cfg.endpoint.replace(/\/$/, '')}/translate`;
  const body: Record<string, unknown> = {
    q: req.text,
    source: req.source && req.source !== 'auto' ? req.source : 'auto',
    target: req.target,
    format: req.format ?? 'text',
  };
  if (cfg.apiKey) body.api_key = cfg.apiKey;

  const resp = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`libretranslate ${cfg.endpoint} HTTP ${resp.status}`);
  const data = (await resp.json()) as { translatedText?: string; detectedLanguage?: { language?: string } };
  if (!data.translatedText) throw new Error('libretranslate empty response');
  return {
    translatedText: data.translatedText,
    detectedSource: data.detectedLanguage?.language,
    provider: 'libretranslate',
    endpoint: cfg.endpoint,
    cached: false,
  };
}

async function callLingva(cfg: ProviderConfig, req: TranslateRequest): Promise<TranslateResult> {
  // Lingva 路径：/api/v1/{source}/{target}/{text}
  const src = req.source && req.source !== 'auto' ? req.source : 'auto';
  const target = req.target;
  const text = encodeURIComponent(req.text);
  const url = `${cfg.endpoint.replace(/\/$/, '')}/api/v1/${src}/${target}/${text}`;
  const resp = await fetchWithTimeout(url, { method: 'GET' });
  if (!resp.ok) throw new Error(`lingva ${cfg.endpoint} HTTP ${resp.status}`);
  const data = (await resp.json()) as { translation?: string; detectedSource?: string };
  if (!data.translation) throw new Error('lingva empty response');
  return {
    translatedText: data.translation,
    detectedSource: data.detectedSource,
    provider: 'lingva',
    endpoint: cfg.endpoint,
    cached: false,
  };
}

async function callMyMemory(cfg: ProviderConfig, req: TranslateRequest): Promise<TranslateResult> {
  // MyMemory REST: /get?q=text&langpair=src|tgt
  const src = req.source && req.source !== 'auto' ? req.source : 'Autodetect';
  const params = new URLSearchParams({
    q: req.text,
    langpair: `${src}|${req.target}`,
  });
  if (cfg.apiKey) params.set('key', cfg.apiKey);
  const url = `${cfg.endpoint.replace(/\/$/, '')}/get?${params.toString()}`;
  const resp = await fetchWithTimeout(url, { method: 'GET' });
  if (!resp.ok) throw new Error(`mymemory ${cfg.endpoint} HTTP ${resp.status}`);
  const data = (await resp.json()) as {
    responseData?: { translatedText?: string };
    responseDetails?: string;
    matches?: Array<{ source?: string; target?: string }>;
  };
  if (data.responseDetails && /INVALID/i.test(data.responseDetails)) {
    throw new Error(`mymemory invalid: ${data.responseDetails}`);
  }
  const translated = data.responseData?.translatedText;
  if (!translated) throw new Error('mymemory empty response');
  return {
    translatedText: translated,
    detectedSource: src === 'Autodetect' ? undefined : src,
    provider: 'mymemory',
    endpoint: cfg.endpoint,
    cached: false,
  };
}

async function callDeepLX(cfg: ProviderConfig, req: TranslateRequest): Promise<TranslateResult> {
  // DeepLX 自托管实例：POST /translate { text, source_lang, target_lang }
  const url = `${cfg.endpoint.replace(/\/$/, '')}/translate`;
  const body = {
    text: req.text,
    source_lang: req.source && req.source !== 'auto' ? req.source.toUpperCase() : '',
    target_lang: req.target.toUpperCase(),
  };
  const resp = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`deeplx ${cfg.endpoint} HTTP ${resp.status}`);
  const data = (await resp.json()) as { data?: string; alternatives?: string[] };
  const translated = data.data ?? data.alternatives?.[0];
  if (!translated) throw new Error('deeplx empty response');
  return {
    translatedText: translated,
    detectedSource: req.source,
    provider: 'deeplx',
    endpoint: cfg.endpoint,
    cached: false,
  };
}

const PROVIDER_DISPATCH: Record<TranslateProvider, (cfg: ProviderConfig, req: TranslateRequest) => Promise<TranslateResult>> = {
  libretranslate: callLibreTranslate,
  lingva: callLingva,
  mymemory: callMyMemory,
  deeplx: callDeepLX,
};

// ---------- 缓存（in-process；命中即返回，避免烧公共实例配额）----------

interface CacheEntry {
  translatedText: string;
  detectedSource?: string;
  provider: TranslateProvider;
  endpoint: string;
  expiresAt: number;
}

const MEMORY_CACHE = new Map<string, CacheEntry>();

function cacheKey(req: TranslateRequest, normalizedText: string): string {
  return [req.target, req.source ?? 'auto', req.format ?? 'text', normalizedText].join('\u0001');
}

function sha256Hex(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

// ---------- 公共入口 ----------

export function listProviders(settings: TranslateSettings): ProviderConfig[] {
  const list = settings.providers.length > 0 ? settings.providers : DEFAULT_PROVIDERS;
  return [...list].sort((a, b) => a.weight - b.weight);
}

/**
 * 翻译入口：按 provider 优先级尝试，首个成功即返回；全部失败抛 AggregateError。
 * 缓存命中时直接返回（cached: true）。
 */
export async function translate(
  rawReq: TranslateRequest,
  settings: TranslateSettings = DEFAULT_SETTINGS,
): Promise<TranslateResult> {
  if (!settings.enabled) {
    throw new Error('翻译功能已被管理员关闭（NodeByteTranslateEnabled=false）');
  }
  if (!rawReq.text || !rawReq.target) {
    throw new Error('text 与 target 必填');
  }

  const req: TranslateRequest = {
    ...rawReq,
    source: rawReq.source ?? 'auto',
    format: rawReq.format ?? 'text',
  };
  const normalized = req.text.trim();
  if (!normalized) {
    return { translatedText: '', detectedSource: undefined, provider: 'libretranslate', endpoint: '(empty)', cached: false };
  }

  // 缓存命中
  const key = cacheKey(req, sha256Hex(normalized));
  const hit = MEMORY_CACHE.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    return {
      translatedText: hit.translatedText,
      detectedSource: hit.detectedSource,
      provider: hit.provider,
      endpoint: hit.endpoint,
      cached: true,
    };
  }

  // 按权重依次尝试
  const providers = listProviders(settings);
  const errors: Error[] = [];
  for (const cfg of providers) {
    try {
      const result = await PROVIDER_DISPATCH[cfg.provider](cfg, req);
      // 写缓存
      MEMORY_CACHE.set(key, {
        translatedText: result.translatedText,
        detectedSource: result.detectedSource,
        provider: result.provider,
        endpoint: result.endpoint,
        expiresAt: Date.now() + settings.cacheTtlHours * 3600 * 1000,
      });
      return result;
    } catch (e) {
      errors.push(e instanceof Error ? e : new Error(String(e)));
      // 继续尝试下一个 provider
    }
  }
  throw new AggregateError(errors, `所有翻译供应商都失败（共 ${providers.length} 个）`);
}

/** 列出常见语言代码（前端下拉用；不依赖上游接口，固定列表） */
export const COMMON_LANGUAGES: ReadonlyArray<{ code: string; name: string }> = [
  { code: 'auto', name: '自动检测' },
  { code: 'zh-CN', name: '简体中文' },
  { code: 'zh-TW', name: '繁體中文' },
  { code: 'en', name: 'English' },
  { code: 'ja', name: '日本語' },
  { code: 'ko', name: '한국어' },
  { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' },
  { code: 'es', name: 'Español' },
  { code: 'it', name: 'Italiano' },
  { code: 'pt', name: 'Português' },
  { code: 'ru', name: 'Русский' },
  { code: 'ar', name: 'العربية' },
  { code: 'hi', name: 'हिन्दी' },
  { code: 'th', name: 'ไทย' },
  { code: 'vi', name: 'Tiếng Việt' },
  { code: 'id', name: 'Bahasa Indonesia' },
  { code: 'tr', name: 'Türkçe' },
  { code: 'nl', name: 'Nederlands' },
  { code: 'pl', name: 'Polski' },
];

/** 给前端/审计用的脱敏摘要（不暴露 apiKey） */
export function sanitizeProviders(list: ProviderConfig[]): Array<Omit<ProviderConfig, 'apiKey'>> {
  return list.map(({ apiKey: _omit, ...rest }) => rest);
}

/** 生成一次请求 ID（审计日志用） */
export function nextRequestId(): string {
  return randomUUID();
}
