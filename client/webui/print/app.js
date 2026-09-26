// NodeByte 高级打印面板 nodebyte://print —— app.js
// 流程（提示词 5.11.2/5.11.3）：载入临时 PDF → 排版设置（页码范围/缩放/边距/
// 多页合一/小册子）→ pdf-kit 页面级二次处理（纯本地）→ 下载 / 交给系统打印。
'use strict';

const $ = (id) => document.getElementById(id);
const fmtSize = (n) => n < 1024 ? n + ' B'
  : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(2) + ' MB';

const S = { buf: null, name: '', pages: 0, out: null };

function toast(msg, ms) {
  // 轻量提示（print 面板用 errBox/result 为主，toast 兜底）
  const box = $('errBox');
  if (msg.startsWith('✔')) {
    box.style.display = 'none';
    return;
  }
  box.textContent = msg;
  box.style.display = 'block';
  clearTimeout(toast._h);
  toast._h = setTimeout(() => { box.style.display = 'none'; }, ms || 5000);
}

/* ---------- 载入 ---------- */
async function loadFile(file) {
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
    toast('请选择 PDF 文件（先经「另存为 PDF」得到临时 PDF）');
    return;
  }
  S.buf = await file.arrayBuffer();
  S.name = file.name;
  S.out = null;
  $('btnDownload').disabled = true;
  $('result').style.display = 'none';
  // 页数预读（复用 pdf-kit 扫描器）
  try {
    const kit = window.NodeBytePdfKit;
    const { objects } = kit.scanObjects(new Uint8Array(S.buf));
    // 快速数页：找 Catalog → Pages → Count
    const u8 = new Uint8Array(S.buf);
    let count = null;
    const km = /\/Count\s+(\d+)/.exec(new TextDecoder('latin1').decode(u8.subarray(0, Math.min(u8.length, 4 << 20))));
    if (km) count = +km[1];
    else {
      const km2 = /\/Count\s+(\d+)/.exec(new TextDecoder('latin1').decode(u8));
      count = km2 ? +km2[1] : null;
    }
    S.pages = count || 0;
  } catch (_) { S.pages = 0; }
  $('fileInfo').style.display = 'flex';
  $('fName').textContent = file.name;
  $('fSize').textContent = fmtSize(file.size);
  $('fPages').textContent = S.pages ? S.pages + ' 页' : '页数未知';
  $('btnRun').disabled = false;
}

/* ---------- 生成 ---------- */
async function run() {
  if (!S.buf) return;
  const nup = +$('nup').value;
  const booklet = $('booklet').value === 'yes';
  const scale = Math.max(25, Math.min(400, +$('scale').value || 100)) / 100;
  const marginMm = Math.max(0, Math.min(50, +$('margin').value || 0));
  const ranges = $('ranges').value.trim();
  $('btnRun').disabled = true;
  try {
    const t0 = performance.now();
    const kit = window.NodeBytePdfKit;
    const out = await kit.processPdf(new Uint8Array(S.buf), {
      ranges, nup: booklet ? 1 : nup, booklet, scale, marginMm,
    });
    S.out = out;
    const ms = Math.round(performance.now() - t0);
    // 输出页数：xref 之前的 /Count（新 Pages 对象里的）
    const text = new TextDecoder('latin1').decode(out);
    const cm = /\/Type \/Pages[^>]*\/Count (\d+)/.exec(text)
      || /\/Count (\d+)[^>]*\/Type \/Pages/.exec(text);
    $('result').style.display = 'block';
    $('rOk').textContent = '✔ 处理完成';
    $('rPages').textContent = '输出 ' + (cm ? +cm[1] : '?') + ' 页';
    $('rSize').textContent = fmtSize(out.length);
    $('rTime').textContent = ms + ' ms';
    $('btnDownload').disabled = false;
  } catch (e) {
    toast('处理失败：' + (e && e.message || e), 8000);
  } finally {
    $('btnRun').disabled = false;
  }
}

function downloadOut() {
  if (!S.out) return;
  const blob = new Blob([S.out], { type: 'application/pdf' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (S.name.replace(/\.pdf$/i, '') || 'document') + '-nodebyte.pdf';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/* ---------- 绑定 ---------- */
function bind() {
  const dz = $('dropzone');
  dz.onclick = () => $('fileInput').click();
  ['dragover', 'dragenter'].forEach((ev) => document.body.addEventListener(ev, (e) => {
    e.preventDefault(); dz.classList.add('drag');
  }));
  ['dragleave', 'drop'].forEach((ev) => document.body.addEventListener(ev, (e) => {
    e.preventDefault(); dz.classList.remove('drag');
  }));
  document.body.addEventListener('drop', (e) => {
    if (e.dataTransfer && e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
  });
  $('fileInput').onchange = (e) => { if (e.target.files[0]) loadFile(e.target.files[0]); };
  $('btnRun').onclick = run;
  $('btnDownload').onclick = downloadOut;
  $('nup').onchange = () => {
    const v = +$('nup').value;
    $('nupNote').textContent = v === 1
      ? '单页模式：保持源页尺寸，仅应用缩放 / 边距 / 页码范围。'
      : `多页合一：输出页保持源页尺寸，${v} 页按网格缩放摆放。`;
  };
  $('booklet').onchange = () => {
    const on = $('booklet').value === 'yes';
    $('bookletWarn').style.display = on ? 'block' : 'none';
    $('nup').disabled = on;
  };
}
bind();
