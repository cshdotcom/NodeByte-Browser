import { authAdmin } from '@/lib/auth';
import { ok, err, CODE } from '@/lib/status';
import { parseImportCsv, MAX_CSV_BYTES, IMPORT_TYPES, type ImportType } from '@/lib/csv';
import { adminAudit, clientIp } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/import （multipart/form-data: file, type）
 * 管理端批量导入 · 第一步：解析与预览（不落库）。
 * 返回列映射、行数统计、告警与前 10 条预览；确认后调用 /api/admin/import/apply。
 */
export async function POST(req: Request) {
  const admin = await authAdmin(req);
  if (admin instanceof Response) return admin;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return err(CODE.BAD_REQUEST, '需要 multipart/form-data 编码（file + type）');
  }
  const type = String(form.get('type') ?? '') as ImportType;
  if (!IMPORT_TYPES.includes(type)) return err(CODE.BAD_REQUEST, `不支持的数据类型（可选: ${IMPORT_TYPES.join(' / ')}）`);

  const file = form.get('file');
  if (!(file instanceof File)) return err(CODE.BAD_REQUEST, '缺少 CSV 文件（file 字段）');
  if (file.size > MAX_CSV_BYTES) return err(CODE.BAD_REQUEST, `文件过大（上限 ${Math.floor(MAX_CSV_BYTES / 1024 / 1024)}MB）`);
  const text = await file.text();
  const parsed = parseImportCsv(type, text);

  await adminAudit({
    adminUserId: admin.userId,
    operateType: 'admin_verify',
    detail: { action: 'import_preview', type, fileName: file.name, validRows: parsed.validRows },
    ip: clientIp(req)
  }).catch(() => undefined);

  return ok({
    type,
    fileName: file.name,
    fileSize: file.size,
    totalRows: parsed.totalRows,
    validRows: parsed.validRows,
    warnings: parsed.warnings,
    mapping: parsed.mapping,
    preview: parsed.preview
  });
}
