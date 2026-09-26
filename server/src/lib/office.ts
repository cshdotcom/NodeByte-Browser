/**
 * 办公套件与高级打印配置（提示词 5.11；v1.4.4）
 * =====================================================================
 * 客户端 nodebyte://office（写作/文档/演示/PDF）与 nodebyte://print
 * （多页合一/小册子/缩放/边距/页码范围）启动时读取本配置。
 *
 * 可塑性铁律：客户端 → GET {syncServer}/api/client/office-config →
 * 后台配置 → （wasmUrl 指向的 LibreOffice WASM 完整编辑引擎，按需加载）。
 * 本地编辑/打印处理均在客户端离线完成，不经过服务端（隐私铁律）。
 *
 * 与客户端策略键对齐（client/src-nodebyte/chrome/browser/nodebyte/
 * nodebyte_constants.h + office_controller.cc）：
 *   NodeByteOfficeSuiteEnabled  → enabled（默认 true）
 *   NodeByteOfficeAndroidEdit   → editOnAndroid（默认 false，安卓仅预览）
 *   NodeBytePrintPanelEnabled   → printPanelEnabled（默认 true）
 */

export interface OfficeSettings {
  enabled: boolean;
  editOnAndroid: boolean;
  printPanelEnabled: boolean;
  /** LibreOffice WASM 完整编辑引擎资源地址（后台配置后客户端「按需加载」；空 = 未配置） */
  wasmUrl: string;
  /** 预留：服务端辅助转换的文件大小上限（MB）；v1.4.4 客户端本地处理不经过服务端 */
  maxUploadMb: number;
}

export const DEFAULT_OFFICE_SETTINGS: OfficeSettings = {
  enabled: true,
  editOnAndroid: false,
  printPanelEnabled: true,
  wasmUrl: '',
  maxUploadMb: 20,
};

/** 客户端可见字段（无敏感信息，登录前亦可读取，供办公页本地门控） */
export function clientView(s: OfficeSettings) {
  return {
    enabled: s.enabled,
    editOnAndroid: s.editOnAndroid,
    printPanelEnabled: s.printPanelEnabled,
    wasmUrl: s.wasmUrl,
    maxUploadMb: s.maxUploadMb,
  };
}

export function validateOfficeSettings(v: unknown): OfficeSettings | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Partial<OfficeSettings>;
  if (typeof o.enabled !== 'boolean') return null;
  if (typeof o.editOnAndroid !== 'boolean') return null;
  if (typeof o.printPanelEnabled !== 'boolean') return null;
  if (o.wasmUrl !== undefined && o.wasmUrl !== '' &&
      (typeof o.wasmUrl !== 'string' || !/^https?:\/\//.test(o.wasmUrl))) return null;
  if (typeof o.maxUploadMb !== 'number' || o.maxUploadMb < 1 || o.maxUploadMb > 512) return null;
  return {
    enabled: o.enabled,
    editOnAndroid: o.editOnAndroid,
    printPanelEnabled: o.printPanelEnabled,
    wasmUrl: (o.wasmUrl || '').trim(),
    maxUploadMb: o.maxUploadMb,
  };
}
