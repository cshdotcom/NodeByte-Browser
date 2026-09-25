import { q, q1 } from '@/lib/db';
import { CODE, ok, err, readJson } from '@/lib/status';
import { authAdmin } from '@/lib/auth';
import { BUCKET, presignPut } from '@/lib/minio';
import { adminAudit, clientIp } from '@/lib/audit';
import { randomToken } from '@/lib/crypto';
import { emitToWs } from '@/lib/push';

export const dynamic = 'force-dynamic';

/**
 * 扩展管理（服务端提示词 5.7）：
 * GET  /api/admin/extensions — 列出扩展池 + 强制下发 + 安装结果日志
 * POST /api/admin/extensions
 *   { action:'register_package', extId, size } → 上传 URL（crx/zip 入 extension-pool，占用系统公共存储）
 *   { action:'confirm_package', extId, objectKey, size }
 *   { action:'force_assign', extId, source, downloadUrl?, targetUserIds?, targetGroupIds?, allowUninstall? }
 *   { action:'remove_force', id }
 *   { action:'install_log', userId, extId, downloadSource, resultStatus, errorDetail?, deviceId? }
 */
export async function GET(req: Request) {
  const admin = await authAdmin(req);
  if (admin instanceof Response) return admin;
  const pool = await q(`SELECT * FROM extension_pool ORDER BY created_at DESC`);
  const forced = await q(
    `SELECT f.*, u.username AS target_username, g.group_name AS target_group_name
       FROM forced_extension f
       LEFT JOIN users u ON u.user_id = f.target_user_id
       LEFT JOIN user_group g ON g.group_id = f.target_group_id
      WHERE f.is_active = true ORDER BY f.created_at DESC`
  );
  const logs = await q(
    `SELECT l.*, u.username, u.email FROM extension_install_log l
       LEFT JOIN users u ON u.user_id = l.user_id
      ORDER BY l.created_at DESC LIMIT 200`
  );
  return ok({ pool: pool.rows, forced: forced.rows, logs: logs.rows });
}

export async function POST(req: Request) {
  const admin = await authAdmin(req);
  if (admin instanceof Response) return admin;
  const body = await readJson<{
    action?: string; extId?: string; size?: number; objectKey?: string;
    source?: 'cache_internal' | 'external_store' | 'package'; downloadUrl?: string;
    targetUserIds?: string[]; targetGroupIds?: string[]; allowUninstall?: boolean;
    userId?: string; userGroupId?: string; downloadSource?: string; resultStatus?: string; errorDetail?: string; deviceId?: string;
  }>(req);

  switch (body?.action) {
    case 'register_package': {
      if (!body.extId) return err(CODE.BAD_REQUEST, '缺少 extId');
      const objectKey = `pool/${body.extId}-${randomToken(8)}.crx`;
      const url = await presignPut(BUCKET.ext, objectKey).catch(() => null);
      if (!url) return err(500, '对象存储不可用');
      return ok({ extId: body.extId, objectKey, uploadUrl: url });
    }
    case 'confirm_package': {
      if (!body.extId || !body.objectKey) return err(CODE.BAD_REQUEST, '缺少 extId/objectKey');
      await q(
        `INSERT INTO extension_pool (ext_id, package_object_key, file_size_bytes, uploaded_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (ext_id) DO UPDATE SET package_object_key = $2, file_size_bytes = $3`,
        [body.extId, body.objectKey, Number(body.size ?? 0), admin.userId]
      );
      await adminAudit({ adminUserId: admin.userId, operateType: 'upload_extension_package', detail: { extId: body.extId }, ip: clientIp(req) });
      return ok(null, '扩展包已入库（系统公共存储）');
    }
    case 'force_assign': {
      if (!body.extId || !body.source) return err(CODE.BAD_REQUEST, '缺少 extId/source');
      const targets = [
        ...(body.targetUserIds ?? []).map((id) => ({ userId: id, groupId: null })),
        ...(body.targetGroupIds ?? []).map((id) => ({ userId: null, groupId: id }))
      ];
      if (targets.length === 0) return err(CODE.BAD_REQUEST, '请至少选择一个目标用户或用户组');
      for (const t of targets) {
        await q(
          `INSERT INTO forced_extension (ext_id, source, download_url, allow_uninstall, target_user_id, target_group_id)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [body.extId, body.source, body.downloadUrl ?? null, body.allowUninstall ?? false, t.userId, t.groupId]
        );
        if (t.userId) await emitToWs({ type: 'policy_update', userId: t.userId, data: {} });
      }
      await adminAudit({ adminUserId: admin.userId, operateType: 'assign_forced_extension', detail: { extId: body.extId, count: targets.length }, ip: clientIp(req) });
      return ok({ assigned: targets.length });
    }
    case 'remove_force': {
      await q(`UPDATE forced_extension SET is_active = false WHERE id = $1`, [body.extId]);
      await adminAudit({ adminUserId: admin.userId, operateType: 'remove_forced_extension', detail: { id: body.extId }, ip: clientIp(req) });
      return ok(null, '已移除强制下发（客户端将在下次策略刷新后自动卸载）');
    }
    case 'install_log': {
      await q(
        `INSERT INTO extension_install_log (user_id, user_group_id, ext_id, download_source, result_status, error_detail, device_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [body.userId ?? null, body.userGroupId ?? null, body.extId ?? '', body.downloadSource ?? '', body.resultStatus ?? '', body.errorDetail ?? null, body.deviceId ?? null]
      );
      await adminAudit({ adminUserId: admin.userId, operateType: 'extension_install_result', detail: { extId: body.extId, status: body.resultStatus }, ip: clientIp(req) });
      return ok({ logged: true });
    }
    default:
      return err(CODE.BAD_REQUEST, '未知操作');
  }
}
