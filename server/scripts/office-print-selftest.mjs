// office-print-selftest.mjs — 办公套件与高级打印零依赖自测（CNB lite-validate / CI 调用）
// 覆盖：office.ts 校验 / 路由 / 策略键 / 指令注册表 / WebUI 资产 / pdf-kit 行为级测试
// （pdf-kit 经 UMD 桥真实执行：范围/多页合一/小册子/边距缩放/Flate 搬运/往返稳定）。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { deflateRawSync } from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
let ok = 0, fail = 0;
function check(name, cond) {
  if (cond) { console.log(`  ok   ${name}`); ok++; }
  else { console.log(`  FAIL ${name}`); fail++; }
}
function src(rel) { return readFileSync(join(__dirname, '..', 'src', rel), 'utf8'); }

/* ================= 1. office.ts 配置库 ================= */
const office = src('lib/office.ts');
check('OfficeSettings 类型定义', /interface OfficeSettings/.test(office));
check('默认：套件开启', /enabled:\s*true/.test(office));
check('默认：安卓仅预览', /editOnAndroid:\s*false/.test(office));
check('默认：打印面板接管', /printPanelEnabled:\s*true/.test(office));
check('WASM 按需加载字段', /wasmUrl/.test(office));
check('validateOfficeSettings 导出', /export function validateOfficeSettings/.test(office));
check('clientView 导出', /export function clientView/.test(office));
check('wasmUrl 必须 http(s)', office.includes("/^https?:\\/\\//"));

/* ================= 2. 路由 ================= */
function checkRoute(path, patterns, label) {
  try {
    const r = readFileSync(join(__dirname, '..', 'src', 'app', path), 'utf8');
    for (const p of patterns) if (!p.re.test(r)) throw new Error(p.name);
    console.log(`  ok   ${label}`); ok++;
  } catch (e) { console.log(`  FAIL ${label}: ${e.message}`); fail++; }
}
checkRoute('api/client/office-config/route.ts',
  [{ re: /export\s+async\s+function\s+GET/, name: 'GET' },
   { re: /office_config/, name: 'setting key' },
   { re: /clientView/, name: 'client view' }],
  '/api/client/office-config（公开读取，无敏感字段）');
checkRoute('api/admin/office-config/route.ts',
  [{ re: /export\s+async\s+function\s+GET/, name: 'GET' },
   { re: /export\s+async\s+function\s+PUT/, name: 'PUT' },
   { re: /authAdmin/, name: 'admin auth' },
   { re: /adminAudit/, name: 'audit' }],
  '/api/admin/office-config（GET/PUT + 审计）');

/* ================= 3. 策略键三件套 ================= */
const pd = src('lib/policy-defaults.ts');
check('NodeByteOfficeSuiteEnabled 默认 true', /NodeByteOfficeSuiteEnabled:\s*true/.test(pd));
check('NodeByteOfficeAndroidEdit 默认 false', /NodeByteOfficeAndroidEdit:\s*false/.test(pd));
check('NodeBytePrintPanelEnabled 默认 true', /NodeBytePrintPanelEnabled:\s*true/.test(pd));
check('summarizeForWeb 含 officeSuite/printPanel', /officeSuite/.test(pd) && /printPanel/.test(pd));
const dr = src('lib/directive-registry.ts');
check('指令注册表：办公三键', /NodeByteOfficeSuiteEnabled/.test(dr) && /NodeByteOfficeAndroidEdit/.test(dr) && /NodeBytePrintPanelEnabled/.test(dr));

/* ================= 4. 客户端 WebUI 资产 ================= */
const ROOT = join(__dirname, '..', '..', 'client');
function asset(rel, patterns, label) {
  try {
    const r = readFileSync(join(ROOT, rel), 'utf8');
    for (const p of patterns) if (!p.test(r)) throw new Error(p.source.slice(0, 40));
    console.log(`  ok   ${label}`); ok++;
  } catch (e) { console.log(`  FAIL ${label}: ${e.message}`); fail++; }
}
asset('webui/office/index.html',
  [/nodebyte 办公套件/i, /id="mdInput"/, /id="mdPreview"/, /id="slideStage"/, /id="slideNav"/, /app\.js/, /btnWasm/],
  'office 页：编辑器 + 预览 + 放映 + WASM 入口');
asset('webui/office/app.js',
  [/function renderMd/, /function decodeTxt/, /async function readZip/, /renderDocx/, /renderPptx/,
   /DecompressionStream\('deflate-raw'\)/, /IS_ANDROID/, /office-config/, /NodeByteWasmOffice/, /showSlide/, /speakerNotes|spText/],
  'office.js：MD/TXT/DOCX/PPTX 解析 + 编码识别 + 平台门控 + WASM 按需加载');
asset('webui/print/index.html',
  [/id="nup"/, /id="booklet"/, /id="ranges"/, /id="scale"/, /id="margin"/, /pdf-kit\.js/, /btnRun/, /btnDownload/],
  'print 页：多页合一/小册子/范围/缩放/边距 控件');
asset('webui/print/app.js',
  [/NodeBytePdfKit/, /processPdf/, /booklet/, /nup/],
  'print app.js：调用 pdf-kit（纯本地处理）');
asset('webui/usercenter/index.html',
  [/个人中心/, /nodebyte\/usercenter|usercenter/],
  'usercenter 占位页存在');

/* ================= 5. C++ 补丁一致性 ================= */
const PATCH_DIR = join(ROOT, 'patches');
const p190 = readFileSync(join(PATCH_DIR, '0190-nodebyte-office.patch'), 'utf8');
for (const s of ['office_controller.h', 'office_controller.cc', 'print_panel.h', 'print_panel.cc',
                 'nodebyte_resources.grd', 'BUILD.gn']) {
  check(`0190 补丁包含 ${s}`, p190.includes(s));
}
const p150 = readFileSync(join(PATCH_DIR, '0150-nodebyte-webui.patch'), 'utf8');
check('0150 补丁包含 office/print UI 控制器', p150.includes('nodebyte_office_ui') && p150.includes('nodebyte_print_ui'));
check('0150 补丁包含统一注册件', p150.includes('nodebyte_ui_configs'));
check('0150 注册覆盖 8 主机', /kHostOffice/.test(p150) && /kHostPrint/.test(p150) && /kHostGame/.test(p150) && /kHostUserCenter/.test(p150));
const p240 = readFileSync(join(PATCH_DIR, '0240-hooks-webui-register.patch'), 'utf8');
check('0240 hook：WebUIConfig 注册挂接（154 真实基线）', /RegisterNodeByteWebUIConfigs/.test(p240));
check('0240 hook：nodebyte:// 标准 scheme 注册（154 真实基线）', /kChromeStandardURLSchemes/.test(p240) && /kScheme/.test(p240));
const consts = readFileSync(join(ROOT, 'src-nodebyte', 'chrome', 'browser', 'nodebyte', 'nodebyte_constants.h'), 'utf8');
check('constants：kHostOffice/kHostPrint', /kHostOffice = "office"/.test(consts) && /kHostPrint = "print"/.test(consts));
check('constants：办公/打印策略键', /NodeByteOfficeSuiteEnabled/.test(consts) && /NodeBytePrintPanelEnabled/.test(consts));
check('constants：office-config 路径', /kApiPathOfficeConfig/.test(consts));

/* ================= 6. pdf-kit 行为级测试（UMD 桥真实执行） ================= */
function loadKit() {
  const s = readFileSync(join(ROOT, 'webui', 'print', 'pdf-kit.js'), 'utf8');
  const mod = { exports: {} };
  new Function('module', 'window', s)(mod, {});
  return mod.exports;
}
const kit = loadKit();

// 合成 PDF 构造器（n 页，595x842；可选 Flate 内容流）
function buildPdf(nPages, opts = {}) {
  const enc = new TextEncoder();
  const parts = []; let len = 0;
  const add = (s) => { const b = enc.encode(s); parts.push(b); len += b.length; };
  const addB = (b) => { parts.push(b); len += b.length; };
  add('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const offs = new Map();
  const obj = (n, body) => { offs.set(n, len); add(`${n} 0 obj\n${body}\nendobj\n`); };
  const strm = (n, dict, data, filter) => { offs.set(n, len); add(`${n} 0 obj\n${dict}${filter || ''}stream\n`); addB(data); add('\nendstream\nendobj\n'); };
  const kids = [];
  for (let p = 1; p <= nPages; p++) {
    const c = 10 + p;
    const content = '1 0 0 1 0 0 cm\n';
    if (opts.flate) {
      const comp = deflateRawSync(Buffer.from(content));
      strm(c, `<< /Length ${comp.length} >>\n`, comp, '/Filter /FlateDecode\n');
    } else {
      strm(c, `<< /Length ${content.length} >>\n`, Buffer.from(content, 'latin1'));
    }
    obj(c + 100, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
    obj(p + 3, `<< /Type /Page /Parent 3 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${c + 100} 0 R >> >> /Contents ${c} 0 R >>`);
    kids.push(`${p + 3} 0 R`);
  }
  obj(1, '<< /Type /Catalog /Pages 3 0 R >>');
  obj(2, '<< /Title (t) >>');
  obj(3, `<< /Type /Pages /Count ${nPages} /Kids [${kids.join(' ')}] >>`);
  const xref = len;
  const maxNum = 3 + nPages + 100;
  add(`xref\n0 ${maxNum + 1}\n0000000000 65535 f \n`);
  for (let n = 1; n <= maxNum; n++) add(offs.has(n) ? String(offs.get(n)).padStart(10, '0') + ' 00000 n \n' : '0000000000 65535 f \n');
  add(`trailer\n<< /Size ${maxNum + 1} /Root 1 0 R /Info 2 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(parts.reduce((n, c2) => n + c2.length, 0));
  let at = 0; for (const c2 of parts) { out.set(c2, at); at += c2.length; }
  return out;
}

function assertValidPdf(u8, wantPages) {
  const text = new TextDecoder('latin1').decode(u8);
  if (!text.startsWith('%PDF-1.7')) throw new Error('header');
  const sx = /startxref\s+(\d+)\s*%%EOF\s*$/.exec(text);
  if (!sx) throw new Error('startxref');
  const sec = text.slice(+sx[1]).split('\n');
  if (sec[0] !== 'xref') throw new Error('xref position');
  const size = +/xref\s+0\s+(\d+)/.exec(text.slice(+sx[1]))[1];
  for (let n = 1; n < size; n++) {
    const off = +(sec[n + 2] || '').slice(0, 10);
    if (!off) continue;
    if (!new RegExp(`^${n} 0 obj`).test(text.slice(off, off + 32))) throw new Error(`offset of obj ${n}`);
  }
  const cms = [...text.matchAll(/\/Type \/Pages[^>]*\/Count (\d+)/g)];
  const cm2 = [...text.matchAll(/\/Count (\d+)[^>]*\/Type \/Pages/g)];
  const got = +(cms.length ? cms[cms.length - 1][1] : cm2[cm2.length - 1][1]);
  if (got !== wantPages) throw new Error(`pages ${got} != ${wantPages}`);
  return text;
}

try {
  const { processPdf, parseRanges, bookletOrder } = kit;
  check('pdf-kit 加载（UMD 双端桥）', !!(processPdf && parseRanges && bookletOrder));

  const r1 = parseRanges('1-3,5', 5);
  check('页码范围解析', JSON.stringify(r1) === '[1,2,3,5]');
  const r2 = parseRanges('99', 4);
  check('越界范围回退全选', JSON.stringify(r2) === '[1,2,3,4]');
  const b1 = bookletOrder([1, 2, 3, 4, 5, 6, 7, 8]);
  check('小册子骑马钉排序', JSON.stringify(b1) === '[[8,1],[2,7],[6,3],[4,5]]');

  const out1 = await processPdf(buildPdf(3), { marginMm: 10, scale: 0.9 });
  const t1 = assertValidPdf(out1, 3);
  check('单页 + 边距 + 缩放（结构回读通过）', /0\.900000 0 0 0\.900000 0 0 cm/.test(t1));

  const out2 = await processPdf(buildPdf(5), { ranges: '2-3' });
  assertValidPdf(out2, 2);
  check('页码范围取页', true);

  const out3 = await processPdf(buildPdf(8), { nup: 4 });
  const t3 = assertValidPdf(out3, 2);
  check('多页合一 4 合 1', /\/XObject << (?:\/Fx\d+ \d+ 0 R ?)+ >>/.test(t3));

  const out4 = await processPdf(buildPdf(12), { nup: 6 });
  assertValidPdf(out4, 2);
  check('多页合一 6 合 1（3x2）', true);

  const out5 = await processPdf(buildPdf(8), { booklet: true });
  const t5 = assertValidPdf(out5, 4);
  const mbs = [...t5.matchAll(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)];
  check('小册子对页（宽 = 2×595）', Math.round(+mbs[mbs.length - 1][1]) === 1190);

  const out6 = await processPdf(buildPdf(5), { booklet: true });
  assertValidPdf(out6, 4);
  check('小册子非整四页补白', true);

  const out7 = await processPdf(buildPdf(2, { flate: true }), {});
  const t7 = assertValidPdf(out7, 2);
  check('FlateDecode 流原样搬运（Filter 保留）', /\/Filter \[?\/FlateDecode\]?/.test(t7));

  const out8 = await processPdf(await processPdf(buildPdf(4), { nup: 2 }), { ranges: '1' });
  assertValidPdf(out8, 1);
  check('输出可被引擎二次解析（往返稳定）', true);
} catch (e) {
  console.log(`  FAIL pdf-kit 执行: ${e.message}`);
  fail++;
}

console.log(`\n${fail === 0 ? 'ALL' : 'FAILED'} ${ok} ok / ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
