/**
 * 翻译引擎（15 种常用翻译 API 统一适配 + 自动降级 + 后台可配）
 * =====================================================================
 * 架构（用户确认）：浏览器只连 NodeByte 后端 → 后端按「后台翻译配置」的
 * provider 顺序连接上游翻译接口。客户端永远拿不到上游地址与密钥。
 *
 *   浏览器(nodebyte://translate/整页/右键)
 *        │ ① 登录态 JWT + POST /api/translate
 *        ▼
 *   NodeByte 服务端（唯一出口）
 *        │ ② 策略检查 → 缓存查询(sha256+lang)
 *        │ ③ 按后台配置 providers(weight 升序,enabled)逐个尝试
 *        ▼
 *   翻译上游 ×15（首个成功即返回，写缓存）
 *
 * 支持的翻译 API 全矩阵：
 *   —— 无需 Key（免费公共 / 开源自托管）——
 *   1  libretranslate  AGPL-3.0   LibreTranslate（公共实例或 Docker 自托管）
 *   2  lingva          GPL-3.0    Lingva（开源 Google 代理）
 *   3  mymemory        免费配额   MyMemory（5000 词/天，无需 Key）
 *   4  deeplx          MIT        DeepLX（自托管 DeepL 代理）
 *   5  google_free     非官方     Google 翻译免费端点（translate.googleapis.com，
 *                                 client=gtx，无需 Key，最常用最稳）
 *   6  edge_free       匿名       Edge 免费翻译端点（edge.microsoft.com/translate/auth
 *                                 取匿名 JWT + api-edge.cognitive.microsofttranslator.com，
 *                                 与新版 Edge 浏览器同款，无需 Key）
 *   —— 需 Key（官方免费额度）——
 *   7  deepl           官方 Free   DeepL Free 50 万字/月（api-free.deepl.com）
 *   8  microsoft       Azure F0   Azure 翻译 200 万字/月免费（key + region）
 *   9  baidu           标准免费   百度翻译开放平台（appid+key，MD5 签名）
 *   10 youdao          新客额度   有道智云（appKey+appSecret，SHA-256 签名）
 *   11 tencent         500万/月   腾讯云 TMT（secretId+secretKey，TC3-HMAC-SHA256 签名）
 *   12 aliyun          免费额度   阿里云机器翻译（AccessKey，HMAC-SHA1 RPC 签名）
 *   13 niutrans        100万/月   小牛翻译（仅需 apiKey，REST 简单）
 *   14 yandex          免费额度   Yandex Translate（API key）
 *   15 openai_compat   按量付费   OpenAI 兼容 LLM 翻译（ChatGPT/DeepSeek/Ollama/vLLM，
 *                                 endpoint+key+model，效果最好、可自托管本地模型）
 *
 * 各家语言代码不同（zh-CN vs zh vs ZH vs zh-CHS...），per-provider 映射见 LANG_MAPS。
 * 全部零第三方依赖（crypto 用 node:crypto）。
 */

import { createHash, createHmac, randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------

export type ProviderType =
  | 'libretranslate' | 'lingva' | 'mymemory' | 'deeplx'
  | 'google_free' | 'edge_free'
  | 'deepl' | 'microsoft' | 'baidu' | 'youdao'
  | 'tencent' | 'aliyun' | 'niutrans' | 'yandex'
  | 'openai_compat';

export const ALL_PROVIDER_TYPES: readonly ProviderType[] = [
  'libretranslate', 'lingva', 'mymemory', 'deeplx',
  'google_free', 'edge_free',
  'deepl', 'microsoft', 'baidu', 'youdao',
  'tencent', 'aliyun', 'niutrans', 'yandex',
  'openai_compat',
];

/** 后台 UI 渲染凭据字段所需元信息 */
export type KeyShape = 'none' | 'apiKey' | 'appIdKey' | 'keySecret' | 'keyModel' | 'keyRegion';

export const PROVIDER_META: Record<ProviderType, {
  label: string;              // 后台显示名
  license: string;            // 协议/来源
  keyShape: KeyShape;         // 凭据字段形状
  defaultEndpoint: string;    // 默认端点（可覆盖）
  freeTier: string;           // 免费额度说明
}> = {
  libretranslate: { label: 'LibreTranslate（开源 AGPL）', license: 'AGPL-3.0 可自托管', keyShape: 'none', defaultEndpoint: 'https://libretranslate.com', freeTier: '公共实例现已需 API Key；Docker 自托管无限免费' },
  lingva:         { label: 'Lingva Translate（开源 GPL）', license: 'GPL-3.0', keyShape: 'none', defaultEndpoint: 'https://lingva.ml', freeTier: '公共实例不稳定（CF 盾）；可自托管' },
  mymemory:       { label: 'MyMemory（免费配额）', license: '免费 5000 词/天', keyShape: 'none', defaultEndpoint: 'https://api.mymemory.translated.net', freeTier: '5000 词/天（可邮箱解锁更多）' },
  deeplx:         { label: 'DeepLX（自托管 MIT）', license: 'MIT', keyShape: 'none', defaultEndpoint: 'http://127.0.0.1:1188', freeTier: '自托管无限（依赖 DeepL 免费网页）' },
  google_free:    { label: 'Google 翻译（免费端点，无需 Key）', license: '非官方端点', keyShape: 'none', defaultEndpoint: 'https://translate.googleapis.com', freeTier: '免费匿名；高频可能被限速' },
  edge_free:      { label: 'Edge 免费翻译（匿名 JWT，与新版 Edge 同款）', license: '匿名端点', keyShape: 'none', defaultEndpoint: 'https://edge.microsoft.com', freeTier: '免费匿名' },
  deepl:          { label: 'DeepL API Free（官方）', license: '官方 Free 套餐', keyShape: 'apiKey', defaultEndpoint: 'https://api-free.deepl.com', freeTier: '50 万字/月' },
  microsoft:      { label: 'Azure 翻译（Microsoft）', license: 'Azure F0', keyShape: 'keyRegion', defaultEndpoint: 'https://api.cognitive.microsofttranslator.com', freeTier: '200 万字/月免费' },
  baidu:          { label: '百度翻译开放平台', license: '标准版免费', keyShape: 'appIdKey', defaultEndpoint: 'https://fanyi-api.baidu.com', freeTier: '标准版 5 万字/月免费（可认证提额）' },
  youdao:         { label: '有道智云', license: '新用户免费额度', keyShape: 'appIdKey', defaultEndpoint: 'https://openapi.youdao.com', freeTier: '新用户赠送 50 元体验金' },
  tencent:        { label: '腾讯云机器翻译 TMT', license: '腾讯云免费额度', keyShape: 'appIdKey', defaultEndpoint: 'https://tmt.tencentcloudapi.com', freeTier: '500 万字/月免费' },
  aliyun:         { label: '阿里云机器翻译', license: '阿里云免费额度', keyShape: 'appIdKey', defaultEndpoint: 'https://mt.aliyuncs.com', freeTier: '每月 100 万字免费（通用版）' },
  niutrans:       { label: '小牛翻译 Niutrans', license: '免费额度', keyShape: 'apiKey', defaultEndpoint: 'https://api.niutrans.com', freeTier: '100 万字/月免费' },
  yandex:         { label: 'Yandex Translate', license: '免费额度', keyShape: 'apiKey', defaultEndpoint: 'https://translate.yandex.net', freeTier: '注册即赠 100 万字' },
  openai_compat:  { label: 'OpenAI 兼容 LLM（ChatGPT/DeepSeek/Ollama…）', license: '按量付费/本地自托管', keyShape: 'keyModel', defaultEndpoint: 'https://api.deepseek.com/v1', freeTier: 'DeepSeek 低至 1 元/百万 token；本地 Ollama 免费' },
};

export interface ProviderConfig {
  provider: ProviderType;
  endpoint?: string;      // 覆盖默认端点
  apiKey?: string;        // deepl/microsoft/niutrans/yandex/openai_compat/baidu(key)/tencent(secretKey)/aliyun(secret)/youdao(secret)
  appId?: string;         // baidu(appid)/youdao(appKey)/tencent(secretId)/aliyun(accessKeyId)
  appSecret?: string;     // 等价 apiKey 的别名（baidu 密钥/youdao appSecret 等），为兼容 UI 统一存 apiKey
  region?: string;        // microsoft region（如 global / eastasia）
  model?: string;         // openai_compat 模型名（deepseek-chat/gpt-4o-mini/llama3…）
  weight: number;         // 优先级，数字小者优先
  enabled: boolean;       // 是否启用
}

/** 后台设置（存 system_setting.translate_config） */
export interface TranslateSettings {
  enabled: boolean;
  providers: ProviderConfig[];
  cacheTtlHours: number;
  auditLog: boolean;
  defaultTarget: string;
}

export const DEFAULT_SETTINGS: TranslateSettings = {
  enabled: true,
  providers: [],       // 空 = 使用 DEFAULT_PROVIDERS（6 个免 Key）
  cacheTtlHours: 168,
  auditLog: false,
  defaultTarget: 'zh-CN',
};

/** 开箱即用的免 Key 梯队（后台未配置时的默认值；顺序=优先级）
 *  实测可用性排序：google_free / mymemory 已验证可用；
 *  libretranslate 公共实例现已收紧（需 Key 或已关停）→ 默认停用，自托管后启用；
 *  deeplx / openai_compat 需自托管/密钥 → 默认停用，后台添加后启用。
 */
export const DEFAULT_PROVIDERS: ProviderConfig[] = [
  { provider: 'google_free', weight: 10, enabled: true },
  { provider: 'edge_free',   weight: 20, enabled: true },
  { provider: 'mymemory',    weight: 30, enabled: true },
  { provider: 'libretranslate', endpoint: 'https://libretranslate.com', weight: 40, enabled: false },
  { provider: 'lingva',      endpoint: 'https://lingva.ml', weight: 50, enabled: false },
  { provider: 'deeplx',      endpoint: 'http://127.0.0.1:1188', weight: 90, enabled: false },
];

export interface TranslateRequest {
  text: string;
  source?: string;      // 'auto' 或语言代码
  target: string;
  format?: 'text' | 'html';
}

export interface TranslateResult {
  translatedText: string;
  detectedSource?: string;
  provider: ProviderType;
  endpoint: string;
  cached: boolean;
}

const REQUEST_TIMEOUT_MS = 10000;

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function ep(cfg: ProviderConfig, fallback: string): string {
  return (cfg.endpoint && cfg.endpoint.trim()) || fallback;
}

// ---------------------------------------------------------------------
// 语言代码映射（内部代码 → 各家代码）
// ---------------------------------------------------------------------

type LangMap = Record<string, string>;

const M: LangMap = {
  'zh-CN': 'zh-CN', 'zh-TW': 'zh-TW', 'en': 'en', 'ja': 'ja', 'ko': 'ko',
  'fr': 'fr', 'de': 'de', 'es': 'es', 'it': 'it', 'pt': 'pt', 'ru': 'ru',
  'ar': 'ar', 'hi': 'hi', 'th': 'th', 'vi': 'vi', 'id': 'id', 'tr': 'tr',
  'nl': 'nl', 'pl': 'pl',
};

const LANG_MAPS: Partial<Record<ProviderType, (code: string, role: 'source' | 'target') => string>> = {
  // 百度：zh / cht / jp / kor / fra / de / spa / it / pt / ru / ara / hin / tha / vie / id / tr / nl / pl
  baidu: (c) => ({
    'zh-CN': 'zh', 'zh-TW': 'cht', 'ja': 'jp', 'ko': 'kor', 'fr': 'fra',
    'es': 'spa', 'ar': 'ara', 'hi': 'hin', 'th': 'tha', 'vi': 'vie',
    ...M,
  }[c] ?? c),
  // 有道：zh-CHS / zh-CHT / ja / ko / fr / de / es / it / pt / ru / ar / hi / th / vi / id / tr / nl / pl
  youdao: (c) => ({
    'zh-CN': 'zh-CHS', 'zh-TW': 'zh-CHT',
    ...M,
  }[c] ?? c),
  // 腾讯/阿里/小牛：zh / zh-TW（简繁区分同内部码，去地区号）
  tencent: (c) => c,
  aliyun: (c) => (c === 'zh-CN' ? 'zh' : c === 'zh-TW' ? 'zh-TW' : c),
  niutrans: (c) => (c === 'zh-CN' ? 'zh' : c),
  // DeepL：大写；en 目标默认 EN-US；zh-CN → ZH（新 API 亦可用 ZH-HANS，用 ZH 兼容最广）
  deepl: (c, role) => {
    if (c === 'auto') return 'auto';
    if (c === 'zh-CN') return 'ZH';
    if (c === 'zh-TW') return 'ZH';
    if (c === 'en') return role === 'target' ? 'EN-US' : 'EN';
    return c.toUpperCase();
  },
  // 微软/Bing：zh-Hans / zh-Hant
  microsoft: (c) => (c === 'zh-CN' ? 'zh-Hans' : c === 'zh-TW' ? 'zh-Hant' : c),
  edge_free: (c) => (c === 'zh-CN' ? 'zh-Hans' : c === 'zh-TW' ? 'zh-Hant' : c),
  // Yandex：zh
  yandex: (c) => (c === 'zh-CN' ? 'zh' : c),
  // openai_compat：直接把语言显示名塞进 prompt，无需映射
};

function toLang(p: ProviderType, code: string, role: 'source' | 'target'): string {
  const fn = LANG_MAPS[p];
  return fn ? fn(code, role) : code;
}

// ---------------------------------------------------------------------
// 各家适配器（全部零第三方依赖）
// ---------------------------------------------------------------------

async function adLibreTranslate(cfg: ProviderConfig, req: TranslateRequest): Promise<TranslateResult> {
  const base = ep(cfg, PROVIDER_META.libretranslate.defaultEndpoint);
  const body: Record<string, unknown> = {
    q: req.text,
    source: req.source && req.source !== 'auto' ? toLang('libretranslate', req.source, 'source') : 'auto',
    target: toLang('libretranslate', req.target, 'target'),
    format: 'text',
  };
  if (cfg.apiKey) body.api_key = cfg.apiKey;
  const r = await fetchWithTimeout(`${base.replace(/\/$/, '')}/translate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const d = await r.json() as { translatedText?: string; detectedLanguage?: { language?: string } };
  if (!d.translatedText) throw new Error('empty response');
  return { translatedText: d.translatedText, detectedSource: d.detectedLanguage?.language, provider: 'libretranslate', endpoint: base, cached: false };
}

async function adLingva(cfg: ProviderConfig, req: TranslateRequest): Promise<TranslateResult> {
  const base = ep(cfg, PROVIDER_META.lingva.defaultEndpoint);
  const src = req.source && req.source !== 'auto' ? toLang('lingva', req.source, 'source') : 'auto';
  const url = `${base.replace(/\/$/, '')}/api/v1/${src}/${toLang('lingva', req.target, 'target')}/${encodeURIComponent(req.text)}`;
  const r = await fetchWithTimeout(url, { method: 'GET' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const d = await r.json() as { translation?: string; detectedSource?: string };
  if (!d.translation) throw new Error('empty response');
  return { translatedText: d.translation, detectedSource: d.detectedSource, provider: 'lingva', endpoint: base, cached: false };
}

async function adMyMemory(cfg: ProviderConfig, req: TranslateRequest): Promise<TranslateResult> {
  const base = ep(cfg, PROVIDER_META.mymemory.defaultEndpoint);
  const src = req.source && req.source !== 'auto' ? toLang('mymemory', req.source, 'source') : 'Autodetect';
  const p = new URLSearchParams({ q: req.text, langpair: `${src}|${toLang('mymemory', req.target, 'target')}` });
  if (cfg.apiKey) p.set('key', cfg.apiKey);
  const r = await fetchWithTimeout(`${base.replace(/\/$/, '')}/get?${p.toString()}`, { method: 'GET' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const d = await r.json() as { responseData?: { translatedText?: string }; responseDetails?: string };
  if (d.responseDetails && /INVALID|LIMIT/i.test(d.responseDetails)) throw new Error(d.responseDetails);
  if (!d.responseData?.translatedText) throw new Error('empty response');
  return { translatedText: d.responseData.translatedText, detectedSource: src === 'Autodetect' ? undefined : src, provider: 'mymemory', endpoint: base, cached: false };
}

async function adDeepLX(cfg: ProviderConfig, req: TranslateRequest): Promise<TranslateResult> {
  const base = ep(cfg, PROVIDER_META.deeplx.defaultEndpoint);
  const r = await fetchWithTimeout(`${base.replace(/\/$/, '')}/translate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: req.text,
      source_lang: req.source && req.source !== 'auto' ? toLang('deeplx', req.source, 'source').toUpperCase() : '',
      target_lang: toLang('deeplx', req.target, 'target').toUpperCase(),
    }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const d = await r.json() as { data?: string; alternatives?: string[] };
  const t = d.data ?? d.alternatives?.[0];
  if (!t) throw new Error('empty response');
  return { translatedText: t, detectedSource: req.source, provider: 'deeplx', endpoint: base, cached: false };
}

/** Google 翻译免费端点（client=gtx，无需 Key） */
async function adGoogleFree(cfg: ProviderConfig, req: TranslateRequest): Promise<TranslateResult> {
  const base = ep(cfg, PROVIDER_META.google_free.defaultEndpoint);
  const src = req.source && req.source !== 'auto' ? toLang('google_free', req.source, 'source') : 'auto';
  const p = new URLSearchParams({
    client: 'gtx', sl: src, tl: toLang('google_free', req.target, 'target'),
    dt: 't', q: req.text,
  });
  const r = await fetchWithTimeout(`${base.replace(/\/$/, '')}/translate_a/single?${p.toString()}`, { method: 'GET' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  // 返回形如 [[["你好，世界","Hello, world!",null,null,10]],null,"en",...]
  const arr = await r.json() as unknown;
  if (!Array.isArray(arr) || !Array.isArray(arr[0])) throw new Error('unexpected response shape');
  let out = '';
  for (const seg of arr[0] as unknown[]) {
    if (Array.isArray(seg) && typeof seg[0] === 'string') out += seg[0];
  }
  if (!out) throw new Error('empty response');
  const detected = typeof arr[2] === 'string' ? arr[2] : undefined;
  return { translatedText: out, detectedSource: detected, provider: 'google_free', endpoint: base, cached: false };
}

/** Edge 免费翻译（与新版 Edge 浏览器同款：匿名 auth JWT + translator API，无需 Key） */
let edgeJwtCache: { token: string; expiresAt: number } | null = null;

async function adEdgeFree(cfg: ProviderConfig, req: TranslateRequest): Promise<TranslateResult> {
  const base = ep(cfg, 'https://edge.microsoft.com').replace(/\/$/, '');
  if (!edgeJwtCache || edgeJwtCache.expiresAt < Date.now() + 60_000) {
    const ar = await fetchWithTimeout(`${base}/translate/auth`, { method: 'GET' });
    if (!ar.ok) throw new Error(`auth HTTP ${ar.status}`);
    const token = (await ar.text()).trim();
    if (!token || token.length < 20) throw new Error('auth token invalid');
    // Edge 匿名 JWT 有效期约 10 分钟
    edgeJwtCache = { token, expiresAt: Date.now() + 9 * 60_000 };
  }
  const trBase = base.replace('edge.microsoft.com', 'api-edge.cognitive.microsofttranslator.com');
  const src = req.source && req.source !== 'auto' ? toLang('edge_free', req.source, 'source') : undefined;
  const p = new URLSearchParams({ 'api-version': '3.0', to: toLang('edge_free', req.target, 'target') });
  if (src) p.set('from', src);
  const r = await fetchWithTimeout(`${trBase}/translate?${p.toString()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${edgeJwtCache.token}` },
    body: JSON.stringify([{ Text: req.text }]),
  });
  if (!r.ok) { edgeJwtCache = null; throw new Error(`HTTP ${r.status}`); }
  const d = await r.json() as Array<{ translations?: Array<{ text?: string; to?: string }>; detectedLanguage?: { language?: string } }>;
  const t = d?.[0]?.translations?.[0]?.text;
  if (!t) throw new Error('empty response');
  return { translatedText: t, detectedSource: d[0].detectedLanguage?.language, provider: 'edge_free', endpoint: trBase, cached: false };
}

/** DeepL 官方 Free/Pro（api-free.deepl.com / api.deepl.com） */
async function adDeepL(cfg: ProviderConfig, req: TranslateRequest): Promise<TranslateResult> {
  if (!cfg.apiKey) throw new Error('缺少 apiKey（DeepL Auth Key）');
  const base = ep(cfg, PROVIDER_META.deepl.defaultEndpoint);
  const p = new URLSearchParams({ text: req.text, target_lang: toLang('deepl', req.target, 'target') });
  if (req.source && req.source !== 'auto') p.set('source_lang', toLang('deepl', req.source, 'source'));
  const r = await fetchWithTimeout(`${base.replace(/\/$/, '')}/v2/translate`, {
    method: 'POST',
    headers: { Authorization: `DeepL-Auth-Key ${cfg.apiKey}` },
    body: p.toString(),
    // DeepL 需要 application/x-www-form-urlencoded
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${r.status === 403 ? '(key 无效或额度耗尽)' : ''}`);
  const d = await r.json() as { translations?: Array<{ text?: string; detected_source_language?: string }> };
  const t = d.translations?.[0]?.text;
  if (!t) throw new Error('empty response');
  return { translatedText: t, detectedSource: d.translations?.[0]?.detected_source_language?.toLowerCase(), provider: 'deepl', endpoint: base, cached: false };
}

/** Azure / Microsoft Translator（key + region） */
async function adMicrosoft(cfg: ProviderConfig, req: TranslateRequest): Promise<TranslateResult> {
  if (!cfg.apiKey) throw new Error('缺少 apiKey（Azure 订阅密钥）');
  const base = ep(cfg, PROVIDER_META.microsoft.defaultEndpoint);
  const src = req.source && req.source !== 'auto' ? toLang('microsoft', req.source, 'source') : undefined;
  const p = new URLSearchParams({ 'api-version': '3.0', to: toLang('microsoft', req.target, 'target') });
  if (src) p.set('from', src);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Ocp-Apim-Subscription-Key': cfg.apiKey,
  };
  if (cfg.region && cfg.region !== 'global') headers['Ocp-Apim-Subscription-Region'] = cfg.region;
  const r = await fetchWithTimeout(`${base.replace(/\/$/, '')}/translate?${p.toString()}`, {
    method: 'POST', headers, body: JSON.stringify([{ Text: req.text }]),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${r.status === 401 ? '(key/region 无效)' : ''}`);
  const d = await r.json() as Array<{ translations?: Array<{ text?: string }>; detectedLanguage?: { language?: string } }>;
  const t = d?.[0]?.translations?.[0]?.text;
  if (!t) throw new Error('empty response');
  return { translatedText: t, detectedSource: d[0].detectedLanguage?.language, provider: 'microsoft', endpoint: base, cached: false };
}

/** 百度翻译开放平台（appid + key，MD5 签名） */
async function adBaidu(cfg: ProviderConfig, req: TranslateRequest): Promise<TranslateResult> {
  if (!cfg.appId || !cfg.apiKey) throw new Error('缺少 appId / apiKey（百度 APPID + 密钥）');
  const base = ep(cfg, PROVIDER_META.baidu.defaultEndpoint);
  const salt = String(Math.floor(Math.random() * 1e9));
  const sign = createHash('md5').update(cfg.appId + req.text + salt + cfg.apiKey, 'utf8').digest('hex');
  const p = new URLSearchParams({
    q: req.text,
    from: req.source && req.source !== 'auto' ? toLang('baidu', req.source, 'source') : 'auto',
    to: toLang('baidu', req.target, 'target'),
    appid: cfg.appId, salt, sign,
  });
  const r = await fetchWithTimeout(`${base.replace(/\/$/, '')}/api/trans/vip/translate?${p.toString()}`, { method: 'GET' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const d = await r.json() as { trans_result?: Array<{ src?: string; dst?: string }>; error_code?: string; error_msg?: string };
  if (d.error_code) throw new Error(`百度错误 ${d.error_code}: ${d.error_msg ?? ''}`);
  const t = d.trans_result?.map((x) => x.dst ?? '').join('\n');
  if (!t) throw new Error('empty response');
  return { translatedText: t, provider: 'baidu', endpoint: base, cached: false };
}

/** 有道智云（appKey + appSecret，SHA-256 签名） */
async function adYoudao(cfg: ProviderConfig, req: TranslateRequest): Promise<TranslateResult> {
  if (!cfg.appId || !cfg.apiKey) throw new Error('缺少 appKey / appSecret（有道智云）');
  const base = ep(cfg, PROVIDER_META.youdao.defaultEndpoint);
  const salt = randomUUID().replace(/-/g, '');
  const curtime = String(Math.floor(Date.now() / 1000));
  // input 按官方规则截断：q 长度 > 20 时取前 10 + 长度 + 后 10
  const q = req.text;
  const input = q.length > 20 ? `${q.slice(0, 10)}${q.length}${q.slice(-10)}` : q;
  const sign = createHash('sha256').update(cfg.appId + input + salt + curtime + cfg.apiKey, 'utf8').digest('hex');
  const body = new URLSearchParams({
    q, from: req.source && req.source !== 'auto' ? toLang('youdao', req.source, 'source') : 'auto',
    to: toLang('youdao', req.target, 'target'),
    appKey: cfg.appId, salt, sign, signType: 'v3', curtime,
  });
  const r = await fetchWithTimeout(`${base.replace(/\/$/, '')}/api`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const d = await r.json() as { errorCode?: string; translation?: string[] };
  if (d.errorCode && d.errorCode !== '0') throw new Error(`有道错误码 ${d.errorCode}`);
  const t = d.translation?.[0];
  if (!t) throw new Error('empty response');
  return { translatedText: t, provider: 'youdao', endpoint: base, cached: false };
}

/** 腾讯云 TMT（secretId + secretKey，TC3-HMAC-SHA256 签名，零依赖实现） */
async function adTencent(cfg: ProviderConfig, req: TranslateRequest): Promise<TranslateResult> {
  if (!cfg.appId || !cfg.apiKey) throw new Error('缺少 secretId / secretKey（腾讯云）');
  const base = ep(cfg, PROVIDER_META.tencent.defaultEndpoint);
  const host = base.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const service = 'tmt';
  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);

  const payload = JSON.stringify({
    SourceText: req.text,
    Source: req.source && req.source !== 'auto' ? toLang('tencent', req.source, 'source') : 'auto',
    Target: toLang('tencent', req.target, 'target'),
    ProjectId: 0,
  });
  const hashedPayload = createHash('sha256').update(payload).digest('hex');
  const canonicalRequest = `POST\n/\n\ncontent-type:application/json\nhost:${host}\n\ncontent-type;host\n${hashedPayload}`;
  const stringToSign = `TC3-HMAC-SHA256\n${timestamp}\n${date}/${service}/tc3_request\n${createHash('sha256').update(canonicalRequest).digest('hex')}`;

  // TC3 签名链：SecretDate → SecretService → SecretSigning
  const kDate = createHmac('sha256', `TC3${cfg.apiKey}`).update(date).digest();
  const kService = createHmac('sha256', kDate).update(service).digest();
  const kSigning = createHmac('sha256', kService).update('tc3_request').digest();
  const signature = createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

  const r = await fetchWithTimeout(`https://${host}/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Host: host,
      'X-TC-Action': 'TextTranslate',
      'X-TC-Version': '2018-03-21',
      'X-TC-Timestamp': String(timestamp),
      Authorization: `TC3-HMAC-SHA256 Credential=${cfg.appId}/${date}/${service}/tc3_request, SignedHeaders=content-type;host, Signature=${signature}`,
    },
    body: payload,
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const d = await r.json() as { Response?: { TargetText?: string; Source?: string; Error?: { Code?: string; Message?: string } } };
  if (d.Response?.Error) throw new Error(`腾讯云错误 ${d.Response.Error.Code}: ${d.Response.Error.Message ?? ''}`);
  const t = d.Response?.TargetText;
  if (!t) throw new Error('empty response');
  return { translatedText: t, detectedSource: d.Response?.Source, provider: 'tencent', endpoint: base, cached: false };
}

/** 阿里云机器翻译（AccessKeyId + AccessKeySecret，HMAC-SHA1 RPC 签名） */
async function adAliyun(cfg: ProviderConfig, req: TranslateRequest): Promise<TranslateResult> {
  if (!cfg.appId || !cfg.apiKey) throw new Error('缺少 AccessKeyId / AccessKeySecret（阿里云）');
  const base = ep(cfg, PROVIDER_META.aliyun.defaultEndpoint);
  const nonce = randomUUID();
  const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

  const params: Record<string, string> = {
    Action: 'TranslateGeneral',
    Version: '2018-10-12',
    FormatType: 'text',
    SourceLanguage: req.source && req.source !== 'auto' ? toLang('aliyun', req.source, 'source') : 'auto',
    TargetLanguage: toLang('aliyun', req.target, 'target'),
    SourceText: req.text,
    Scene: 'general',
    AccessKeyId: cfg.appId,
    SignatureMethod: 'HMAC-SHA1',
    SignatureNonce: nonce,
    SignatureVersion: '1.0',
    Timestamp: timestamp,
    Format: 'JSON',
  };
  // RPC 签名：参数排序 → percent-encode(RFC3986) → 拼查询串 → HMAC-SHA1(AccessKeySecret + '&')
  const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
  const sorted = Object.keys(params).sort().map((k) => `${enc(k)}=${enc(params[k])}`).join('&');
  const stringToSign = `GET&${enc('/')}&${enc(sorted)}`;
  const signature = createHmac('sha1', `${cfg.apiKey}&`).update(stringToSign, 'utf8').digest('base64');
  params.Signature = signature;

  const r = await fetchWithTimeout(`${base.replace(/\/$/, '')}/?${Object.entries(params).map(([k, v]) => `${enc(k)}=${enc(v)}`).join('&')}`, { method: 'GET' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const d = await r.json() as { Data?: { Translated?: string; DetectedLanguage?: string }; Code?: string; Message?: string };
  if (d.Code && d.Code !== '200') throw new Error(`阿里云错误 ${d.Code}: ${d.Message ?? ''}`);
  const t = d.Data?.Translated;
  if (!t) throw new Error('empty response');
  return { translatedText: t, detectedSource: d.Data?.DetectedLanguage, provider: 'aliyun', endpoint: base, cached: false };
}

/** 小牛翻译（仅需 apiKey，REST 简单） */
async function adNiutrans(cfg: ProviderConfig, req: TranslateRequest): Promise<TranslateResult> {
  if (!cfg.apiKey) throw new Error('缺少 apiKey（小牛翻译 NiuToken）');
  const base = ep(cfg, PROVIDER_META.niutrans.defaultEndpoint);
  const body = new URLSearchParams({
    from: req.source && req.source !== 'auto' ? toLang('niutrans', req.source, 'source') : 'auto',
    to: toLang('niutrans', req.target, 'target'),
    apikey: cfg.apiKey,
    src_text: req.text,
  });
  const r = await fetchWithTimeout(`${base.replace(/\/$/, '')}/NiuTransServer/translation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const d = await r.json() as { tgt_text?: string; from?: string; error_msg?: string };
  if (d.error_msg) throw new Error(d.error_msg);
  if (!d.tgt_text) throw new Error('empty response');
  return { translatedText: d.tgt_text, detectedSource: d.from, provider: 'niutrans', endpoint: base, cached: false };
}

/** Yandex Translate（API key） */
async function adYandex(cfg: ProviderConfig, req: TranslateRequest): Promise<TranslateResult> {
  if (!cfg.apiKey) throw new Error('缺少 apiKey（Yandex API Key）');
  const base = ep(cfg, PROVIDER_META.yandex.defaultEndpoint);
  const r = await fetchWithTimeout(`${base.replace(/\/$/, '')}/api/v5/tr.json/translate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Api-Key ${cfg.apiKey}`,
    },
    body: new URLSearchParams({
      text: req.text,
      lang: req.source && req.source !== 'auto'
        ? `${toLang('yandex', req.source, 'source')}-${toLang('yandex', req.target, 'target')}`
        : toLang('yandex', req.target, 'target'),
    }).toString(),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const d = await r.json() as { text?: string[]; code?: number; message?: string; detected?: { lang?: string } };
  if (d.code && d.code !== 200) throw new Error(`Yandex 错误 ${d.code}: ${d.message ?? ''}`);
  const t = d.text?.[0];
  if (!t) throw new Error('empty response');
  return { translatedText: t, detectedSource: d.detected?.lang, provider: 'yandex', endpoint: base, cached: false };
}

/** OpenAI 兼容 LLM 翻译（ChatGPT / DeepSeek / Ollama / vLLM / 各类中转） */
async function adOpenAICompat(cfg: ProviderConfig, req: TranslateRequest): Promise<TranslateResult> {
  if (!cfg.apiKey && !/localhost|127\.0\.0\.1|ollama/i.test(ep(cfg, PROVIDER_META.openai_compat.defaultEndpoint))) {
    throw new Error('缺少 apiKey（LLM 服务密钥；本地 Ollama 可留空）');
  }
  const base = ep(cfg, PROVIDER_META.openai_compat.defaultEndpoint);
  const langName = (code: string) => {
    if (code !== 'zh-CN') return code;
    return '简体中文 (Simplified Chinese)';
  };
  const system = 'You are a professional translation engine. Translate the user text faithfully to the target language. Output ONLY the translation, no explanations, no quotes. Keep formatting and line breaks.';
  const user = `Translate to ${langName(toLang('openai_compat', req.target, 'target'))}:\n${req.text}`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
  const r = await fetchWithTimeout(`${base.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST', headers,
    body: JSON.stringify({
      model: cfg.model || 'deepseek-chat',
      temperature: 0.1,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  }, 30000);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const d = await r.json() as { choices?: Array<{ message?: { content?: string } }> };
  const t = d.choices?.[0]?.message?.content?.trim();
  if (!t) throw new Error('empty response');
  return { translatedText: t, provider: 'openai_compat', endpoint: base, cached: false };
}

// ---------------------------------------------------------------------
// 分发表
// ---------------------------------------------------------------------

const ADAPTERS: Record<ProviderType, (cfg: ProviderConfig, req: TranslateRequest) => Promise<TranslateResult>> = {
  libretranslate: adLibreTranslate,
  lingva: adLingva,
  mymemory: adMyMemory,
  deeplx: adDeepLX,
  google_free: adGoogleFree,
  edge_free: adEdgeFree,
  deepl: adDeepL,
  microsoft: adMicrosoft,
  baidu: adBaidu,
  youdao: adYoudao,
  tencent: adTencent,
  aliyun: adAliyun,
  niutrans: adNiutrans,
  yandex: adYandex,
  openai_compat: adOpenAICompat,
};

// ---------------------------------------------------------------------
// 缓存
// ---------------------------------------------------------------------

interface CacheEntry {
  translatedText: string;
  detectedSource?: string;
  provider: ProviderType;
  endpoint: string;
  expiresAt: number;
}

const MEMORY_CACHE = new Map<string, CacheEntry>();

function sha256Hex(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

function cacheKey(req: TranslateRequest, normalizedText: string): string {
  return [req.target, req.source ?? 'auto', req.format ?? 'text', normalizedText].join(' ');
}

// ---------------------------------------------------------------------
// 公共入口
// ---------------------------------------------------------------------

/** 供后台未配置时使用的默认梯队 */
export function listProviders(settings: TranslateSettings): ProviderConfig[] {
  const list = (settings.providers.length > 0 ? settings.providers : DEFAULT_PROVIDERS)
    .filter((p) => p.enabled !== false);
  return [...list].sort((a, b) => a.weight - b.weight);
}

/** 翻译主入口：按后台配置逐个尝试，首个成功即返回 */
export async function translate(
  rawReq: TranslateRequest,
  settings: TranslateSettings = DEFAULT_SETTINGS,
): Promise<TranslateResult> {
  if (!settings.enabled) throw new Error('翻译功能已被管理员关闭（NodeByteTranslateEnabled=false）');
  if (!rawReq.text || !rawReq.target) throw new Error('text 与 target 必填');

  const req: TranslateRequest = {
    ...rawReq,
    source: rawReq.source ?? 'auto',
    format: rawReq.format ?? 'text',
  };
  const normalized = req.text.trim();
  if (!normalized) {
    return { translatedText: '', provider: 'libretranslate', endpoint: '(empty)', cached: false };
  }

  const key = cacheKey(req, sha256Hex(normalized));
  const hit = MEMORY_CACHE.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    return { translatedText: hit.translatedText, detectedSource: hit.detectedSource, provider: hit.provider, endpoint: hit.endpoint, cached: true };
  }

  const providers = listProviders(settings);
  if (providers.length === 0) throw new Error('后台未配置任何启用的翻译接口');

  const errors: string[] = [];
  for (const cfg of providers) {
    try {
      const result = await ADAPTERS[cfg.provider](cfg, req);
      MEMORY_CACHE.set(key, {
        translatedText: result.translatedText,
        detectedSource: result.detectedSource,
        provider: result.provider,
        endpoint: result.endpoint,
        expiresAt: Date.now() + settings.cacheTtlHours * 3600 * 1000,
      });
      return result;
    } catch (e) {
      errors.push(`${cfg.provider}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  throw new AggregateError(errors.map((m) => new Error(m)), `所有翻译接口均失败（共 ${providers.length} 个）：${errors.join(' | ')}`);
}

/** 管理员一键测试某个 provider 配置是否可用（翻译 "Hello, world!" → zh-CN） */
export async function testProvider(cfg: ProviderConfig): Promise<{ ok: boolean; detail: string; sample?: string; latencyMs?: number }> {
  const meta = PROVIDER_META[cfg.provider];
  if (!meta) return { ok: false, detail: '未知 provider 类型' };
  const started = Date.now();
  try {
    const r = await ADAPTERS[cfg.provider](cfg, { text: 'Hello, world! This is a test.', source: 'auto', target: 'zh-CN', format: 'text' });
    return { ok: true, detail: `连通成功（${meta.label}）`, sample: r.translatedText, latencyMs: Date.now() - started };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e), latencyMs: Date.now() - started };
  }
}

/** 常见语言列表（前端下拉用） */
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

/** 前端/审计用的脱敏（去掉密钥字段） */
export function sanitizeProviders(list: ProviderConfig[]): Array<Record<string, unknown>> {
  return list.map((p) => ({
    ...p,
    apiKey: p.apiKey ? '••••••••(已配置)' : undefined,
    appSecret: undefined,
  }));
}
