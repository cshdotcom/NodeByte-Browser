import { authAdmin } from '@/lib/auth';
import { ok, err, CODE } from '@/lib/status';
import { parseImportCsv, MAX_CSV_BYTES, IMPORT_TYPES, type ImportType } from '@/lib/csv';
import { applyImport } from '@/lib/imports';
import { adminAudit, clientIp } from '@/lib/audit';
import { emitToWs } from '@/lib/push';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/import/apply （multipart/form-data）
 *   file      : CSV 文件（与预览相同的文件）
 *   type      : passwords | bookmarks | history
 *   mode      : merge（默认，追加合并）| replace（清空该类型待下发区后写入）
 *   targets   : JSON 字符串 —— {"userIds":[...]} | {"groupIds":[...]} | {"allUsers":true}
 *
 * 管理员可批量选择一个或多个用户导入密码/书签/历史记录；批量操作落审计。
 * 写入「待下发导入区」后对目标用户发 policy_update 式刷新通知（客户端拉取 /api/sync/imported）。
 */
export async function POST(req: Request) {
  const admin = await authAdmin(req);
  if (admin instanceof Response) return admin;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return err(CODE.BAD_REQUEST, '需要 multipart/form-data 编码（file + type + mode + targets）');
  }
  const type = String(form.get('type') ?? '') as ImportType;
  if (!IMPORT_TYPES.includes(type)) return err(CODE.BAD_REQUEST, `不支持的数据类型（可选: ${IMPORT_TYPES.join(' / ')}）`);
  const mode = String(form.get('mode') ?? 'merge') === 'replace' ? 'replace' : 'merge';

  let targets: Record<string, unknown>;
  try {
    targets = JSON.parse(String(form.get('targets') ?? '{}')) as Record<string, unknown>;
  } catch {
    return err(CODE.BAD_REQUEST, 'targets 必须是 JSON 字符串');
  }

  const file = form.get('file');
  if (!(file instanceof File)) return err(CODE.BAD_REQUEST, '缺少 CSV 文件（file 字段）');
  if (file.size > MAX_CSV_BYTES) return err(CODE.BAD_REQUEST, `文件过大（上限 ${Math.floor(MAX_CSV_BYTES / 1024 / 1024)}MB）`);
  if (file.size === 0) return err(CODE.BAD_REQUEST, 'CSV 文件为空');

  const parsed = parseImportCsv(type, await file.text());
  if (parsed.validRows === 0) return err(CODE.BAD_REQUEST, `没有可导入的有效行：${parsed.warnings[0] ?? 'CSV 内容为空'}`);

  const targetsJson = targets as { userIds?: string[]; groupIds?: string[]; allUsers?: boolean };
  const normalizedTargets = targetsJson.allUsers === true
    ? { allUsers: true as const }
    : Array.isArray(targetsJson.groupIds) && targetsJson.groupIds.length > 0
      ? { groupIds: targetsJson.groupIds }
      : { userIds: Array.isArray(targetsJson.userIds) ? targetsJson.userIds : [] };

  try {
    const result = await applyImport({
      type,
      mode,
      source: 'admin_csv',
      rows: parsed.rows,
      targets: normalizedTargets,
      importedBy: admin.userId,
      fileName: file.name
    });

    await adminAudit({
      adminUserId: admin.userId,
      operateType: 'import_data_to_users',
      detail: {
        batchId: result.batchId, type, mode, targets: result.targets,
        rowsPerUser: result.rowsPerUser, totalRows: result.totalRows, fileName: file.name
      },
      ip: clientIp(req)
    }).catch(() => undefined);

    // 通知在线设备刷新导入区
    await emitToWs({ type: 'policy_update', data: { reason: 'import_data', dataType: type, batchId: result.batchId } });

    return ok(result, `导入完成：${result.targets} 个用户 × ${result.rowsPerUser} 条${mode === 'replace' ? '（覆盖模式）' : ''}`);
  } catch (e) {
    return err(CODE.BAD_REQUEST, e instanceof Error ? e.message : '导入失败');
  }
}
