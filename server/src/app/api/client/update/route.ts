import { q1 } from '@/lib/db';
import { CODE, ok, err } from '@/lib/status';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * 浏览器更新检查（先连后端 → 后台配置的更新源/版本清单）
 *
 * GET /api/client/update?platform=win|linux|android&arch=x64|arm64&version=<current>
 *   → { updateAvailable, latestVersion, downloadUrl, mandatory, notes }
 *
 * 可塑性：客户端升级检查永远指向「当前同步服务器地址」的此路径，
 * 同步服务器切换后自动跟随。后台在「上游服务 → 更新源」中配置版本清单
 * （system_setting.update_config），也可留空 = 无更新。
 */

interface UpdateConfig {
  enabled: boolean;
  /** 手工维护的最新版本（后台填） */
  latestVersion: string;
  /** 各平台下载地址（后台填，可指向内网文件服务器 / CNB / GitHub Releases 镜像） */
  downloadUrls: Record<string, string>;
  /** 是否强制更新（客户端提示不可跳过） */
  mandatory: boolean;
  /** 更新说明 */
  notes: string;
  /** 可选：上游 manifest JSON URL（后台配置后服务端每次请求时拉取转发，适合已有更新服务器场景） */
  upstreamManifestUrl: string;
}

const EMPTY: UpdateConfig = { enabled: false, latestVersion: '', downloadUrls: {}, mandatory: false, notes: '', upstreamManifestUrl: '' };

async function loadConfig(): Promise<UpdateConfig> {
  const row = await q1<{ setting_value: unknown }>(
    `SELECT setting_value FROM system_setting WHERE setting_key = 'update_config'`
  );
  if (!row) return EMPTY;
  const v = row.setting_value as Partial<UpdateConfig>;
  return {
    enabled: typeof v.enabled === 'boolean' ? v.enabled : false,
    latestVersion: typeof v.latestVersion === 'string' ? v.latestVersion : '',
    downloadUrls: v.downloadUrls && typeof v.downloadUrls === 'object' ? (v.downloadUrls as Record<string, string>) : {},
    mandatory: typeof v.mandatory === 'boolean' ? v.mandatory : false,
    notes: typeof v.notes === 'string' ? v.notes : '',
    upstreamManifestUrl: typeof v.upstreamManifestUrl === 'string' ? v.upstreamManifestUrl : '',
  };
}

export async function GET(req: Request) {
  const cfg = await loadConfig();
  if (!cfg.enabled) return ok({ updateAvailable: false });

  const url = new URL(req.url);
  const platform = (url.searchParams.get('platform') || '').toLowerCase(); // win/linux/android
  const arch = (url.searchParams.get('arch') || '').toLowerCase();
  const currentVersion = url.searchParams.get('version') || '';

  // 模式 A：上游 manifest 转发（后台配置了 upstreamManifestUrl）
  if (cfg.upstreamManifestUrl) {
    try {
      const r = await fetch(cfg.upstreamManifestUrl, { signal: AbortSignal.timeout(8000) });
      if (r.ok) {
        const manifest = await r.json() as Record<string, unknown>;
        return ok({ updateAvailable: true, ...(manifest as object) });
      }
    } catch {
      // 上游不可达 → 回退到手工配置
    }
  }

  // 模式 B：手工版本清单
  const latest = cfg.latestVersion.replace(/^v/, '');
  const downloadUrl = cfg.downloadUrls[`${platform}-${arch}`] ?? cfg.downloadUrls[platform] ?? '';
  const cmp = compareVersions(currentVersion, latest);
  return ok({
    updateAvailable: !!latest && cmp < 0,
    latestVersion: latest,
    downloadUrl,
    mandatory: cfg.mandatory,
    notes: cfg.notes,
    platform, arch,
  });
}

/** 语义化版本比较（1.2.10 > 1.2.9） */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((x) => parseInt(x, 10) || 0);
  const pb = b.split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}
