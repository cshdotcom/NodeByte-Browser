import { q1 } from '@/lib/db';
import { CODE, ok, err } from '@/lib/status';
import {
  DEFAULT_OFFICE_SETTINGS,
  clientView,
  validateOfficeSettings,
  type OfficeSettings,
} from '@/lib/office';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * 客户端 - 办公套件 / 打印面板配置（提示词 5.11；可塑性铁律）
 *
 * GET /api/client/office-config
 * 无需登录（办公页支持未登录本地打开文件；本接口不含任何敏感字段）。
 * 返回 clientView(OfficeSettings)：enabled / editOnAndroid /
 * printPanelEnabled / wasmUrl / maxUploadMb。
 */

export async function GET() {
  const row = await q1<{ setting_value: unknown }>(
    `SELECT setting_value FROM system_setting WHERE setting_key = 'office_config'`
  );
  if (!row) return ok(clientView(DEFAULT_OFFICE_SETTINGS));
  const settings: OfficeSettings =
    validateOfficeSettings(row.setting_value) ?? DEFAULT_OFFICE_SETTINGS;
  // 总开关关闭：客户端隐藏办公/打印入口（wasmUrl 等细节不再下发）
  if (!settings.enabled) return ok({ enabled: false });
  return ok(clientView(settings));
}
