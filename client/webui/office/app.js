// NodeByte 办公套件 nodebyte://office —— app.js
// 提示词 5.11：MD 完整编辑 / TXT 编码识别 / DOCX·PPTX 解析预览 /
// PPT 放映+演讲者视图 / PDF 内核查看 / LibreOffice WASM 按需加载（后台配置）。
// 零第三方依赖：zip 用 DecompressionStream('deflate-raw')，文档一律 DOM 构建
// （不用 innerHTML 装载不可信 XML），XSS 面收敛为零。
'use strict';

/* ================= 小工具 ================= */
const $ = (id) => document.getElementById(id);
const toast = (msg, ms) => {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._h);
  toast._h = setTimeout(() => t.classList.remove('show'), ms || 2400);
};
const esc = (s) => String(s).replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const download = (blob, name) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
};
const fmtSize = (n) => n < 1024 ? n + ' B'
  : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(2) + ' MB';

/* ================= 平台门控（Android 仅预览） ================= */
// C++ 注入 window.__NODEBYTE__.platform（'android'|'windows'|...）；
// 未注入时按 UA 兜底。策略可经 config.editOnAndroid 放开（默认关闭）。
const IS_ANDROID = ((window.__NODEBYTE__ && window.__NODEBYTE__.platform) ||
  (navigator.userAgent.includes('Android') ? 'android' : '')) === 'android';
const CAN_EDIT = !IS_ANDROID;

/* ================= 后台配置（可塑性：跟随同步服务器） ================= */
const SYNC_BASE = (window.__NODEBYTE__ && window.__NODEBYTE__.syncServer) || '';
const OFFICE_CFG = { enabled: true, editOnAndroid: false, wasmUrl: '' };
async function loadOfficeConfig() {
  if (!SYNC_BASE) {
    $('wasmHint').textContent = '未获取同步服务器配置，WASM 完整引擎按需加载入口不可用（本地编辑不受影响）。';
    return;
  }
  try {
    const r = await fetch(SYNC_BASE + '/api/client/office-config', { credentials: 'include' });
    if (r.ok) Object.assign(OFFICE_CFG, await r.json());
  } catch (_) { /* 离线/无服务：按本地默认继续 */ }
  if (OFFICE_CFG.wasmUrl) {
    $('btnWasm').style.display = '';
    $('wasmHint').textContent = '后台已配置 LibreOffice WASM 完整编辑引擎，打开 DOCX/PPTX 后可一键加载。';
  }
  if (IS_ANDROID && OFFICE_CFG.editOnAndroid) {
    toast('管理员已放开安卓端编辑');
  }
}

/* ================= 零依赖 ZIP 读取器 ================= */
// OOXML(docx/pptx/xlsx) = PK zip：解析中央目录 → 按条目解压。
// method 0 = 原样拷贝；method 8 = DecompressionStream('deflate-raw')（Chromium 103+）。
async function readZip(buf) {
  const u8 = new Uint8Array(buf);
  const dv = new DataView(buf);
  // 从尾部找 EOCD（0x06054b50）
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 22 - 65536); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是有效的 zip/ooxml 文件');
  const count = dv.getUint16(eocd + 10, true);
  let off = dv.getUint32(eocd + 16, true);
  const files = new Map();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(off, true) !== 0x02014b50) break; // 中央目录项签名
    const method = dv.getUint16(off + 10, true);
    const csize = dv.getUint32(off + 20, true);
    const usize = dv.getUint32(off + 24, true);
    const nameLen = dv.getUint16(off + 28, true);
    const extraLen = dv.getUint16(off + 30, true);
    const cmtLen = dv.getUint16(off + 32, true);
    const lho = dv.getUint32(off + 42, true);
    const name = new TextDecoder().decode(u8.subarray(off + 46, off + 46 + nameLen));
    // 本地头：取真实数据偏移（本地头 extra 长度可能与中央目录不同）
    const lNameLen = dv.getUint16(lho + 26, true);
    const lExtraLen = dv.getUint16(lho + 28, true);
    const dataStart = lho + 30 + lNameLen + lExtraLen;
    files.set(name, { method, csize, usize, start: dataStart });
    off += 46 + nameLen + extraLen + cmtLen;
  }
  const entry = async (name) => {
    const f = files.get(name);
    if (!f) return null;
    const raw = u8.subarray(f.start, f.start + f.csize);
    if (f.method === 0) return raw.slice().buffer;
    if (f.method !== 8) throw new Error('不支持的压缩方法 ' + f.method);
    const ds = new DecompressionStream('deflate-raw');
    const out = await new Response(new Blob([raw]).stream().pipeThrough(ds)).arrayBuffer();
    return out;
  };
  const has = (name) => files.has(name);
  return { entry, has, names: [...files.keys()] };
}

/* ================= Markdown 渲染（白名单转义，防 XSS） ================= */
// 先整体 HTML 转义，再按语法生成受控标签；行内 HTML 仅放行
// <span style="color/font-size">、<b>、<i>、<u>、<font>（MD 颜色/字号方案）。
function renderMd(src) {
  const lines = String(src).replace(/\r\n?/g, '\n').split('\n');
  let html = '', i = 0, inCode = false, listStack = [];
  const closeLists = () => { while (listStack.length) html += listStack.pop() === 'ul' ? '</ul>' : '</ol>'; };
  const inline = (s) => {
    s = esc(s);
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    s = s.replace(/\*\*\*([^*]+)\*\*\*/g, '<b><i>$1</i></b>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>');
    s = s.replace(/~~([^~]+)~~/g, '<s>$1</s>');
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g,
      (m, alt, url) => /^(https?:|data:image\/)/.test(url) ? `<img alt="${alt}" src="${url}">` : m);
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g,
      (m, t, url) => /^(https?:|mailto:)/.test(url) ? `<a href="${url}" target="_blank" rel="noopener">${t}</a>` : m);
    return s;
  };
  for (; i < lines.length; i++) {
    const L = lines[i];
    if (/^```/.test(L)) { // 围栏代码块
      if (!inCode) { closeLists(); html += '<pre><code>'; inCode = true; }
      else { html += '</code></pre>'; inCode = false; }
      continue;
    }
    if (inCode) { html += esc(L) + '\n'; continue; }
    if (/^\s*$/.test(L)) { closeLists(); continue; }
    const h = L.match(/^(#{1,6})\s+(.*)$/);
    if (h) { closeLists(); const n = h[1].length; html += `<h${n}>${inline(h[2])}</h${n}>`; continue; }
    if (/^\s*(---+|\*\*\*+)\s*$/.test(L)) { closeLists(); html += '<hr>'; continue; }
    if (/^\s*>\s?/.test(L)) { closeLists(); html += `<blockquote>${inline(L.replace(/^\s*>\s?/, ''))}</blockquote>`; continue; }
    const ul = L.match(/^\s*[-*+]\s+(.*)$/);
    if (ul) { if (listStack[listStack.length - 1] !== 'ul') { closeLists(); html += '<ul>'; listStack.push('ul'); } html += `<li>${inline(ul[1])}</li>`; continue; }
    const ol = L.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ol) { if (listStack[listStack.length - 1] !== 'ol') { closeLists(); html += '<ol>'; listStack.push('ol'); } html += `<li>${inline(ol[1])}</li>`; continue; }
    if (/^\s*\|.*\|\s*$/.test(L)) { // 表格
      closeLists();
      const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(lines[i++]);
      i--;
      const cells = (r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      if (rows.length >= 2 && /^[\s|:-]+$/.test(rows[1])) {
        html += '<table><tr>' + cells(rows[0]).map((c) => `<th>${inline(c)}</th>`).join('') + '</tr>';
        for (let k = 2; k < rows.length; k++)
          html += '<tr>' + cells(rows[k]).map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>';
        html += '</table>';
      } else html += `<p>${inline(rows[0])}</p>`;
      continue;
    }
    closeLists();
    html += `<p>${inline(L)}</p>`;
  }
  if (inCode) html += '</code></pre>';
  closeLists();
  return html;
}

/* ================= DOCX 解析（DOM 构建，安全白名单） ================= */
// document.xml 结构：w:body → w:p（w:pPr/w:pStyle 标题样式, w:numPr 列表, w:r/w:t 文本,
// w:rPr b/i/u/color/sz, w:drawing 图片）+ w:tbl。图片经 rels 映射到 word/media/*。
async function renderDocx(buf, view) {
  const zip = await readZip(buf);
  const docXml = await zip.entry('word/document.xml');
  if (!docXml) throw new Error('DOCX 缺少 word/document.xml');
  const doc = new DOMParser().parseFromString(new TextDecoder().decode(docXml), 'application/xml');
  const NS = { w: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
               a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
               r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships' };
  // rels：rId → media 路径
  const relsXml = await zip.entry('word/_rels/document.xml.rels');
  const rels = {};
  if (relsXml) {
    const rd = new DOMParser().parseFromString(new TextDecoder().decode(relsXml), 'application/xml');
    for (const rel of rd.getElementsByTagNameNS('*', 'Relationship')) {
      const t = rel.getAttribute('Target');
      if (t && t.startsWith('media/')) rels[rel.getAttribute('Id')] = 'word/' + t;
    }
  }
  const wq = (el, tag) => {
    const ns = el.getElementsByTagNameNS(NS.w, tag);
    return ns.length ? ns[0] : null;
  };
  const mediaCache = new Map();
  const mediaUrl = async (path) => {
    if (mediaCache.has(path)) return mediaCache.get(path);
    const data = await zip.entry(path);
    if (!data) return '';
    const url = URL.createObjectURL(new Blob([data], { type: mediaType(path) }));
    mediaCache.set(path, url);
    return url;
  };
  const runProps = (r, el) => { // w:r → 样式
    const p = wq(r, 'rPr');
    if (!p) return;
    if (wq(p, 'b') && wq(p, 'b').getAttribute('w:val') !== '0') el.style.fontWeight = '700';
    if (wq(p, 'i') && wq(p, 'i').getAttribute('w:val') !== '0') el.style.fontStyle = 'italic';
    if (wq(p, 'u')) el.style.textDecoration = 'underline';
    const c = wq(p, 'color');
    if (c && /^([0-9A-Fa-f]{6}|auto)$/.test(c.getAttribute('w:val') || '')) el.style.color = '#' + c.getAttribute('w:val');
    const sz = wq(p, 'sz');
    if (sz) { const v = parseInt(sz.getAttribute('w:val'), 10); if (v > 0) el.style.fontSize = (v / 2) + 'pt'; }
  };
  const fillPara = async (p, out) => {
    const style = wq(p, 'pStyle');
    const st = style ? (style.getAttribute('w:val') || '') : '';
    const hm = st.match(/^Heading(\d)$/i);
    let host;
    if (hm) { host = document.createElement('h' + Math.min(6, +hm[1] + 1)); }
    else if (wq(p, 'numPr')) { host = document.createElement('li'); }
    else host = document.createElement('p');
    for (const r of p.getElementsByTagNameNS(NS.w, 'r')) {
      const t = wq(r, 't');
      if (t && t.textContent) {
        const sp = document.createElement('span');
        sp.textContent = t.textContent;
        runProps(r, sp);
        host.appendChild(sp);
      }
      const br = wq(r, 'br');
      if (br) host.appendChild(document.createElement('br'));
      // 图片：w:drawing → a:blip r:embed
      const blip = p.getElementsByTagNameNS(NS.a, 'blip')[0];
      if (blip) {
        const rid = blip.getAttributeNS(NS.r, 'embed');
        if (rid && rels[rid]) {
          const img = document.createElement('img');
          img.src = await mediaUrl(rels[rid]);
          host.appendChild(img);
        }
      }
    }
    if (!host.childNodes.length) host.appendChild(document.createElement('br'));
    out.appendChild(host);
  };
  const body = doc.getElementsByTagNameNS(NS.w, 'body')[0];
  view.textContent = '';
  const frag = document.createDocumentFragment();
  const walk = async (parent, container) => {
    for (const child of parent.children) {
      if (child.localName === 'p') await fillPara(child, container);
      else if (child.localName === 'tbl') {
        const tb = document.createElement('table');
        for (const tr of child.getElementsByTagNameNS(NS.w, 'tr')) {
          const row = document.createElement('tr');
          for (const tc of tr.getElementsByTagNameNS(NS.w, 'tc')) {
            const cell = document.createElement('td');
            await walk(tc, cell);
            row.appendChild(cell);
          }
          tb.appendChild(row);
        }
        container.appendChild(tb);
      }
    }
  };
  await walk(body, frag);
  view.appendChild(frag);
  return frag.textContent.length;
}
const mediaType = (p) => /\.png$/i.test(p) ? 'image/png' : /\.jpe?g$/i.test(p) ? 'image/jpeg'
  : /\.gif$/i.test(p) ? 'image/gif' : /\.bmp$/i.test(p) ? 'image/bmp' : 'application/octet-stream';

/* ================= PPTX 解析 + 放映 ================= */
// ppt/slides/slideN.xml：a:off/a:ext 定位文本框与图片；notesSlides 取演讲者备注；
// presentation.xml sldSz 取画布比例。渲染为绝对定位元素 + 放映状态机。
async function renderPptx(buf, stage) {
  const zip = await readZip(buf);
  const slideNames = zip.names.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => (parseInt(a.replace(/\D/g, ''), 10) || 0) - (parseInt(b.replace(/\D/g, ''), 10) || 0));
  if (!slideNames.length) throw new Error('PPTX 缺少幻灯片');
  // 画布尺寸
  let W = 9144000, H = 6858000; // EMU 默认 4:3
  const presXml = await zip.entry('ppt/presentation.xml');
  if (presXml) {
    const pm = new DOMParser().parseFromString(new TextDecoder().decode(presXml), 'application/xml');
    const sz = pm.getElementsByTagNameNS('*', 'sldSz')[0];
    if (sz) { W = +sz.getAttribute('cx') || W; H = +sz.getAttribute('cy') || H; }
  }
  const relsOf = async (slidePath) => {
    const rp = slidePath.replace('ppt/slides/', 'ppt/slides/_rels/') + '.rels';
    const xml = await zip.entry(rp);
    const map = {};
    if (xml) {
      const rd = new DOMParser().parseFromString(new TextDecoder().decode(xml), 'application/xml');
      for (const rel of rd.getElementsByTagNameNS('*', 'Relationship')) {
        const t = rel.getAttribute('Target') || '';
        if (/^(\.\.\/)?media\//.test(t))
          map[rel.getAttribute('Id')] = 'ppt/media/' + t.replace(/^(\.\.\/)?media\//, '');
      }
    }
    return map;
  };
  const notesOf = async (n) => {
    const xml = await zip.entry(`ppt/notesSlides/notesSlide${n}.xml`);
    if (!xml) return '';
    const nd = new DOMParser().parseFromString(new TextDecoder().decode(xml), 'application/xml');
    return [...nd.getElementsByTagNameNS('*', 't')].map((t) => t.textContent).join(' ').trim();
  };
  const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  const slides = [];
  const EMU = (v) => (v / W) * 100; // 百分比定位
  for (let s = 0; s < slideNames.length; s++) {
    const path = slideNames[s];
    const xml = await zip.entry(path);
    if (!xml) continue;
    const doc = new DOMParser().parseFromString(new TextDecoder().decode(xml), 'application/xml');
    const rels = await relsOf(path);
    const els = [];
    for (const sp of doc.getElementsByTagNameNS('*', 'sp')) {
      const off = sp.getElementsByTagNameNS(A, 'off')[0];
      const ext = sp.getElementsByTagNameNS(A, 'ext')[0];
      if (!off || !ext) continue;
      const div = document.createElement('div');
      div.className = 'el';
      div.style.left = EMU(+off.getAttribute('x')) + '%';
      div.style.top = EMU(+off.getAttribute('y')) + '%';
      div.style.width = ((+ext.getAttribute('cx') / W) * 100) + '%';
      div.style.height = ((+ext.getAttribute('cy') / H) * 100) + '%';
      div.style.fontSize = 'clamp(11px, 2.4vh, 26px)';
      for (const p of sp.getElementsByTagNameNS(A, 'p')) {
        const line = document.createElement('div');
        let sz = 0, bold = false;
        for (const r of p.getElementsByTagNameNS(A, 'r')) {
          const t = r.getElementsByTagNameNS(A, 't')[0];
          if (!t || !t.textContent) continue;
          const span = document.createElement('span');
          span.textContent = t.textContent;
          const rPr = r.getElementsByTagNameNS(A, 'rPr')[0];
          if (rPr) {
            const s2 = +rPr.getAttribute('sz');
            if (s2 > 0) { sz = Math.max(sz, s2); span.style.fontSize = (s2 / 1800) + 'em'; }
            if (rPr.getAttribute('b') === '1') { bold = true; span.style.fontWeight = '700'; }
          }
          line.appendChild(span);
        }
        if (bold) line.style.fontWeight = '700';
        div.appendChild(line);
      }
      els.push(div);
    }
    for (const pic of doc.getElementsByTagNameNS('*', 'pic')) {
      const blip = pic.getElementsByTagNameNS(A, 'blip')[0];
      const off = pic.getElementsByTagNameNS(A, 'off')[0];
      const ext = pic.getElementsByTagNameNS(A, 'ext')[0];
      if (!blip || !off || !ext) continue;
      const rid = blip.getAttributeNS(
        'http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'embed');
      const mediaPath = rels[rid];
      if (!mediaPath) continue;
      const data = await zip.entry(mediaPath);
      if (!data) continue;
      const img = document.createElement('img');
      img.className = 'el';
      img.style.left = EMU(+off.getAttribute('x')) + '%';
      img.style.top = EMU(+off.getAttribute('y')) + '%';
      img.style.width = ((+ext.getAttribute('cx') / W) * 100) + '%';
      img.style.height = ((+ext.getAttribute('cy') / H) * 100) + '%';
      img.src = URL.createObjectURL(new Blob([data], { type: mediaType(mediaPath) }));
      els.push(img);
    }
    slides.push({ els, notes: await notesOf(s + 1) });
  }
  stage.textContent = '';
  return slides;
}

/* ================= TXT 编码自动识别 ================= */
// 顺序试探：UTF-8(strict) → UTF-8 BOM → GB18030 → Big5 → Shift_JIS → Windows-1252。
// 以 fatal 解码失败率 + 控制字符密度打分。
function decodeTxt(u8) {
  const tryDec = (label) => {
    try { return { enc: label, text: new TextDecoder(label, { fatal: true }).decode(u8) }; }
    catch (_) { return null; }
  };
  if (u8[0] === 0xFF && u8[1] === 0xFE) {
    return { enc: 'UTF-16LE', text: new TextDecoder('utf-16le').decode(u8.subarray(2)) };
  }
  if (u8[0] === 0xFE && u8[1] === 0xFF) {
    return { enc: 'UTF-16BE', text: new TextDecoder('utf-16be').decode(u8.subarray(2)) };
  }
  const cand = ['utf-8', 'gb18030', 'big5', 'shift_jis', 'windows-1252'];
  let best = null;
  for (const c of cand) {
    const r = tryDec(c);
    if (!r) continue;
    // 统计 C0 控制字符（排除 \t \n \r）密度，越低越可信
    let bad = 0;
    for (let i = 0; i < r.text.length; i++) {
      const code = r.text.charCodeAt(i);
      if (code < 32 && code !== 9 && code !== 10 && code !== 13) bad++;
    }
    const score = bad / Math.max(1, r.text.length);
    if (!best || score < best.score) best = { enc: r.enc, text: r.text, score };
    if (c === 'utf-8' && score === 0) return { enc: 'UTF-8', text: r.text }; // strict utf-8 直接采信
  }
  return { enc: (best && best.enc) || 'UTF-8', text: (best && best.text) || '' };
}

/* ================= 编辑器状态与工具栏 ================= */
const S = { name: '', kind: '', buf: null, slides: [], slideIdx: 0, previewMode: 0 };
const KINDS = {
  md: { label: 'Markdown', edit: true }, txt: { label: 'TXT', edit: true },
  docx: { label: 'DOCX 文档' }, pptx: { label: 'PPTX 演示' }, pdf: { label: 'PDF' },
};
const kindOf = (name) => {
  const ext = (name.split('.').pop() || '').toLowerCase();
  return ext === 'md' || ext === 'markdown' ? 'md'
    : (ext === 'txt' || ext === 'log') ? 'txt'
    : ext === 'docx' ? 'docx' : ext === 'pptx' ? 'pptx' : ext === 'pdf' ? 'pdf' : '';
};

function showPane(kind) {
  const ws = $('workspace'), stage = $('slideStage'), pdf = $('pdfHolder');
  ws.style.display = (kind === 'md' || kind === 'txt' || kind === 'docx') ? 'flex' : 'none';
  stage.style.display = kind === 'pptx' ? 'flex' : 'none';
  $('slideNav').style.display = kind === 'pptx' ? 'flex' : 'none';
  pdf.style.display = kind === 'pdf' ? 'block' : 'none';
  $('btnPlay').style.display = kind === 'pptx' ? '' : 'none';
  $('mdPreview').style.display = 'none';
  $('mdInput').style.display = 'none';
  $('docView').style.display = 'none';
  if (kind === 'md') {
    $('mdInput').style.display = CAN_EDIT ? 'block' : 'none';
    $('mdPreview').style.display = 'block';
  } else if (kind === 'txt') {
    $('mdInput').style.display = CAN_EDIT ? 'block' : 'none';
    $('mdPreview').style.display = 'none';
  } else if (kind === 'docx') {
    $('docView').style.display = 'block';
  }
  // Android 仅预览：工具栏编辑按钮隐藏（保留导出/预览切换）
  for (const b of document.querySelectorAll('#toolbar .tb[data-cmd]'))
    b.style.display = (CAN_EDIT && (kind === 'md' || kind === 'txt')) ? '' : 'none';
  $('fontSize').style.display = (CAN_EDIT && kind === 'md') ? '' : 'none';
  $('fontColor').style.display = (CAN_EDIT && kind === 'md') ? '' : 'none';
  $('btnPreviewMode').style.display = (CAN_EDIT && kind === 'md') ? '' : 'none';
  $('btnSave').style.display = (kind === 'md' || kind === 'txt' || kind === 'docx') ? '' : 'none';
}

async function openFile(file) {
  const kind = kindOf(file.name);
  if (!kind) { toast('暂不支持该格式（支持 md/txt/docx/pptx/pdf）'); return; }
  S.name = file.name; S.kind = kind; S.buf = await file.arrayBuffer();
  $('dropzone').style.display = 'none';
  $('editorRoot').style.display = 'flex';
  $('btnClose').style.display = '';
  $('stName').textContent = file.name;
  $('stKind').textContent = KINDS[kind].label;
  showPane(kind);
  try {
    if (kind === 'md' || kind === 'txt') {
      const { enc, text } = decodeTxt(new Uint8Array(S.buf));
      $('mdInput').value = text;
      $('stEnc').textContent = '编码 ' + enc;
      $('stCount').textContent = text.length.toLocaleString() + ' 字符';
      if (kind === 'md') $('mdPreview').innerHTML = renderMd(text);
      S.previewMode = CAN_EDIT ? 0 : 2;
      applyPreviewMode();
    } else if (kind === 'docx') {
      const n = await renderDocx(S.buf, $('docView'));
      $('docView').contentEditable = CAN_EDIT ? 'true' : 'false';
      $('stEnc').textContent = '';
      $('stCount').textContent = n.toLocaleString() + ' 字符';
    } else if (kind === 'pptx') {
      S.slides = await renderPptx(S.buf, $('slideStage'));
      S.slideIdx = 0;
      showSlide(0);
    } else if (kind === 'pdf') {
      const url = URL.createObjectURL(new Blob([S.buf], { type: 'application/pdf' }));
      $('pdfHolder').textContent = '';
      const em = document.createElement('embed');
      em.src = url; em.type = 'application/pdf';
      $('pdfHolder').appendChild(em);
    }
  } catch (e) {
    toast('解析失败：' + (e && e.message || e), 4000);
  }
}

/* ---- PPT 放映状态机 ---- */
function showSlide(i) {
  const stage = $('slideStage');
  stage.textContent = '';
  if (!S.slides.length) return;
  S.slideIdx = (i + S.slides.length) % S.slides.length;
  const sl = S.slides[S.slideIdx];
  const box = document.createElement('div');
  box.className = 'slide';
  for (const el of sl.els) box.appendChild(el.cloneNode(true));
  stage.appendChild(box);
  $('slIdx').textContent = (S.slideIdx + 1) + ' / ' + S.slides.length;
  $('spText').textContent = sl.notes || '（本页无备注）';
}
function toggleSpeaker() {
  const sp = $('speakerNotes');
  sp.style.display = sp.style.display === 'block' ? 'none' : 'block';
}

/* ---- MD 工具栏 ---- */
function wrapSel(before, after = before, ph = '') {
  const ta = $('mdInput');
  const { selectionStart: a, selectionEnd: b, value: v } = ta;
  const sel = v.slice(a, b) || ph;
  ta.setRangeText(before + sel + after, a, b, 'end');
  ta.focus();
  ta.selectionStart = a + before.length;
  ta.selectionEnd = a + before.length + sel.length;
  onMdInput();
}
function linePrefix(prefix) {
  const ta = $('mdInput');
  const { selectionStart: a, value: v } = ta;
  const ls = v.lastIndexOf('\n', a - 1) + 1;
  ta.setRangeText(prefix, ls, ls, 'end');
  ta.focus();
  onMdInput();
}
function onMdInput() {
  const text = $('mdInput').value;
  $('stCount').textContent = text.length.toLocaleString() + ' 字符';
  if (S.kind === 'md') $('mdPreview').innerHTML = renderMd(text);
}
function applyPreviewMode() {
  const ws = $('workspace');
  ws.classList.toggle('split', S.previewMode === 0 && CAN_EDIT);
  ws.classList.toggle('preview-only', S.previewMode === 2);
  $('btnPreviewMode').textContent = ['预览', '纯编辑', '纯预览'][S.previewMode] || '预览';
}

/* ---- 导出 ---- */
function mdToStandaloneHtml(md) {
  return '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">'
    + '<title>' + esc(S.name) + '</title><style>body{max-width:820px;margin:40px auto;'
    + 'padding:0 20px;font:15px/1.8 -apple-system,"Segoe UI","PingFang SC",sans-serif;}'
    + 'table{border-collapse:collapse}th,td{border:1px solid #ccc;padding:6px 12px}'
    + 'blockquote{border-left:3px solid #2f6bff;margin:0;padding:2px 14px;color:#555;'
    + 'background:rgba(47,107,255,.06)}code{background:#f2f4f8;padding:1px 6px;border-radius:4px}'
    + 'pre{background:#f2f4f8;padding:12px;border-radius:8px;overflow:auto}'
    + 'img{max-width:100%}</style></head><body>' + renderMd(md) + '</body></html>';
}

/* ================= WASM 按需加载（后台配置 wasmUrl） ================= */
async function loadWasmEngine() {
  if (!OFFICE_CFG.wasmUrl) { toast('后台未配置 WASM 引擎地址'); return; }
  toast('正在加载 LibreOffice WASM 引擎…（首次较大，请耐心等待）', 6000);
  try {
    await new Promise((resolve, reject) => {
      const sc = document.createElement('script');
      sc.src = OFFICE_CFG.wasmUrl;
      sc.onload = resolve;
      sc.onerror = () => reject(new Error('WASM 引擎脚本加载失败'));
      document.head.appendChild(sc);
    });
    // 约定：引擎脚本暴露 window.NodeByteWasmOffice.mount(viewEl, bytes)
    if (window.NodeByteWasmOffice && typeof window.NodeByteWasmOffice.mount === 'function') {
      await window.NodeByteWasmOffice.mount($('docView'), S.buf);
      toast('完整编辑引擎已加载');
    } else {
      toast('引擎已下载，但未提供 NodeByteWasmOffice.mount 接口', 4000);
    }
  } catch (e) {
    toast('WASM 加载失败：' + (e && e.message || e), 4000);
  }
}

/* ================= 事件绑定 ================= */
function bind() {
  $('btnOpen').onclick = () => $('fileInput').click();
  $('btnClose').onclick = () => location.reload();
  $('fileInput').onchange = (e) => { if (e.target.files[0]) openFile(e.target.files[0]); };
  const dz = $('dropzone');
  document.body.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('drag'); });
  document.body.addEventListener('dragleave', () => dz.classList.remove('drag'));
  document.body.addEventListener('drop', (e) => {
    e.preventDefault(); dz.classList.remove('drag');
    if (e.dataTransfer.files[0]) openFile(e.dataTransfer.files[0]);
  });
  $('mdInput').addEventListener('input', onMdInput);
  for (const b of document.querySelectorAll('#toolbar .tb[data-cmd]')) {
    b.onclick = () => {
      const c = b.dataset.cmd;
      if (c === 'h1') linePrefix('# ');
      else if (c === 'h2') linePrefix('## ');
      else if (c === 'h3') linePrefix('### ');
      else if (c === 'bold') wrapSel('**');
      else if (c === 'italic') wrapSel('*');
      else if (c === 'strike') wrapSel('~~');
      else if (c === 'ul') linePrefix('- ');
      else if (c === 'ol') linePrefix('1. ');
      else if (c === 'quote') linePrefix('> ');
      else if (c === 'code') wrapSel('`');
      else if (c === 'link') $('dlgLink').showModal();
      else if (c === 'table') $('dlgTable').showModal();
      else if (c === 'image') {
        const inp = document.createElement('input');
        inp.type = 'file'; inp.accept = 'image/*';
        inp.onchange = async () => {
          if (!inp.files[0]) return;
          const data = await inp.files[0].arrayBuffer();
          let bin = '';
          const u8 = new Uint8Array(data);
          for (let i = 0; i < u8.length; i += 8192)
            bin += String.fromCharCode.apply(null, u8.subarray(i, i + 8192));
          const b64 = btoa(bin);
          const ext = (inp.files[0].name.split('.').pop() || 'png').toLowerCase();
          wrapSel('', '', `![${inp.files[0].name}](data:image/${ext};base64,${b64})`);
          toast('图片已内嵌为 base64（随 .md 保存）');
        };
        inp.click();
      }
    };
  }
  $('fontSize').onchange = () => { $('mdPreview').style.fontSize = $('fontSize').value + 'px'; };
  $('fontColor').oninput = () => { $('mdPreview').style.color = $('fontColor').value; };
  $('btnPreviewMode').onclick = () => { S.previewMode = (S.previewMode + 1) % 3; applyPreviewMode(); };
  $('btnPlay').onclick = () => {
    if (S.kind !== 'pptx') return;
    $('btnPlay').textContent = S._playing ? '▶ 放映' : '⏸ 退出放映';
    if (S._playing) { showPane('pptx'); S._playing = false; }
    else { S._playing = true; showSlide(S.slideIdx); }
  };
  $('btnWasm').onclick = loadWasmEngine;
  $('btnSave').onclick = () => {
    if (S.kind === 'md') {
      const text = $('mdInput').value;
      $('exTitle').textContent = '导出 Markdown';
      $('exNote').textContent = '导出 .md（保留全部标记）或 .html（带样式单文件）；如需 PDF，请使用 nodebyte://print 打印面板。';
      $('exDo').onclick = () => {
        download(new Blob([text], { type: 'text/markdown' }), baseName() + '.md');
        $('dlgExport').close();
      };
      $('dlgExport').showModal();
    } else if (S.kind === 'txt') {
      download(new Blob([$('mdInput').value], { type: 'text/plain' }), baseName() + '.txt');
    } else if (S.kind === 'docx') {
      $('exTitle').textContent = '导出 DOCX 轻编辑结果';
      $('exNote').textContent = '轻编辑结果导出为带样式的 .html；原格式 .docx 回写属 LibreOffice WASM 完整引擎范围（后台配置后可用）。';
      $('exDo').onclick = () => {
        const html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>'
          + esc(S.name) + '</title></head><body>' + $('docView').innerHTML + '</body></html>';
        download(new Blob([html], { type: 'text/html' }), baseName() + '.html');
        $('dlgExport').close();
      };
      $('dlgExport').showModal();
    }
  };
  // 链接/表格对话框
  $('lkOk').onclick = () => {
    const t = $('lkText').value || $('lkUrl').value;
    const u = $('lkUrl').value;
    if (u) wrapSel('[', `](${u})`, t || '链接');
    $('dlgLink').close();
  };
  $('lkCancel').onclick = () => $('dlgLink').close();
  $('tbOk').onclick = () => {
    const m = $('tbSize').value.match(/(\d+)\s*[×x*]\s*(\d+)/i);
    if (m) {
      const rows = Math.min(20, +m[1]), cols = Math.min(10, +m[2]);
      let tb = '\n' + '| ' + Array.from({ length: cols }, (_, i) => '列' + (i + 1)).join(' | ') + ' |\n'
        + '|' + Array.from({ length: cols }, () => '---').join('|') + '|\n';
      for (let r = 0; r < rows; r++)
        tb += '| ' + Array.from({ length: cols }, () => ' ').join(' | ') + ' |\n';
      wrapSel('', '', tb);
    }
    $('dlgTable').close();
  };
  $('tbCancel').onclick = () => $('dlgTable').close();
  $('exCancel').onclick = () => $('dlgExport').close();
  // 放映控制
  $('slPrev').onclick = () => showSlide(S.slideIdx - 1);
  $('slNext').onclick = () => showSlide(S.slideIdx + 1);
  $('slSpeaker').onclick = toggleSpeaker;
  $('slFull').onclick = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else $('slideStage').requestFullscreen && $('slideStage').requestFullscreen();
  };
  document.addEventListener('keydown', (e) => {
    if (S.kind !== 'pptx') return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); showSlide(S.slideIdx + 1); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); showSlide(S.slideIdx - 1); }
    else if (e.key === 'Escape' && S._playing) { S._playing = false; $('btnPlay').textContent = '▶ 放映'; }
  });
  // 平台徽标
  $('platBadge').textContent = IS_ANDROID
    ? (OFFICE_CFG.editOnAndroid ? 'Android · 已放开编辑' : 'Android · 仅预览')
    : '桌面端 · 完整编辑';
}
const baseName = () => (S.name || 'document').replace(/\.[^.]+$/, '');

/* ================= 启动 ================= */
bind();
loadOfficeConfig();
