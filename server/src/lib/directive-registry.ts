/**
 * 策略指令注册表（服务端与客户端共用语义）。
 *
 * value_type 决定**撤销语义**（用户需求原文：
 *   「撤销后用户端那里配置就会删除：开关从开启变成关闭或从关闭变成开启（= 恢复默认）；
 *    地址或其他填空清空；搜索引擎变为编译时选择的默认搜索引擎」）：
 *
 *   switch        布尔开关；撤销 → 删除强制配置，恢复默认值（defaultValue）
 *   text          地址/文本；撤销 → 清空
 *   number        数值；撤销 → 清空（回退客户端默认）
 *   json          结构化配置；撤销 → 清空
 *   search_engine 搜索引擎；撤销 → 恢复编译时默认搜索引擎（必应）
 */

export const DIRECTIVE_VALUE_TYPES = ['switch', 'text', 'number', 'json', 'search_engine'] as const;
export type DirectiveValueType = (typeof DIRECTIVE_VALUE_TYPES)[number];

export type DirectiveMeta = {
  label: string;            // 中文说明（后台展示）
  valueType: DirectiveValueType;
  defaultValue?: unknown;   // switch 撤销后恢复的默认值（NodeByte 哲学：是否允许类默认 true）
  highRisk?: boolean;       // 高危开关（开启需二次确认 + 审计）
  compileDefault?: string;  // search_engine：编译时默认搜索引擎
};

export const COMPILE_DEFAULT_SEARCH_ENGINE = 'bing'; // 客户端提示词 4.5：默认搜索引擎必应（编译默认写死）

export const DIRECTIVE_REGISTRY: Record<string, DirectiveMeta> = {
  // ---- 账号与安全 ----
  CustomRequire2FA: { label: '强制绑定 2FA', valueType: 'switch', defaultValue: false },
  CustomLockSyncServer: { label: '锁定同步服务器地址', valueType: 'switch', defaultValue: false },
  CustomAllowMultiProfile: { label: '允许多用户资料', valueType: 'switch', defaultValue: true },
  CustomAllowGuestMode: { label: '允许访客模式', valueType: 'switch', defaultValue: true },
  CustomAllowIncognito: { label: '允许无痕窗口', valueType: 'switch', defaultValue: true },
  CustomDisableRendererSandbox: { label: '关闭渲染沙箱（高危）', valueType: 'switch', defaultValue: false, highRisk: true },

  // ---- 同步 ----
  CustomAllowSync: { label: '允许同步', valueType: 'switch', defaultValue: true },
  CustomAllowExportBackup: { label: '允许导出本地备份', valueType: 'switch', defaultValue: true },

  // ---- 网页能力 ----
  CustomAllowJavaScript: { label: '全局 JavaScript 开关', valueType: 'switch', defaultValue: true },
  CustomAllowWebSockets: { label: '允许 WebSocket', valueType: 'switch', defaultValue: true },
  CustomAllowWsUnderHttps: { label: 'HTTPS 页面放行 ws://（不建议）', valueType: 'switch', defaultValue: false },

  // ---- 代理 / 加速器 ----
  ProxyMode: { label: '代理模式', valueType: 'text', defaultValue: '' },
  ProxyServer: { label: '代理服务器地址', valueType: 'text', defaultValue: '' },
  ProxyBypassList: { label: '代理例外列表', valueType: 'text', defaultValue: '' },
  CustomProxyVlessConfig: { label: 'VLESS/VMess/Trojan/SS 节点配置', valueType: 'json', defaultValue: null },
  NodeByteAcceleratorEnabled: { label: '加速器总开关', valueType: 'switch', defaultValue: true },
  NodeByteAcceleratorProtocols: { label: '加速器允许的第三方协议列表', valueType: 'json', defaultValue: null },
  NodeByteAllowCustomProxy: { label: '允许用户自定义代理/加速节点', valueType: 'switch', defaultValue: true },

  // ---- 扩展 ----
  AllowUserSelfInstallExtension: { label: '允许用户手动安装扩展（crx/zip，含安卓）', valueType: 'switch', defaultValue: true },
  AllowUserUploadOwnExtension: { label: '允许用户上传自己的扩展到同步空间', valueType: 'switch', defaultValue: true },
  AllowUserUninstallForcedExt: { label: '允许卸载强制下发的扩展', valueType: 'switch', defaultValue: false },

  // ---- NodeByte 功能开关（是否允许类，默认放行）----
  NodeByteDropEnabled: { label: 'Drop 侧边栏', valueType: 'switch', defaultValue: true },
  NodeByteDropBackupAllowed: { label: 'Drop 备份到同步服务器', valueType: 'switch', defaultValue: true },
  NodeByteOfficeCollabEnabled: { label: 'Office 在线协作', valueType: 'switch', defaultValue: true },
  NodeByteWebPersonalEnabled: { label: '网页个人中心', valueType: 'switch', defaultValue: true },
  NodeByteReadLaterEnabled: { label: '稍后再看', valueType: 'switch', defaultValue: true },
  NodeByteEbookEnabled: { label: '电子书', valueType: 'switch', defaultValue: true },
  NodeByteEbookShareAllowed: { label: '电子书分享', valueType: 'switch', defaultValue: true },
  NodeByteReadAloudEnabled: { label: '朗读（Edge 在线 TTS）', valueType: 'switch', defaultValue: true },
  NodeBytePdfReadAloudEnabled: { label: 'PDF 阅读模式朗读', valueType: 'switch', defaultValue: true },
  NodeByteImportPasswordsAllowed: { label: '允许导入密码（CSV/浏览器）', valueType: 'switch', defaultValue: true },
  NodeByteImportHistoryAllowed: { label: '允许导入历史记录', valueType: 'switch', defaultValue: true },
  NodeByteImportBookmarksAllowed: { label: '允许导入书签', valueType: 'switch', defaultValue: true },
  NodeByteHomepageCustomizationAllowed: { label: '安卓主页自定义', valueType: 'switch', defaultValue: true },
  NodeByteSidebarCustomizationAllowed: { label: '桌面侧边栏自定义', valueType: 'switch', defaultValue: true },
  NodeByteOfflineGameEnabled: { label: '离线小游戏', valueType: 'switch', defaultValue: true },
  NodeByteAllowCustomSyncServer: { label: '允许修改同步服务器地址', valueType: 'switch', defaultValue: true },

  // ---- 翻译（开源免费翻译 API）----
  NodeByteTranslateEnabled: { label: '翻译功能（开源 API）', valueType: 'switch', defaultValue: true },
  NodeByteTranslateAllowAnonymous: { label: '允许未登录用户翻译', valueType: 'switch', defaultValue: false },
  NodeByteTranslateMaxChars: { label: '单次翻译字符上限', valueType: 'number', defaultValue: 5000 },

  // ---- TTS / 更新 / 扩展代理（上游服务，v1.4.2）----
  NodeByteTtsEnabled: { label: 'TTS 朗读（电子书/PDF，后端代理）', valueType: 'switch', defaultValue: true },
  NodeByteTtsMaxChars: { label: '单次 TTS 合成字符上限', valueType: 'number', defaultValue: 3000 },
  NodeByteUpdateCheckEnabled: { label: '允许客户端检查更新', valueType: 'switch', defaultValue: true },
  NodeByteExtProxyDownload: { label: '扩展商店经服务器代理下载', valueType: 'switch', defaultValue: true },

  // ---- 办公套件与高级打印（v1.4.4）----
  NodeByteOfficeSuiteEnabled: { label: '办公套件（nodebyte://office 写作/文档/演示/PDF）', valueType: 'switch', defaultValue: true },
  NodeByteOfficeAndroidEdit: { label: '安卓端办公编辑放开（默认仅预览）', valueType: 'switch', defaultValue: false },
  NodeBytePrintPanelEnabled: { label: '高级打印面板接管打印入口（关闭回原生）', valueType: 'switch', defaultValue: true },

  // ---- 地址 / 文本类 ----
  HomepageLocation: { label: '主页地址', valueType: 'text', defaultValue: '' },
  NodeByteSyncServerOverride: { label: '同步服务器地址（下发覆盖）', valueType: 'text', defaultValue: '' },

  // ---- 搜索引擎 ----
  DefaultSearchProviderEnabled: { label: '强制默认搜索引擎', valueType: 'switch', defaultValue: false },
  DefaultSearchProviderSearchURL: { label: '默认搜索引擎 URL', valueType: 'search_engine', compileDefault: COMPILE_DEFAULT_SEARCH_ENGINE }
};

/** 判断 key 是否已知（未知键允许下发，但 UI 提示并按 text 语义撤销） */
export function isKnownDirectiveKey(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(DIRECTIVE_REGISTRY, key);
}

/** 撤销语义文案（后台确认弹窗 / API 返回共用） */
export function revokeSemantics(valueType: DirectiveValueType, key: string): string {
  const meta = DIRECTIVE_REGISTRY[key];
  switch (valueType) {
    case 'switch':
      return `客户端将删除该开关的强制配置并恢复默认值：${meta?.label ?? key} → ${meta?.defaultValue === false ? '关闭' : '开启'}`;
    case 'search_engine':
      return `客户端搜索引擎将恢复为编译时默认搜索引擎（${meta?.compileDefault ?? COMPILE_DEFAULT_SEARCH_ENGINE}）`;
    default:
      return `客户端将清空该配置（${meta?.label ?? key}）并回退本地默认值`;
  }
}
