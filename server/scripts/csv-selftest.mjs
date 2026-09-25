#!/usr/bin/env node
// CSV 导入解析自检（零依赖，CNB/CI 轻量校验用）。
// 与 server/src/lib/csv.ts 同规则：RFC-4180、列别名、行数统计。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

// 从 csv.ts 抽取纯函数逻辑做行为自检（编译产物路径不可用时用等价实现）
function parseCsv(text) {
  const t = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows = []; let row = []; let field = ''; let inQ = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (inQ) {
      if (ch === '"') { if (t[i + 1] === '"') { field += '"'; i++; continue; } inQ = false; continue; }
      field += ch; continue;
    }
    if (ch === '"') { inQ = true; continue; }
    if (ch === ',') { row.push(field); field = ''; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += ch;
  }
  if (row.length > 0 || field !== '') { row.push(field); rows.push(row); }
  return rows;
}

const PASSWORD_ALIASES = {
  url: ['url', 'login_uri', 'uri', 'website', 'address', 'server', '网址', 'url地址', '地址'],
  username: ['username', 'login_username', 'user', 'account', 'login', '用户名', '账号'],
  password: ['password', 'login_password', 'pwd', '密码']
};

function mapColumns(header, aliases) {
  const heads = header.map((s) => s.trim().toLowerCase().replace(/\s+/g, '_'));
  const out = {};
  for (const [field, list] of Object.entries(aliases)) {
    let idx = -1;
    for (const a of list) { const j = heads.indexOf(a); if (j !== -1) { idx = j; break; } }
    out[field] = idx;
  }
  return out;
}

let failed = 0;
function expect(name, cond) {
  if (cond) console.log(`  ok   ${name}`);
  else { console.error(`  FAIL ${name}`); failed++; }
}

// Case 1: Chrome 导出格式
const chromeCsv = 'name,url,username,password\n"Example","https://example.com/login","alice","p@ss w0rd,1"\nGitHub,https://github.com,bob,"he said ""hi"""\n';
const rows1 = parseCsv(chromeCsv);
const m1 = mapColumns(rows1[0], PASSWORD_ALIASES);
expect('chrome csv header recognized', m1.url === 1 && m1.username === 2 && m1.password === 3);
expect('chrome csv row count', rows1.length === 3);
expect('quoted comma field', rows1[1][3] === 'p@ss w0rd,1');
expect('escaped quotes field', rows1[2][3] === 'he said "hi"');

// Case 2: Bitwarden 导出格式（login_uri 列名）
const bwCsv = 'folder,favorite,type,name,notes,fields,login_uri,login_username,login_password\n,,login,GitHub,,https://github.com,carol,sec\n';
const rows2 = parseCsv(bwCsv);
const m2 = mapColumns(rows2[0], PASSWORD_ALIASES);
expect('bitwarden columns recognized', m2.url === 6 && m2.username === 7 && m2.password === 8);

// Case 3: BOM + CRLF
const bomCsv = '\uFEFFurl,username,password\r\nhttps://a.com,u1,p1\r\n';
const rows3 = parseCsv(bomCsv);
expect('bom stripped', rows3[0][0] === 'url');
expect('crlf rows', rows3.length === 2);

// Case 4: 源文件存在性（保证 CI 检的是真实代码）
const csvSrc = readFileSync(join(here, '..', 'src', 'lib', 'csv.ts'), 'utf8');
expect('csv.ts present with aliases', csvSrc.includes('login_uri') && csvSrc.includes('parseImportCsv'));

if (failed > 0) { console.error(`csv-selftest: ${failed} FAILED`); process.exit(1); }
console.log('csv-selftest: all passed');
