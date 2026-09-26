// upstream-selftest.mjs — 上游服务（TTS/更新源/扩展代理）零依赖自测（CNB lite-validate / CI 调用）
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
let ok = 0, fail = 0;
function check(name, cond) {
  if (cond) { console.log(`  ok   ${name}`); ok++; }
  else { console.log(`  FAIL ${name}`); fail++; }
}

// ---- tts.ts ----
const tts = readFileSync(join(__dirname, '..', 'src', 'lib', 'tts.ts'), 'utf8');
for (const t of ['edge_tts_server', 'azure_speech', 'openai_speech']) {
  check(`TTS 类型 ${t} 已注册`, tts.includes(`'${t}'`));
}
check('TTS 适配器 ×3', /ttsEdgeServer/.test(tts) && /ttsAzure/.test(tts) && /ttsOpenAI/.test(tts));
check('Azure SSML 合成', /<speak version/.test(tts));
check('Azure F0 token 端点', /sts\/v1\.0\/issueToken/.test(tts));
check('OpenAI /audio/speech', /audio\/speech/.test(tts));
check('synthesize() 主入口', /export\s+async\s+function\s+synthesize/.test(tts));
check('testTtsProvider() 测试入口', /export\s+async\s+function\s+testTtsProvider/.test(tts));
check('TTS 超时 30s', /REQUEST_TIMEOUT_MS\s*=\s*30000/.test(tts));

// ---- 路由 ----
function checkRoute(path, patterns, label) {
  try {
    const r = readFileSync(join(__dirname, '..', 'src', 'app', path), 'utf8');
    for (const p of patterns) if (!p.re.test(r)) throw new Error(p.name);
    console.log(`  ok   ${label}`); ok++;
  } catch (e) { console.log(`  FAIL ${label}: ${e.message}`); fail++; }
}
checkRoute('api/tts/route.ts',
  [{ re: /export\s+async\s+function\s+POST/, name: 'POST' }, { re: /export\s+async\s+function\s+GET/, name: 'GET' }, { re: /new Response\(result\.audio/, name: 'audio stream' }],
  '/api/tts 路由完整（GET 元信息 + POST 音频流）');
checkRoute('api/admin/tts-config/route.ts',
  [{ re: /export\s+async\s+function\s+PUT/, name: 'PUT' }, { re: /p\.apiKey = old\.apiKey/, name: 'key merge' }],
  '/api/admin/tts-config 完整（含密钥 merge）');
checkRoute('api/admin/tts-test/route.ts',
  [{ re: /testTtsProvider/, name: 'test call' }], '/api/admin/tts-test 完整');
checkRoute('api/client/update/route.ts',
  [{ re: /compareVersions/, name: 'version cmp' }, { re: /upstreamManifestUrl/, name: 'manifest 转发' }],
  '/api/client/update 完整（手工清单 + manifest 转发）');
checkRoute('api/client/ext-download/route.ts',
  [{ re: /edgeMirror|chromeMirror/, name: 'mirror' }, { re: /redirectUrl/, name: 'redirect' }],
  '/api/client/ext-download 完整（官方直连 + 镜像模板）');

// ---- 后台面板 ----
const admin = readFileSync(join(__dirname, '..', 'src', 'app', 'admin', 'page.tsx'), 'utf8');
check('后台 UpstreamPanel 面板', /function UpstreamPanel\(\)/.test(admin));
check('后台 tab 注册 upstream', /'upstream', t\('upstream'\)/.test(admin));
check('TTS 一键测试按钮', /api\/admin\/tts-test/.test(admin));
check('更新源保存', /update_config/.test(admin));
check('扩展代理保存', /ext_download_config/.test(admin));

// ---- 策略键 ----
const pd = readFileSync(join(__dirname, '..', 'src', 'lib', 'policy-defaults.ts'), 'utf8');
for (const k of ['NodeByteTtsEnabled', 'NodeByteTtsMaxChars', 'NodeByteUpdateCheckEnabled', 'NodeByteExtProxyDownload']) {
  check(`策略键 ${k} 默认值`, pd.includes(k));
}
const dr = readFileSync(join(__dirname, '..', 'src', 'lib', 'directive-registry.ts'), 'utf8');
for (const k of ['NodeByteTtsEnabled', 'NodeByteTtsMaxChars', 'NodeByteUpdateCheckEnabled', 'NodeByteExtProxyDownload']) {
  check(`指令注册表 ${k}`, dr.includes(k));
}

// ---- 客户端可塑性常量 ----
const consts = readFileSync(join(__dirname, '..', '..', 'client', 'src-nodebyte', 'chrome', 'browser', 'nodebyte', 'nodebyte_constants.h'), 'utf8');
check('可塑性 API 路径常量', consts.includes('kApiPathTranslate') && consts.includes('kApiPathTts') && consts.includes('kApiPathClientUpdate'));
check('可塑性注释（ApiBase 动态推导）', /ApiBase\(\)/.test(consts) && /NotifySyncServerChanged/.test(consts));

console.log(`\nupstream-selftest: ${ok} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
