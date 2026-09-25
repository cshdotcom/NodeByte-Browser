/**
 * 零依赖 CSV 解析与列映射（数据批量导入体系）。
 *
 * 支持格式（docs/data-import.md 有完整说明）：
 *  - 密码 passwords：Chrome/Edge 导出（name,url,username,password）、
 *    Firefox 导出（url,username,password,...）、Bitwarden 导出（login_uri,login_username,login_password）
 *  - 书签 bookmarks：title,url,folder(支持 / 分层),date_added —— 兼容任意带表头的 CSV
 *  - 历史 history  ：url,title,last_visit_time,visit_count
 *
 * 解析规则：RFC-4180（引号转义 ""、字段内逗号/换行）、BOM 容错、CRLF/LF 统一。
 */

export type ImportType = 'passwords' | 'bookmarks' | 'history';

export const IMPORT_TYPES: ImportType[] = ['passwords', 'bookmarks', 'history'];

export const MAX_CSV_BYTES = 20 * 1024 * 1024; // 20MB
export const MAX_ROWS = 100_000;

/** 各类型列别名（表头匹配，小写化去空白后精确匹配，兼容中英文导出） */
const COLUMN_ALIASES: Record<ImportType, Record<string, string[]>> = {
  passwords: {
    url: ['url', 'login_uri', 'uri', 'website', 'web_site', 'address', 'server', 'origin', '网址', '网站', 'url地址', '地址'],
    username: ['username', 'login_username', 'user', 'user_name', 'account', 'login', 'email', '用户名', '账号', '帐号', '登录名'],
    password: ['password', 'login_password', 'pass', 'passwd', 'pwd', '密码', '口令'],
    name: ['name', 'title', 'hostname', 'origin_name', 'site', 'label', '名称', '标题', '备注']
  },
  bookmarks: {
    title: ['title', 'name', 'bookmark', 'label', '标题', '名称'],
    url: ['url', 'link', 'uri', 'href', '网址', '链接', 'url地址'],
    folder: ['folder', 'path', 'category', 'group', 'dir', 'directory', 'bookmark_folder', '文件夹', '目录', '分类', '路径'],
    date_added: ['date_added', 'date', 'created', 'created_at', 'add_time', 'added', '添加时间', '创建时间', '时间']
  },
  history: {
    url: ['url', 'link', 'uri', '网址', '链接'],
    title: ['title', 'name', '标题', '名称', '页面标题'],
    visited_at: ['last_visit_time', 'visited_at', 'visit_time', 'last_visited', 'date', 'time', '访问时间', '最后访问时间', '时间'],
    visit_count: ['visit_count', 'count', 'visits', '次数', '访问次数', '访问次数']
  }
};

export type MappedColumns = { url: number; username: number; password: number; name: number };
export type MappedBookmarkCols = { title: number; url: number; folder: number; date_added: number };
export type MappedHistoryCols = { url: number; title: number; visited_at: number; visit_count: number };

export type ParsedRow =
  | { kind: 'password'; origin: string; name: string; url: string; username: string; password: string }
  | { kind: 'bookmark'; title: string; url: string; folder: string; dateAdded: Date | null }
  | { kind: 'history'; url: string; title: string; visitedAt: Date | null; visitCount: number };

export type ParseResult = {
  type: ImportType;
  totalRows: number;
  validRows: number;
  warnings: string[];
  mapping: Record<string, number>; // 字段 → 列索引（-1 = 未找到）
  preview: ParsedRow[];            // 前 10 条有效行
  rows: ParsedRow[];               // 全部有效行（调用方负责限制大小）
};

// ---------------------------------------------------------------- 基础解析

/** RFC-4180 CSV → 二维数组；自动去 BOM，容忍 CRLF/LF */
export function parseCsv(text: string): string[][] {
  const t = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  while (i < t.length) {
    const ch = t[i];
    if (inQuotes) {
      if (ch === '"') {
        if (t[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === ',') { row.push(field); field = ''; i++; continue; }
    if (ch === '\r') { i++; continue; }
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += ch; i++;
  }
  // 收尾：最后一行（即使为空行也只在 row 非空或 field 非空时收录）
  if (row.length > 0 || field !== '') { row.push(field); rows.push(row); }
  return rows;
}

function normHeader(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, '_');
}

/** 按别名表定位各字段的列索引；找不到返回 -1 */
export function mapColumns(type: ImportType, header: string[]): Record<string, number> {
  const heads = header.map(normHeader);
  const out: Record<string, number> = {};
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES[type])) {
    let idx = -1;
    for (const a of aliases) {
      const j = heads.indexOf(a);
      if (j !== -1) { idx = j; break; }
    }
    out[field] = idx;
  }
  return out;
}

function safeDate(s: string): Date | null {
  const v = s.trim();
  if (!v) return null;
  // 纯数字：Chrome/WebKit epoch（微秒）或 Unix 秒
  if (/^\d{10,}$/.test(v)) {
    const n = Number(v);
    if (n > 1e14) return new Date(n / 1000);      // 微秒
    if (n > 1e9) return new Date(n * 1000);       // 秒
  }
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isProbablyUrl(s: string): boolean {
  const v = s.trim();
  if (!v) return false;
  return /^(https?|ftp|chrome|file):\/\//i.test(v) || /^[\w-]+(\.[\w-]+)+(\/|$|:\d)/.test(v);
}

/** 解析整个 CSV 为结构化行 */
export function parseImportCsv(type: ImportType, csvText: string): ParseResult {
  const all = parseCsv(csvText);
  const warnings: string[] = [];
  if (all.length === 0) return { type, totalRows: 0, validRows: 0, warnings: ['CSV 为空'], mapping: {}, preview: [], rows: [] };

  const header = all[0];
  const mapping = mapColumns(type, header);
  const body = all.slice(1).filter((r) => r.some((c) => c.trim() !== ''));
  const totalRows = body.length;
  if (totalRows > MAX_ROWS) warnings.push(`行数 ${totalRows} 超过上限 ${MAX_ROWS}，已截断`);
  const rowsRaw = body.slice(0, MAX_ROWS);

  const missing = Object.entries(mapping).filter(([, idx]) => idx === -1).map(([f]) => f);
  const rows: ParsedRow[] = [];

  if (type === 'passwords') {
    const m = mapping as unknown as { url: number; username: number; password: number; name: number };
    if (m.url === -1 || m.username === -1 || m.password === -1) {
      return { type, totalRows, validRows: 0, warnings: [`缺少必要列（需要 url/username/password，未识别: ${missing.join(', ')}）`], mapping, preview: [], rows: [] };
    }
    for (let i = 0; i < rowsRaw.length; i++) {
      const r = rowsRaw[i];
      const url = (r[m.url] ?? '').trim();
      const username = (r[m.username] ?? '').trim();
      const password = (r[m.password] ?? '').trim();
      if (!url && !username && !password) continue;
      if (!isProbablyUrl(url)) warnings.push(`第 ${i + 2} 行：URL 无法识别「${url.slice(0, 40)}」已按原文保留`);
      rows.push({ kind: 'password', origin: (r[m.name] ?? '').trim() || hostnameOf(url), name: (r[m.name] ?? '').trim(), url, username, password });
    }
  } else if (type === 'bookmarks') {
    const m = mapping as unknown as { title: number; url: number; folder: number; date_added: number };
    if (m.url === -1) {
      return { type, totalRows, validRows: 0, warnings: ['缺少必要列 url（未识别）'], mapping, preview: [], rows: [] };
    }
    for (let i = 0; i < rowsRaw.length; i++) {
      const r = rowsRaw[i];
      const url = (r[m.url] ?? '').trim();
      if (!url) { warnings.push(`第 ${i + 2} 行：URL 为空，跳过`); continue; }
      rows.push({
        kind: 'bookmark',
        title: (r[m.title] ?? '').trim() || url,
        url,
        folder: ((r[m.folder] ?? '') as string).trim().replace(/[\\/]+/g, '/').replace(/^\/|\/$/g, ''),
        dateAdded: m.date_added === -1 ? null : safeDate(r[m.date_added] ?? '')
      });
    }
  } else {
    const m = mapping as unknown as { url: number; title: number; visited_at: number; visit_count: number };
    if (m.url === -1) {
      return { type, totalRows, validRows: 0, warnings: ['缺少必要列 url（未识别）'], mapping, preview: [], rows: [] };
    }
    for (let i = 0; i < rowsRaw.length; i++) {
      const r = rowsRaw[i];
      const url = (r[m.url] ?? '').trim();
      if (!url) { warnings.push(`第 ${i + 2} 行：URL 为空，跳过`); continue; }
      const cnt = Number((r[m.visit_count] ?? '1').trim());
      rows.push({
        kind: 'history',
        url,
        title: (r[m.title] ?? '').trim() || url,
        visitedAt: m.visited_at === -1 ? null : safeDate(r[m.visited_at] ?? ''),
        visitCount: Number.isFinite(cnt) && cnt > 0 ? Math.floor(cnt) : 1
      });
    }
  }

  return {
    type,
    totalRows,
    validRows: rows.length,
    warnings: warnings.slice(0, 50),
    mapping,
    preview: rows.slice(0, 10),
    rows
  };
}

function hostnameOf(url: string): string {
  try {
    return new URL(url.includes('://') ? url : `https://${url}`).hostname;
  } catch {
    return url.slice(0, 60);
  }
}

/** 类型中文名（UI/审计/日志共用） */
export function typeLabel(t: ImportType): string {
  return t === 'passwords' ? '密码' : t === 'bookmarks' ? '书签' : '历史记录';
}
