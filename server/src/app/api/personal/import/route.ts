import { authUser, require2faBound } from '@/lib/auth';
import { ok, err, CODE } from '@/lib/status';
import { parseImportCsv, MAX_CSV_BYTES, IMPORT_TYPES, type ImportType } from '@/lib/csv';
import { applyImport } from '@/lib/imports';
import { userSecurityLog, clientIp } from '@/lib/audit';
import { getUsedBytes, getEffectiveQuotaMb } from '@/lib/quota';

export const dynamic = 'force-dynamic';

/**
 * POST /api/personal/import （multipart/form-data: file, type, mode?）
 * 个人中心 / 前台自助导入：CSV 只能导入到**自己**的账号。
 * 与管理端共用解析与执行引擎；source=self_csv，全部操作写用户安全日志。
 */
export async function POST(req: Request) {
  const u = await authUser(req);
  if (u instanceof Response) return u;
  const t = await require2faBound(u);
  if (t) return t;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return err(CODE.BAD_REQUEST, '需要 multipart/form-data 编码（file + type）');
  }
  const type = String(form.get('type') ?? '') as ImportType;
  if (!IMPORT_TYPES.includes(type)) return err(CODE.BAD_REQUEST, `不支持的数据类型（可选: ${IMPORT_TYPES.join(' / ')}）`);
  const mode = String(form.get('mode') ?? 'merge') === 'replace' ? 'replace' : 'merge';

  const file = form.get('file');
  if (!(file instanceof File)) return err(CODE.BAD_REQUEST, '缺少 CSV 文件（file 字段）');
  if (file.size > MAX_CSV_BYTES) return err(CODE.BAD_REQUEST, `文件过大（上限 ${Math.floor(MAX_CSV_BYTES / 1024 / 1024)}MB）`);
  if (file.size === 0) return err(CODE.BAD_REQUEST, 'CSV 文件为空');

  const parsed = parseImportCsv(type, await file.text());
  if (parsed.validRows === 0) return err(CODE.BAD_REQUEST, `没有可导入的有效行：${parsed.warnings[0] ?? 'CSV 内容为空'}`);

  // 导入数据计入个人云配额（估算：每行 256 字节 + 文件本体计入审计，密码为密文存储）
  const estBytes = parsed.validRows * 256;
  const [quotaMb, usedBytes] = await Promise.all([getEffectiveQuotaMb(u.userId), getUsedBytes(u.userId)]);
  if (usedBytes + estBytes > quotaMb * 1024 * 1024) return err(CODE.QUOTA_EXCEEDED, '存储空间已满，导入被拒绝');

  try {
    const result = await applyImport({
      type,
      mode,
      source: 'self_csv',
      rows: parsed.rows,
      targets: [u.userId],
      importedBy: u.userId,
      fileName: file.name,
      selfOnly: true
    });
    await userSecurityLog({
      userId: u.userId,
      eventType: 'self_import_data',
      detail: { batchId: result.batchId, type, mode, rows: result.rowsPerUser, fileName: file.name },
      ip: clientIp(req)
    }).catch(() => undefined);
    return ok(result, `导入完成：${result.rowsPerUser} 条数据已进入「待下发区」，登录浏览器后将自动同步到本机`);
  } catch (e) {
    return err(CODE.BAD_REQUEST, e instanceof Error ? e.message : '导入失败');
  }
}

/** GET：列出自己账号当前待下发的导入数据概览 */
export async function GET(req: Request) {
  const u = await authUser(req);
  if (u instanceof Response) return u;
  const t = await require2faBound(u);
  if (t) return t;

  const { q } = await import('@/lib/db');
  const r = await q<{ data_type: string; n: string }>(
    `SELECT 'passwords' AS data_type, COUNT(*)::text AS n FROM user_imported_passwords WHERE user_id=$1
     UNION ALL SELECT 'bookmarks', COUNT(*)::text FROM user_imported_bookmarks WHERE user_id=$1
     UNION ALL SELECT 'history', COUNT(*)::text FROM user_imported_history WHERE user_id=$1`,
    [u.userId]
  );
  return ok({ pending: Object.fromEntries(r.rows.map((x) => [x.data_type, Number(x.n)])) });
}
