import { q1 } from '@/lib/db';
import { CODE, ok, err } from '@/lib/status';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * 扩展商店代理下载（先连后端 → 后台配置的商店镜像/直连）
 *
 * GET /api/client/ext-download?store=edge|chromeweb&extId=<extension-id>
 *   → 302 重定向到解析后的下载地址（或流式转发 crx）
 *
 * 作用（docs/upstream-services.md）：
 *   1) 客户端不直连 Edge/Chrome 商店 —— 组织内网可能无法出公网，由服务器统一出口；
 *   2) 后台可配置镜像站（内地镜像/内网镜像），解决商店不可达；
 *   3) 下载行为统一审计（extension_install_result 已有客户端上报，服务端补 download 侧）。
 *
 * 策略 NodeByteExtProxyDownload=false → 返回 40303，客户端回退直连官方商店。
 */

interface ExtDownloadConfig {
  enabled: boolean;
  /** true = 经服务端代理（302/流式）；false = 客户端直连官方商店 */
  proxyEnabled: boolean;
  /** Edge 商店镜像模板，{extId} 占位；留空 = 官方 */
  edgeMirror: string;
  /** Chrome 商店镜像模板，{extId} 占位；留空 = 官方 */
  chromeMirror: string;
}

const OFFICIAL = {
  edge: (id: string) => `https://edge.microsoft.com/extensionwebstorebase/v1/crx?response=redirect&prod=chromiumcrx&prodchannel=&x=id%3D${id}%26installsource%3Dondemand%26uc`,
  chromeweb: (id: string) => `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=126.0&acceptformat=crx2,crx3&x=id%3D${id}%26uc`,
};

async function loadConfig(): Promise<ExtDownloadConfig> {
  const row = await q1<{ setting_value: unknown }>(
    `SELECT setting_value FROM system_setting WHERE setting_key = 'ext_download_config'`
  );
  if (!row) return { enabled: false, proxyEnabled: false, edgeMirror: '', chromeMirror: '' };
  const v = row.setting_value as Partial<ExtDownloadConfig>;
  return {
    enabled: typeof v.enabled === 'boolean' ? v.enabled : false,
    proxyEnabled: typeof v.proxyEnabled === 'boolean' ? v.proxyEnabled : false,
    edgeMirror: typeof v.edgeMirror === 'string' ? v.edgeMirror : '',
    chromeMirror: typeof v.chromeMirror === 'string' ? v.chromeMirror : '',
  };
}

export async function GET(req: Request) {
  const cfg = await loadConfig();
  const url = new URL(req.url);
  const store = (url.searchParams.get('store') || 'edge').toLowerCase();
  const extId = (url.searchParams.get('extId') || '').trim();

  if (!cfg.enabled || !cfg.proxyEnabled) {
    return err(CODE.NO_PERMISSION, '扩展商店代理未启用（客户端将回退直连官方商店）');
  }
  if (!/^[a-p]{32}$/i.test(extId)) {
    return err(CODE.BAD_REQUEST, 'extId 格式不合法（32 位字母）');
  }

  let target: string;
  if (store === 'edge') {
    target = cfg.edgeMirror ? cfg.edgeMirror.replace(/\{extId\}/g, encodeURIComponent(extId)) : OFFICIAL.edge(extId);
  } else if (store === 'chromeweb') {
    target = cfg.chromeMirror ? cfg.chromeMirror.replace(/\{extId\}/g, encodeURIComponent(extId)) : OFFICIAL.chromeweb(extId);
  } else {
    return err(CODE.BAD_REQUEST, 'store 仅支持 edge / chromeweb');
  }

  return ok({ redirectUrl: target, store, extId });
}
