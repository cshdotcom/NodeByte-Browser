import type { MergedPolicy } from './policy';

/**
 * NodeByte 扩展策略键与默认值（客户端策略字典 docs/policy-dictionary.md）。
 *
 * 设计原则（用户需求）：
 *   - 一切「是否允许」默认放行（true），上游可通过 mandatory 显式拒绝；
 *   - 合并顺序：NodeByte 默认值 < 全局策略 < 用户组 < 用户 override，
 *     即上游任何一级显式配置都会覆盖这里的默认值；
 *   - 客户端 CloudOrgPolicyProvider 只认 mandatory；recommended 仅提示。
 */

export const NODEBYTE_POLICY_DEFAULTS: Record<string, unknown> = {
  // ---- Drop 侧边栏 ----
  NodeByteDropEnabled: true,
  // Drop 备份：是否允许把 Drop 文件/消息备份到同步服务器（默认允许，可被上游拒绝）
  NodeByteDropBackupAllowed: true,
  NodeByteDropBackupMaxMb: 512,

  // ---- 协作（Office 文档协作，非远程控制；桌面与安卓统一）----
  NodeByteOfficeCollabEnabled: true,
  NodeByteOfficeCollabMaxParticipants: 20,

  // ---- 协作会议（提示词附录 A 原名 AllowDropCollaboration；v1.4.5 落地）----
  // false = 多人协作整体关闭（协作会议 + 协作文档），仅保留多设备互通
  AllowDropCollaboration: true,

  // ---- 在线版个人中心（Web，无协作/无监控）----
  NodeByteWebPersonalEnabled: true,
  // 检测到自家浏览器（NodeByte UA）时才显示「打开侧边栏 Drop」入口
  NodeByteWebDetectOwnBrowser: true,

  // ---- 稍后再看（网页暂存）----
  NodeByteReadLaterEnabled: true,
  NodeByteReadLaterMaxItems: 1000,

  // ---- 电子书 ----
  NodeByteEbookEnabled: true,
  NodeByteEbookMaxSizeMb: 200,
  // 电子书分享（含有效期设置，0 = 不允许分享）
  NodeByteEbookShareAllowed: true,
  NodeByteEbookShareMaxHours: 720,
  // 朗读（Edge 在线公有云 TTS 服务）
  NodeByteReadAloudEnabled: true,
  NodeByteReadAloudProvider: 'edge', // edge | none
  // PDF 阅读模式 + 朗读
  NodeBytePdfReadAloudEnabled: true,

  // ---- 数据导入（其他浏览器 → NodeByte）----
  NodeByteImportPasswordsAllowed: true,
  NodeByteImportHistoryAllowed: true,
  NodeByteImportBookmarksAllowed: true,

  // ---- 界面定制 ----
  NodeByteHomepageCustomizationAllowed: true, // 安卓主页自定义
  NodeByteSidebarCustomizationAllowed: true,  // 桌面侧边栏自定义
  NodeByteOfflineGameEnabled: true,           // 离线小游戏入口

  // ---- 同步服务器 ----
  // 安卓端/桌面端是否允许用户修改同步服务器地址（默认允许，可被上游锁定）
  NodeByteAllowCustomSyncServer: true,
  NodeByteSyncServerFallback: '',             // 上游强制下发的主同步服务器（空 = 用户自由）

  // ---- 翻译（开源免费翻译 API：LibreTranslate / Lingva / MyMemory / DeepLX 等 15 种）----
  NodeByteTranslateEnabled: true,             // 翻译总开关（默认允许，可被上游拒绝）
  NodeByteTranslateAllowAnonymous: false,     // 是否允许未登录用户使用（默认仅登录用户）
  NodeByteTranslateMaxChars: 5000,            // 单次翻译字符上限

  // ---- TTS 朗读（后端代理：Edge TTS 自托管 / Azure / OpenAI 兼容）----
  NodeByteTtsEnabled: true,                   // 朗读总开关（电子书/PDF）
  NodeByteTtsMaxChars: 3000,                  // 单次合成字符上限

  // ---- 浏览器更新检查（后端 /api/client/update）----
  NodeByteUpdateCheckEnabled: true,           // 允许客户端检查更新（不指定时默认开启）

  // ---- 扩展商店代理下载（后端 /api/client/ext-download）----
  NodeByteExtProxyDownload: true,             // 允许经服务器代理下载商店扩展（false 回退直连）

  // ---- 办公套件与高级打印（v1.4.4，提示词 5.11）----
  NodeByteOfficeSuiteEnabled: true,           // 办公套件总开关（nodebyte://office）
  NodeByteOfficeAndroidEdit: false,           // 安卓端编辑放开（默认仅预览，平台差异）
  NodeBytePrintPanelEnabled: true,            // 高级打印面板接管打印入口（关闭回原生）
};

/** 把 NodeByte 默认值垫底合并进 mandatory（上游显式配置优先） */
export function applyNodeByteDefaults(mandatory: Record<string, unknown>): Record<string, unknown> {
  return { ...NODEBYTE_POLICY_DEFAULTS, ...mandatory };
}

/** 服务端业务校验用：从合并策略中读取布尔键（缺省取默认值） */
export function policyBool(mandatory: Record<string, unknown>, key: string): boolean {
  const v = mandatory[key] ?? NODEBYTE_POLICY_DEFAULTS[key];
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return v === 'true' || v === '1';
  return Boolean(v);
}

export function policyNumber(mandatory: Record<string, unknown>, key: string): number {
  const v = mandatory[key] ?? NODEBYTE_POLICY_DEFAULTS[key];
  const n = Number(v);
  return Number.isFinite(n) ? n : Number(NODEBYTE_POLICY_DEFAULTS[key] ?? 0);
}

export function policyString(mandatory: Record<string, unknown>, key: string): string {
  const v = mandatory[key] ?? NODEBYTE_POLICY_DEFAULTS[key];
  return typeof v === 'string' ? v : String(v ?? '');
}

/** 策略命中摘要（客户端调试 / Web 个人中心展示） */
export function summarizeForWeb(m: MergedPolicy): Record<string, unknown> {
  return {
    dropEnabled: policyBool(m.mandatory, 'NodeByteDropEnabled'),
    dropBackupAllowed: policyBool(m.mandatory, 'NodeByteDropBackupAllowed'),
    officeCollab: policyBool(m.mandatory, 'NodeByteOfficeCollabEnabled'),
    webPersonal: policyBool(m.mandatory, 'NodeByteWebPersonalEnabled'),
    detectOwnBrowser: policyBool(m.mandatory, 'NodeByteWebDetectOwnBrowser'),
    readLater: policyBool(m.mandatory, 'NodeByteReadLaterEnabled'),
    readLaterMaxItems: policyNumber(m.mandatory, 'NodeByteReadLaterMaxItems'),
    ebook: policyBool(m.mandatory, 'NodeByteEbookEnabled'),
    ebookMaxSizeMb: policyNumber(m.mandatory, 'NodeByteEbookMaxSizeMb'),
    ebookShare: policyBool(m.mandatory, 'NodeByteEbookShareAllowed'),
    ebookShareMaxHours: policyNumber(m.mandatory, 'NodeByteEbookShareMaxHours'),
    readAloud: policyBool(m.mandatory, 'NodeByteReadAloudEnabled'),
    readAloudProvider: policyString(m.mandatory, 'NodeByteReadAloudProvider'),
    pdfReadAloud: policyBool(m.mandatory, 'NodeBytePdfReadAloudEnabled'),
    importPasswords: policyBool(m.mandatory, 'NodeByteImportPasswordsAllowed'),
    importHistory: policyBool(m.mandatory, 'NodeByteImportHistoryAllowed'),
    importBookmarks: policyBool(m.mandatory, 'NodeByteImportBookmarksAllowed'),
    homepageCustom: policyBool(m.mandatory, 'NodeByteHomepageCustomizationAllowed'),
    sidebarCustom: policyBool(m.mandatory, 'NodeByteSidebarCustomizationAllowed'),
    offlineGame: policyBool(m.mandatory, 'NodeByteOfflineGameEnabled'),
    allowCustomSyncServer: policyBool(m.mandatory, 'NodeByteAllowCustomSyncServer'),
    translateEnabled: policyBool(m.mandatory, 'NodeByteTranslateEnabled'),
    translateAllowAnonymous: policyBool(m.mandatory, 'NodeByteTranslateAllowAnonymous'),
    translateMaxChars: policyNumber(m.mandatory, 'NodeByteTranslateMaxChars'),
    ttsEnabled: policyBool(m.mandatory, 'NodeByteTtsEnabled'),
    ttsMaxChars: policyNumber(m.mandatory, 'NodeByteTtsMaxChars'),
    updateCheckEnabled: policyBool(m.mandatory, 'NodeByteUpdateCheckEnabled'),
    extProxyDownload: policyBool(m.mandatory, 'NodeByteExtProxyDownload'),
    officeSuite: policyBool(m.mandatory, 'NodeByteOfficeSuiteEnabled'),
    officeAndroidEdit: policyBool(m.mandatory, 'NodeByteOfficeAndroidEdit'),
    printPanel: policyBool(m.mandatory, 'NodeBytePrintPanelEnabled'),
  };
}
