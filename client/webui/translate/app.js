// NodeByte 翻译面板附加脚本（nodebyte://translate）。
// 主体逻辑内联在 index.html；本文件预留（grd 资源登记 + 后续拆分挂载点），
// 并补充 window.__NODEBYTE__ 兜底（数据源未注入 syncServer 时保持离线可用）。
'use strict';
window.__NODEBYTE__ = window.__NODEBYTE__ || {};
if (!window.__NODEBYTE__.syncServer) {
  // 页面已按空基址降级：提示但不再重复请求
  window.__NODEBYTE__.standalone = true;
}
