import { q1 } from '@/lib/db';
import { CODE, ok, err, readJson } from '@/lib/status';
import { authAdmin } from '@/lib/auth';
import { adminAudit, clientIp } from '@/lib/audit';
import {
  DEFAULT_OFFICE_SETTINGS,
  validateOfficeSettings,
  type OfficeSettings,
} from '@/lib/office';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * 管理后台 - 办公套件 / 高级打印配置
 *
 * GET /api/admin/office-config  — 当前配置
 * PUT /api/admin/office-config  — 覆盖保存
 *     enabled            办公套件总开关（NodeByteOfficeSuiteEnabled 镜像）
 *     editOnAndroid      安卓端编辑放开（NodeByteOfficeAndroidEdit，默认关）
 *     printPanelEnabled  打印面板接管（NodeBytePrintPanelEnabled，默认开）
 *     wasmUrl            LibreOffice WASM 完整编辑引擎资源地址（按需加载）
 *     maxUploadMb        预留服务端辅助转换上限（当前客户端本地处理）
 */

export async function GET(req: Request) {
  const admin = await authAdmin(req);
  if (admin instanceof Response) return admin;
  const row = await q1<{ setting_value: unknown }>(
    `SELECT setting_value FROM system_setting WHERE setting_key = 'office_config'`
  );
  const settings =
    (row ? validateOfficeSettings(row.setting_value) : null) ??
    DEFAULT_OFFICE_SETTINGS;
  return ok({ settings });
}

export async function PUT(req: Request) {
  const admin = await authAdmin(req);
  if (admin instanceof Response) return admin;
  const body = await readJson<OfficeSettings>(req);
  const validated = validateOfficeSettings(body);
  if (!validated) return err(CODE.BAD_REQUEST, '办公/打印配置格式不合法');

  await q1(
    `INSERT INTO system_setting (setting_key, setting_value) VALUES ('office_config', $1::jsonb)
     ON CONFLICT (setting_key) DO UPDATE SET setting_value = $1::jsonb`,
    [JSON.stringify(validated)]
  );
  await adminAudit({
    adminUserId: admin.userId,
    operateType: 'modify_system_setting',
    detail: {
      key: 'office_config',
      enabled: validated.enabled,
      editOnAndroid: validated.editOnAndroid,
      printPanelEnabled: validated.printPanelEnabled,
      wasmConfigured: !!validated.wasmUrl,
    },
    ip: clientIp(req),
  });
  return ok(null, '办公/打印配置已保存');
}
