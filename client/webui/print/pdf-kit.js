// NodeByte 打印面板 nodebyte://print —— pdf-kit.js
// 零依赖 PDF 页面级处理引擎（提示词 5.11.2/5.11.3：多页合一、小册子、缩放、
// 边距自定义、页码范围、导出 PDF；安卓：前置面板 → 临时 PDF → 二次处理 → 系统打印）。
//
// 原理：源页内容原样包装为 Form XObject（不重编码，压缩流字节原样搬运），
// 在新输出页上用 cm 链（归一化 → 旋转 → 缩放 → 摆放）完成排版，
// 原文档对象原样携带进输出（对象号不变，字体/图片引用天然有效），重建经典 xref。
//
// 双端可用：仅依赖 Uint8Array / TextDecoder / DecompressionStream（浏览器 103+、
// Node 18+），供 server/scripts/office-print-selftest.mjs 做结构自测。
'use strict';

const MM = 72 / 25.4; // mm → pt

/* ---------------- 迷你对象词法 ---------------- */
class Lexer {
  constructor() { this.s = ''; this.i = 0; }
  static on(buf, pos) {
    const lx = new Lexer();
    lx.s = new TextDecoder('latin1').decode(buf);
    lx.i = pos || 0;
    return lx;
  }
  tok() {
    const s = this.s;
    while (this.i < s.length && /\s/.test(s[this.i])) this.i++;
    const c = s[this.i];
    if (c === undefined) return { t: 'eof', v: '' };
    if (c === '<' && s[this.i + 1] === '<') { this.i += 2; return { t: '<<' }; }
    if (c === '>' && s[this.i + 1] === '>') { this.i += 2; return { t: '>>' }; }
    if (c === '[') { this.i++; return { t: '[' }; }
    if (c === ']') { this.i++; return { t: ']' }; }
    if (c === '/' ) {
      const m = /^\/([^\s/<>\[\](){}<>]{0,127})/.exec(s.slice(this.i));
      this.i += m[0].length;
      return { t: 'name', v: m[1] };
    }
    if (c === '(') {
      let depth = 1, j = this.i + 1;
      while (j < s.length && depth > 0) {
        if (s[j] === '\\') { j += 2; continue; }
        if (s[j] === '(') depth++;
        if (s[j] === ')') { depth--; if (!depth) break; }
        j++;
      }
      const v = s.slice(this.i + 1, j);
      this.i = j + 1;
      return { t: 'str', v };
    }
    if (c === '<') {
      const e = s.indexOf('>', this.i);
      const v = s.slice(this.i + 1, e < 0 ? s.length : e);
      this.i = (e < 0 ? s.length : e) + 1;
      return { t: 'hex', v };
    }
    const m = /^[^\s/<>\[\](){}`']+/.exec(s.slice(this.i));
    if (!m) { this.i++; return { t: c, v: c }; }
    this.i += m[0].length;
    return { t: 'atom', v: m[0] };
  }
  val() {
    const tk = this.tok();
    switch (tk.t) {
      case '<<': {
        const d = {};
        for (;;) {
          const k = this.tok();
          if (k.t === '>>' || k.t === 'eof') return d;
          if (k.t !== 'name') continue;
          d[k.v] = this.val();
        }
      }
      case '[': {
        const a = [];
        for (;;) {
          const save = this.i;
          if (this.tok().t === ']') return a;
          this.i = save;
          a.push(this.val());
        }
      }
      case 'name': return { raw: tk.v };
      case 'atom': {
        // 整数优先尝试间接引用 "N G R"（防被纯数字提前返回吞掉）
        if (/^\d+$/.test(tk.v)) {
          const save = this.i;
          const g = this.tok(), r = this.tok();
          if (g.t === 'atom' && /^\d+$/.test(g.v) && r.t === 'atom' && r.v === 'R')
            return { ref: [+tk.v, +g.v] };
          this.i = save;
        }
        if (/^[-+]?(\d+\.?\d*|\.\d+)$/.test(tk.v)) return parseFloat(tk.v);
        if (tk.v === 'true') return true;
        if (tk.v === 'false') return false;
        if (tk.v === 'null') return null;
        return { raw: tk.v };
      }
      case 'str': case 'hex': return { str: tk.v };
      default: return { raw: tk.t };
    }
  }
}

/* ---------------- 对象扫描 / 解析 ---------------- */
// 流感知定界：对象若含 stream，则跳过首个 endstream 后再找 endobj，
// 防止二进制内容里的 "endobj" 字样截断对象；/Length 直接值时精确复算。
function scanObjects(u8) {
  const text = new TextDecoder('latin1').decode(u8);
  const objects = new Map();
  const re = /(?:^|[^0-9])(\d+)\s+(\d+)\s+obj\b/g;
  let m;
  const starts = [];
  while ((m = re.exec(text))) {
    const num = +m[1];
    if (objects.has(num)) continue;
    const start = m.index + (m[0][0] >= '0' && m[0][0] <= '9' ? 0 : 1);
    starts.push([num, +m[2], start]);
    objects.set(num, { gen: +m[2], start, end: -1 });
  }
  for (const [num, gen, start] of starts) {
    const span = objects.get(num);
    const headEnd = Math.min(text.length, start + 65536);
    const frag = text.slice(start, headEnd);
    // 词法解析 dict，并记录 dict 结束位置（嵌套 <<>> 安全）
    let probe = null;
    try {
      const lx = Lexer.on(u8, 0);
      lx.s = frag;
      lx.i = frag.indexOf('obj') + 3;
      const d = lx.val();
      probe = { dict: d, after: lx.i };
    } catch (_) { probe = null; }
    const dict = (probe && probe.dict && typeof probe.dict === 'object' && !Array.isArray(probe.dict))
      ? probe.dict : null;
    const afterDict = probe ? probe.after : 0;
    // 本对象自己的 endobj（定界锚点）：stream 关键字必须出现在它之前
    const eo = text.indexOf('endobj', start);
    const objEnd = eo < 0 ? Math.min(text.length, start + (1 << 20)) : eo + 6;
    const smRel = afterDict > 0
      ? /(?:^|[\s>])stream\r?\n/.exec(frag.slice(afterDict)) : null;
    const streamStart = smRel ? start + afterDict + smRel.index + smRel[0].length : -1;
    if (streamStart < 0 || streamStart >= objEnd) {
      span.end = objEnd;
      continue;
    }
    if (dict && typeof dict.Length === 'number') {
      const expect = streamStart + dict.Length;
      const em = /^[\r\n]*endstream/.exec(text.slice(expect, expect + 32));
      span.end = em ? expect + em[0].length
        : (text.indexOf('endstream', streamStart) >= 0
          ? text.indexOf('endstream', streamStart) + 9 : objEnd);
    } else {
      const es = text.indexOf('endstream', streamStart);
      span.end = es < 0 ? Math.min(text.length, streamStart + (1 << 20)) : es + 9;
    }
    const eo2 = text.indexOf('endobj', span.end);
    if (eo2 >= 0 && eo2 - span.end < 16) span.end = eo2 + 6;
    if (span.end > text.length) span.end = text.length;
  }
  return { objects, text };
}

function parseObject(u8, span) {
  const s = new TextDecoder('latin1').decode(u8.subarray(span.start, span.end));
  const objRel = s.indexOf('obj');
  const lx = Lexer.on(u8, 0);
  lx.s = s; // 直接在解码后的片段上词法（偏移全部相对片段）
  lx.i = objRel + 3;
  const dict = lx.val();
  const tail = s.slice(lx.i);
  const sm = /(?:^|[\s>])stream\r?\n/.exec(tail);
  if (!sm || !dict || typeof dict !== 'object' || Array.isArray(dict)) return { dict, stream: null };
  const streamStart = lx.i + sm.index + sm[0].length;
  // 数据结束位置：/Length 直接值 → 精确；否则回退 endstream 扫描 + 去尾部分隔 EOL
  let dataEnd;
  if (typeof dict.Length === 'number' && streamStart + dict.Length <= s.length
      && /^[\r\n]*endstream/.test(s.slice(streamStart + dict.Length, streamStart + dict.Length + 12))) {
    dataEnd = streamStart + dict.Length;
  } else {
    const e = tail.indexOf('endstream', streamStart - lx.i);
    dataEnd = e < 0 ? s.length : e;
    while (dataEnd > streamStart && (u8[span.start + dataEnd - 1] === 10 || u8[span.start + dataEnd - 1] === 13)) dataEnd--;
  }
  return { dict, stream: { start: span.start + streamStart, end: span.start + dataEnd, dict } };
}

async function inflate(raw) {
  const ds = new DecompressionStream('deflate-raw');
  return new Uint8Array(
    await new Response(new Blob([raw]).stream().pipeThrough(ds)).arrayBuffer());
}

/* ---------------- 展开 ObjStm（压缩对象流 → 合成独立对象） ---------------- */
async function expandObjStm(u8, objects) {
  const out = new Map();
  for (const [num, span] of objects) {
    let p;
    try { p = parseObject(u8, span); } catch (_) { p = null; }
    const isStm = p && p.stream && p.dict && p.dict.Type && p.dict.Type.raw === 'ObjStm';
    if (!isStm) { out.set(num, { ...span, u8 }); continue; }
    let data = u8.subarray(p.stream.start, p.stream.end);
    if (p.stream.dict.Filter) {
      try { data = await inflate(data); } catch (_) { out.set(num, { ...span, u8 }); continue; }
    }
    const N = p.dict.N || 0, First = p.dict.First || 0;
    const hdr = new TextDecoder('latin1').decode(data.subarray(0, First)).trim();
    const nums = hdr.split(/\s+/).map(Number);
    for (let k = 0; k < N && k * 2 + 1 < nums.length; k++) {
      const objNum = nums[k * 2], relOff = nums[k * 2 + 1];
      if (!Number.isFinite(objNum) || !Number.isFinite(relOff)) continue;
      const bodyStart = First + relOff;
      const bodyEnd = k + 1 < N && Number.isFinite(nums[(k + 1) * 2 + 1])
        ? First + nums[(k + 1) * 2 + 1] : data.length;
      const body = data.subarray(bodyStart, bodyEnd);
      const headStr = `${objNum} 0 obj\n`;
      const synth = new Uint8Array(headStr.length + body.length + 9);
      synth.set(new TextEncoder().encode(headStr), 0);
      synth.set(body, headStr.length);
      synth.set(new TextEncoder().encode('\nendobj\n'), headStr.length + body.length);
      out.set(objNum, { gen: 0, start: 0, end: synth.length, synth, u8: synth });
    }
  }
  return out;
}

/* ---------------- 页树遍历（含继承） ---------------- */
function resolve(v, all) {
  let guard = 0;
  while (v && v.ref && guard++ < 8) {
    const span = all.get(v.ref[0]);
    if (!span) return v;
    const p = parseObject(span.u8, span);
    if (!p.dict) return v;
    v = p.dict;
  }
  return v;
}
function walkPages(all, pagesRef, inherit, out, depth) {
  if (depth > 32) return;
  const span = all.get(pagesRef[0]);
  if (!span) return;
  const p = parseObject(span.u8, span);
  const d = (p.dict && typeof p.dict === 'object') ? p.dict : {};
  const inh = {
    Resources: d.Resources || inherit.Resources,
    MediaBox: d.MediaBox || inherit.MediaBox,
    Rotate: d.Rotate || inherit.Rotate || 0,
  };
  const type = d.Type && d.Type.raw;
  if (type === 'Page') { out.push({ ref: pagesRef, dict: d, inh }); return; }
  const kids = d.Kids || [];
  for (const k of kids) if (k && k.ref) walkPages(all, k.ref, inh, out, depth + 1);
}

/* ---------------- 页码范围 ---------------- */
function parseRanges(spec, total) {
  if (!spec || !spec.trim()) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = [];
  for (const part of spec.split(/[,，]/)) {
    const pm = part.trim().match(/^(\d+)?\s*(-)?\s*(\d+)?$/);
    if (!pm || (!pm[1] && !pm[3])) continue;
    const a = Math.max(1, pm[1] ? +pm[1] : 1);
    const b = Math.min(total, pm[2] ? (pm[3] ? +pm[3] : total) : a);
    for (let p = a; p <= b; p++) if (!pages.includes(p)) pages.push(p);
  }
  return pages.length ? pages : Array.from({ length: total }, (_, i) => i + 1);
}

/* ---------------- 小册子排序（骑马钉） ---------------- */
function bookletOrder(seq) {
  const n4 = Math.ceil(seq.length / 4) * 4;
  const padded = seq.concat(new Array(n4 - seq.length).fill(0));
  const out = [];
  for (let i = 0; i < n4 / 4; i++) {
    out.push([padded[n4 - 2 * i - 1], padded[2 * i]]);       // 正面：左外 / 右首
    out.push([padded[2 * i + 1], padded[n4 - 2 * i - 2]]);   // 背面：左内 / 右末
  }
  return out;
}

/* ---------------- 序列化辅助 ---------------- */
function inlineVal(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') return String(+v.toFixed(6));
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (v.raw) return `/${v.raw}`;
  if (v.ref) return `${v.ref[0]} ${v.ref[1]} R`;
  if (v.str !== undefined) return `(${v.str})`;
  if (Array.isArray(v)) return '[' + v.map(inlineVal).join(' ') + ']';
  if (typeof v === 'object')
    return '<< ' + Object.entries(v).map(([k, x]) => `/${k} ${inlineVal(x)}`).join(' ') + ' >>';
  return 'null';
}
function filterText(sd) {
  if (!sd) return '';
  const f = sd.Filter;
  if (!f) return '';
  const arr = Array.isArray(f) ? f : [f];
  let out = `/Filter [${arr.map((x) => inlineVal(x)).join(' ')}]\n`;
  const dp = sd.DecodeParms || sd.DP;
  if (dp) out += `/DecodeParms ${inlineVal(dp)}\n`;
  return out;
}

/* ---------------- 主处理 ---------------- */
// opts: { ranges, nup(1|2|4|6|9|16), booklet, scale(>0), marginMm(number|{t,r,b,l}) }
async function processPdf(u8, opts) {
  opts = opts || {};
  const nup = opts.nup || 1;
  const scale = Math.max(0.05, Math.min(4, opts.scale || 1));
  const mg = typeof opts.marginMm === 'number'
    ? { t: opts.marginMm, r: opts.marginMm, b: opts.marginMm, l: opts.marginMm }
    : (opts.marginMm || {});
  const margin = { t: (mg.t || 0) * MM, r: (mg.r || 0) * MM, b: (mg.b || 0) * MM, l: (mg.l || 0) * MM };

  // 1) 扫描 + ObjStm 展开
  const scanned = scanObjects(u8);
  if (scanned.objects.size === 0) throw new Error('PDF 中未发现对象（文件可能损坏）');
  const all = await expandObjStm(u8, scanned.objects);

  // 2) Catalog / Pages
  const text = new TextDecoder('latin1').decode(u8);
  let rootRef = null, infoRef = null;
  const tr = /trailer[\s\S]*?>>/.exec(text);
  if (tr) {
    const lx = Lexer.on(u8, 0);
    lx.s = new TextDecoder('latin1').decode(u8.subarray(0, u8.length));
    lx.i = tr.index + 'trailer'.length;
    const td = lx.val();
    if (td.Encrypt) throw new Error('加密 PDF 暂不支持，请先解除密码保护');
    rootRef = td.Root && td.Root.ref;
    infoRef = td.Info && td.Info.ref;
  }
  if (!rootRef) {
    for (const [, span] of all) {
      const p = parseObject(span.u8, span);
      if (p.dict && p.dict.Type && p.dict.Type.raw === 'Catalog') {
        rootRef = [num0(all, span), 0]; break;
      }
    }
  }
  if (!rootRef) throw new Error('未找到 PDF 目录（Catalog）');
  const rootObj = resolve({ ref: rootRef }, all);
  const pagesRef = rootObj && rootObj.Pages && rootObj.Pages.ref;
  if (!pagesRef) throw new Error('未找到页树（Pages）');
  const pages = [];
  walkPages(all, pagesRef, {}, pages, 0);
  if (!pages.length) throw new Error('PDF 中没有页面');

  // 3) 排版序列：每个输出页 = 一组源页号（0=空白槽）
  const order = parseRanges(opts.ranges, pages.length);
  let slots;
  if (opts.booklet) {
    slots = bookletOrder(order);
  } else if (nup > 1) {
    slots = [];
    for (let i = 0; i < order.length; i += nup) {
      const g = order.slice(i, i + nup);
      while (g.length < nup) g.push(0);
      slots.push(g);
    }
  } else {
    slots = order.map((p) => [p]);
  }

  // 4) 页几何（原始 bbox + 旋转）
  const geomOf = (pgIdx) => {
    const pg = pages[pgIdx];
    let mb = pg.dict.MediaBox || pg.inh.MediaBox || [0, 0, 612, 792];
    if (mb && mb.ref) mb = resolve(mb, all);
    if (!Array.isArray(mb)) mb = [0, 0, 612, 792];
    mb = mb.map(Number);
    let x0 = Math.min(mb[0], mb[2]), x1 = Math.max(mb[0], mb[2]);
    let y0 = Math.min(mb[1], mb[3]), y1 = Math.max(mb[1], mb[3]);
    const rot = ((Number(pg.inh.Rotate) || 0) % 360 + 360) % 360;
    return { x0, y0, x1, y1, w0: x1 - x0, h0: y1 - y0, rot };
  };
  const visualOf = (g) => ({
    w: g.rot % 180 ? g.h0 : g.w0,
    h: g.rot % 180 ? g.w0 : g.h0,
  });
  // 顺时针旋转矩阵（y-up 空间，绕原点后含补偿平移；应用前先 T(-x0,-y0) 归一化）
  const rotCm = (g) => {
    if (g.rot === 90) return [0, -1, 1, 0, 0, g.w0];
    if (g.rot === 180) return [-1, 0, 0, -1, g.w0, g.h0];
    if (g.rot === 270) return [0, 1, -1, 0, g.h0, 0];
    return [1, 0, 0, 1, 0, 0];
  };

  // 5) 源页 → Form XObject（每条内容流一个；流字节原样搬运）
  const newObjs = []; // {num, head?:string, data?:Uint8Array, tail?:string, text?:string}
  let next = Math.max(...all.keys()) + 1;
  const mkNum = () => next++;
  const resourcesTextOf = (pg) => {
    let res = pg.dict.Resources || pg.inh.Resources;
    if (res && res.ref) return `${res.ref[0]} ${res.ref[1]} R`;
    if (res) return inlineVal(res);
    return '<< >>';
  };
  const xobjectsFor = (pgIdx) => {
    const pg = pages[pgIdx];
    const span = all.get(pg.ref[0]);
    if (!span) return [];
    const p = parseObject(span.u8, span);
    const g = geomOf(pgIdx);
    const resText = resourcesTextOf(pg);
    let contents = pg.dict.Contents || [];
    if (contents && contents.ref) contents = [contents];
    if (!Array.isArray(contents)) contents = [];
    const xs = [];
    for (const c of contents) {
      if (!c || !c.ref) continue;
      const sSpan = all.get(c.ref[0]);
      if (!sSpan) continue;
      const sp = parseObject(sSpan.u8, sSpan);
      if (!sp.stream) continue;
      const data = sSpan.u8.subarray(sp.stream.start, sp.stream.end);
      const num = mkNum();
      const dict =
        `<< /Type /XObject /Subtype /Form\n` +
        `/BBox [${g.x0} ${g.y0} ${g.x1} ${g.y1}]\n` +
        `/Resources ${resText}\n` +
        filterText(sp.stream.dict) +
        `/Length ${data.length} >>\n`;
      newObjs.push({ num, head: `${num} 0 obj\n${dict}stream\n`, data, tail: `\nendstream\nendobj\n` });
      xs.push({ num, g });
    }
    return xs;
  };

  // 6) 输出页内容流 + 尺寸
  const mT = margin.t, mR = margin.r, mB = margin.b, mL = margin.l;
  const buildOutPage = (slotPages) => {
    const ops = [];
    const xoNames = [];
    const first = slotPages.find((p) => p > 0);
    const cell = (srcPage, x, y, w, h) => {
      if (!srcPage) return;
      const pgIdx = srcPage - 1;
      if (pgIdx < 0 || pgIdx >= pages.length) return;
      const xs = xobjectsFor(pgIdx);
      if (!xs.length) return;
      const g = xs[0].g;
      const v = visualOf(g);
      const ax = x + mL, ay = y + mB, aw = w - mL - mR, ah = h - mT - mB;
      const fit = Math.min(aw / v.w, ah / v.h) * scale;
      if (!(fit > 0)) return;
      const dw = v.w * fit, dh = v.h * fit;
      const dx = ax + (aw - dw) / 2, dy = ay + (ah - dh) / 2;
      for (const xo of xs) {
        const name = `Fx${xo.num}`;
        xoNames.push(`/${name} ${xo.num} 0 R`);
        ops.push('q');
        ops.push(`1 0 0 1 ${-xo.g.x0} ${-xo.g.y0} cm`);            // 归一化到 BBox 原点
        if (xo.g.rot) ops.push(rotCm(xo.g).map((n) => +n.toFixed(6)).join(' ') + ' cm'); // 旋转
        ops.push(`${fit.toFixed(6)} 0 0 ${fit.toFixed(6)} 0 0 cm`); // 缩放
        ops.push(`1 0 0 1 ${dx.toFixed(4)} ${dy.toFixed(4)} cm`);   // 摆放
        ops.push(`/${name} Do`);
        ops.push('Q');
      }
    };
    // 输出页尺寸：非合页 = 首个选中页可视尺寸 + 边距；小册子 = 左右双槽
    let boxW, boxH;
    if (opts.booklet) {
      const v = first ? visualOf(geomOf(first - 1)) : { w: 595, h: 842 };
      boxW = v.w * 2 + mL + mR; boxH = v.h + mT + mB;
      cell(slotPages[0], 0, 0, boxW / 2, boxH);
      cell(slotPages[1], boxW / 2, 0, boxW / 2, boxH);
    } else if (nup > 1) {
      const v = first ? visualOf(geomOf(first - 1)) : { w: 595, h: 842 };
      boxW = v.w + mL + mR; boxH = v.h + mT + mB;
      const cols = nup === 2 ? 2 : nup === 4 ? 2 : nup === 6 ? 3 : nup === 9 ? 3 : 4;
      const rows = Math.ceil(nup / cols);
      const cw = boxW / cols, ch = boxH / rows;
      slotPages.forEach((p, i) => {
        if (!p) return;
        const col = i % cols, row = Math.floor(i / cols);
        cell(p, col * cw, (rows - 1 - row) * ch, cw, ch);
      });
    } else {
      const v = first ? visualOf(geomOf(first - 1)) : { w: 595, h: 842 };
      boxW = v.w + mL + mR; boxH = v.h + mT + mB;
      cell(slotPages[0], 0, 0, boxW, boxH);
    }
    const xoRes = xoNames.length
      ? `<< /XObject << ${xoNames.join(' ')} >> >>` : '<< >>';
    return { content: (ops.length ? ops.join('\n') + '\n' : ''), xoRes, boxW, boxH };
  };

  // 7) 组装输出
  const chunks = [];
  const headBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x37, 0x0A, 0x25,
    0xE2, 0xE3, 0xCF, 0xD3, 0x0A]); // %PDF-1.7 + 二进制标记行
  chunks.push(headBytes);
  let pos = headBytes.length;
  const offsets = new Map();
  const enc = new TextEncoder();
  const pushBytes = (b) => { chunks.push(b); pos += b.length; };
  const pushStr = (str) => pushBytes(enc.encode(str));

  // 7a) 原样携带原对象
  for (const [num, span] of all) {
    if (!span.synth) {
      offsets.set(num, pos);
      pushBytes(u8.subarray(span.start, span.end));
      pushStr('\n');
    }
  }
  // 合成对象（ObjStm 展开）
  for (const [num, span] of all) {
    if (span.synth) { offsets.set(num, pos); pushBytes(span.synth); }
  }

  // 7b) 输出页
  const pageNums = [];
  for (const slotPages of slots) {
    const { content, xoRes, boxW, boxH } = buildOutPage(slotPages);
    const cNum = mkNum();
    const cData = enc.encode(content);
    newObjs.push({
      num: cNum,
      head: `${cNum} 0 obj\n<< /Length ${cData.length} >>\nstream\n`,
      data: cData, tail: `\nendstream\nendobj\n`,
    });
    const pNum = mkNum();
    newObjs.push({
      num: pNum, text:
        `${pNum} 0 obj\n<< /Type /Page /Parent PAGES_R /MediaBox [0 0 ${boxW.toFixed(2)} ${boxH.toFixed(2)}]` +
        ` /Resources ${xoRes} /Contents ${cNum} 0 R >>\nendobj\n`,
    });
    pageNums.push(pNum);
  }
  const pagesNum = mkNum();
  newObjs.push({
    num: pagesNum, text:
      `${pagesNum} 0 obj\n<< /Type /Pages /Count ${pageNums.length} ` +
      `/Kids [${pageNums.map((n) => `${n} 0 R`).join(' ')}] >>\nendobj\n`,
  });
  const catalogNum = mkNum();
  newObjs.push({
    num: catalogNum, text:
      `${catalogNum} 0 obj\n<< /Type /Catalog /Pages ${pagesNum} 0 R >>\nendobj\n`,
  });

  // 7c) 写出新对象
  for (const o of newObjs) {
    if (o.text) { offsets.set(o.num, pos); pushStr(o.text); }
  }
  for (const o of newObjs) {
    if (!o.text) {
      offsets.set(o.num, pos);
      pushStr(o.head);
      pushBytes(o.data);
      pushStr(o.tail);
    }
  }

  // 7d) xref + trailer
  const xrefStart = pos;
  const maxNum = Math.max(...all.keys(), next - 1);
  let x = `xref\n0 ${maxNum + 1}\n0000000000 65535 f \n`;
  for (let n = 1; n <= maxNum; n++) {
    x += offsets.has(n)
      ? String(offsets.get(n)).padStart(10, '0') + ' 00000 n \n'
      : '0000000000 65535 f \n';
  }
  x += `trailer\n<< /Size ${maxNum + 1} /Root ${catalogNum} 0 R` +
    (infoRef ? ` /Info ${infoRef[0]} ${infoRef[1]} R` : '') +
    ` >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  pushStr(x);

  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

// ObjStm 无 trailer 时找 Catalog 的辅助（返回对象号）
function num0(all, span) {
  for (const [num, s] of all) if (s === span) return num;
  return 1;
}

/* ---------------- 导出（双端） ---------------- */
const api = { processPdf, parseRanges, bookletOrder, scanObjects, parseObject, Lexer, inlineVal };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.NodeBytePdfKit = api;
