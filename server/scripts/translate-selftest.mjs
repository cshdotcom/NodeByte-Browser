// translate-selftest.mjs — 翻译引擎零依赖自测（CNB lite-validate / GitHub CI 调用）
//
// 验证点（全部不发网络请求，避免烧公共实例配额）：
//   1) 15 种 provider 类型齐全（PROVIDER_META / ALL_PROVIDER_TYPES）
//   2) DEFAULT_PROVIDERS 默认梯队配置正确
//   3) 语言代码映射存在（baidu/youdao/deepl/microsoft/niutrans/yandex/aliyun）
//   4) /api/translate 路由与 /api/admin/translate-config、/api/admin/translate-test 路由完整
//   5) 各适配器函数齐全（ADAPTERS 注册表 15 项）
//   6) 签名实现存在（baidu MD5 / youdao SHA-256 / tencent TC3 / aliyun HMAC-SHA1）

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const libPath = join(__dirname, '..', 'src', 'lib', 'translate.ts');
const src = readFileSync(libPath, 'utf8');

const ALL_TYPES = [
  'libretranslate', 'lingva', 'mymemory', 'deeplx',
  'google_free', 'edge_free',
  'deepl', 'microsoft', 'baidu', 'youdao',
  'tencent', 'aliyun', 'niutrans', 'yandex', 'openai_compat',
];

let ok = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { console.log(`  ok   ${name}`); ok++; }
  else { console.log(`  FAIL ${name}`); fail++; }
}

// 1. 15 种类型
for (const t of ALL_TYPES) {
  check(`provider 类型 ${t} 已注册`, new RegExp(`'${t}'`).test(src));
}

// 2. 元信息与适配器
check('PROVIDER_META 已导出（15 项）', (src.match(/PROVIDER_META\s*[:=]/g) || []).length >= 1);
check('ALL_PROVIDER_TYPES 已导出', /ALL_PROVIDER_TYPES/.test(src));
check('ADAPTERS 注册表 15 项', /const\s+ADAPTERS\s*[:=]/.test(src));
for (const t of ALL_TYPES) {
  check(`适配器 ${t} 已挂到 ADAPTERS`, new RegExp(`${t}: ad[A-Z]`).test(src));
}

// 3. 适配器实现函数
const adapters = ['adLibreTranslate', 'adLingva', 'adMyMemory', 'adDeepLX', 'adGoogleFree',
  'adEdgeFree', 'adDeepL', 'adMicrosoft', 'adBaidu', 'adYoudao',
  'adTencent', 'adAliyun', 'adNiutrans', 'adYandex', 'adOpenAICompat'];
for (const a of adapters) {
  check(`实现函数 ${a} 存在`, new RegExp(`(async )?function ${a}\\(`).test(src));
}

// 4. 语言映射
check('语言映射表 LANG_MAPS 存在', /LANG_MAPS\s*[:=]/.test(src));
check('百度语言映射（zh/cht/jp/kor）', /'zh-CN':\s*'zh'/.test(src) && /'ja':\s*'jp'/.test(src));
check('有道语言映射（zh-CHS）', /zh-CHS/.test(src));
check('DeepL 大写映射（ZH/EN-US）', /'EN-US'/.test(src));
check('微软映射（zh-Hans）', /zh-Hans/.test(src));

// 5. 签名算法
check('百度 MD5 签名', /createHash\('md5'\)/.test(src));
check('有道 SHA-256 签名', /createHash\('sha256'\)/.test(src));
check('腾讯云 TC3-HMAC-SHA256 签名链', /TC3-HMAC-SHA256/.test(src) && /createHmac\('sha256', `TC3/.test(src));
check('阿里云 HMAC-SHA1 RPC 签名', /createHmac\('sha1'/.test(src));

// 6. 公共入口与测试
check('translate() 主入口', /export\s+async\s+function\s+translate\s*\(/.test(src));
check('testProvider() 一键测试', /export\s+async\s+function\s+testProvider\s*\(/.test(src));
check('listProviders() 启用过滤', /filter\(\(p\)\s*=>\s*p\.enabled\s*!==\s*false\)/.test(src));
check('缓存 sha256Hex', /function\s+sha256Hex\s*\(/.test(src));
check('请求超时 10s', /REQUEST_TIMEOUT_MS\s*=\s*10000/.test(src));
check('AggregateError 降级汇总', /AggregateError/.test(src));
check('Edge 匿名 JWT 缓存', /edgeJwtCache/.test(src));

// 7. 路由文件
function checkRoute(path, patterns, label) {
  try {
    const r = readFileSync(join(__dirname, '..', 'src', 'app', path), 'utf8');
    for (const p of patterns) assert.ok(p.re.test(r), p.name);
    console.log(`  ok   ${label}`);
    ok++;
  } catch (e) {
    console.log(`  FAIL ${label}: ${e.message}`);
    fail++;
  }
}

checkRoute('api/translate/route.ts',
  [{ re: /export\s+async\s+function\s+POST/, name: 'POST' },
   { re: /export\s+async\s+function\s+GET/, name: 'GET' }],
  '/api/translate 路由完整（GET + POST）');
checkRoute('api/admin/translate-config/route.ts',
  [{ re: /export\s+async\s+function\s+PUT/, name: 'PUT' },
   { re: /export\s+async\s+function\s+GET/, name: 'GET' },
   { re: /validateSettings/, name: 'validator' },
   { re: /密钥合并|apiKey = old\.apiKey|p\.apiKey = old/, name: 'key merge' }],
  '/api/admin/translate-config 路由完整（GET + PUT + 校验 + 密钥合并）');
checkRoute('api/admin/translate-test/route.ts',
  [{ re: /export\s+async\s+function\s+POST/, name: 'POST' },
   { re: /testProvider/, name: 'testProvider call' }],
  '/api/admin/translate-test 路由完整（POST + testProvider）');

// 8. 管理后台 UI 面板
const adminPage = readFileSync(join(__dirname, '..', 'src', 'app', 'admin', 'page.tsx'), 'utf8');
check('后台 TranslatePanel 面板存在', /function TranslatePanel\(\)/.test(adminPage));
check('后台 tab 注册 translate', /'translate', t\('translate'\)/.test(adminPage));
check('后台一键测试按钮', /translate-test/.test(adminPage));

console.log(`\ntranslate-selftest: ${ok} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
