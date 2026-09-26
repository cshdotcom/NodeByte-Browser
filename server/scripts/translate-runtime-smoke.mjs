// translate-runtime-smoke.mjs — v1.4.3 三家新适配器运行时冒烟（stub fetch，无真实网络）
// 运行：node --experimental-strip-types server/scripts/translate-runtime-smoke.mjs
// 说明：适配器为模块私有，经公共入口 testProvider() 触发；stub 返回 {"__stub":true}
//       → 适配器应精确抛出「empty response」（证明请求构造/签名链完整，仅解析到桩响应失败）。
import assert from 'node:assert/strict';

let captured = null;
globalThis.fetch = async (url, init) => {
  captured = { url: String(url), init };
  return new Response(JSON.stringify({ __stub: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

const mod = await import('../src/lib/translate.ts');
const req = { text: 'Hello, world!', source: 'auto', target: 'zh-CN', format: 'text' };
let ok = 0, fail = 0;
const check = (name, cond) => { if (cond) { console.log(`  ok   ${name}`); ok++; } else { console.log(`  FAIL ${name}`); fail++; } };
const run = (provider, cfg) => mod.testProvider({ provider, weight: 10, enabled: true, ...cfg });

// 1) Papago：双头 + form body
let r = await run('papago', { appId: 'test-id', apiKey: 'test-secret' });
check('papago URL = openapi.naver.com/v1/papago/n2mt', captured.url === 'https://openapi.naver.com/v1/papago/n2mt');
check('papago 双头鉴权', captured.init.headers['X-Naver-Client-ID'] === 'test-id' && captured.init.headers['X-Naver-Client-Secret'] === 'test-secret');
check('papago form: source=auto&target=zh-CN', /source=auto&target=zh/.test(captured.init.body));
check('papago 走到响应解析（empty response）', r.ok === false && /empty response/.test(r.detail));

// 2) Volcengine：V4 签名结构 + JSON body
r = await run('volcengine', { appId: 'AKTP-test', apiKey: 'sk-test' });
check('volcengine URL 带 Action/Version', captured.url.includes('Action=TranslateText') && captured.url.includes('Version=2020-06-01'));
const h = captured.init.headers;
check('volcengine Authorization HMAC4-SHA256 Credential', /HMAC4-SHA256 Credential=AKTP-test\/\d{8}\/cn-north-1\/translate\/request/.test(h.Authorization));
check('volcengine SignedHeaders 四头', h.Authorization.includes('SignedHeaders=content-type;host;x-content-sha256;x-date'));
check('volcengine x-date 形如 YYYYMMDDTHHMMSSZ', /^\d{8}T\d{6}Z$/.test(h['X-Date']));
check('volcengine x-content-sha256 = body 摘要（64 hex）', /^[0-9a-f]{64}$/.test(h['X-Content-Sha256']));
const bodyObj = JSON.parse(captured.init.body);
check('volcengine body: TargetLanguage=zh', bodyObj.TargetLanguage === 'zh' && typeof bodyObj.Text === 'string' && bodyObj.Text.length > 0);
check('volcengine 走到响应解析（empty response）', r.ok === false && /empty response/.test(r.detail));

// 3) Caiyun：token 头 + trans_type auto2zh
r = await run('caiyun', { apiKey: 'ct-test' });
check('caiyun URL = /v1/translator', captured.url === 'https://api.interpreter.caiyunai.com/v1/translator');
check('caiyun X-Authorization token', captured.init.headers['X-Authorization'] === 'token ct-test');
const cbody = JSON.parse(captured.init.body);
check('caiyun trans_type auto2zh + detect', cbody.trans_type === 'auto2zh' && cbody.detect === true && Array.isArray(cbody.source));
check('caiyun 走到响应解析（empty response）', r.ok === false && /empty response/.test(r.detail));

// 4) 语言映射路径：en→zh / zh→zh
r = await run('caiyun', { apiKey: 'ct-test' }); // 重置后用 testProvider 固定 auto→zh
captured = null;
await mod.translate({ ...req, source: 'en' }, { enabled: true, providers: [{ provider: 'caiyun', apiKey: 'ct', weight: 1, enabled: true }], cacheTtlHours: 0, auditLog: false, defaultTarget: 'zh-CN' }).catch(() => {});
check('caiyun translate() en2zh', JSON.parse(captured.init.body).trans_type === 'en2zh');
captured = null;
await mod.translate(req, { enabled: true, providers: [{ provider: 'volcengine', appId: 'a', apiKey: 'b', weight: 1, enabled: true }], cacheTtlHours: 0, auditLog: false, defaultTarget: 'zh-CN' }).catch(() => {});
check('volcengine translate() zh 目标', JSON.parse(captured.init.body).TargetLanguage === 'zh');

console.log(`\ntranslate-runtime-smoke: ${ok} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
