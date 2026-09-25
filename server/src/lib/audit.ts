import { q } from './db';

/**
 * 审计（服务端提示词 5.8.3 / 约束10.3）：
 *  - admin_audit_log：管理员敏感操作，数据库触发器禁止 UPDATE/DELETE；
 *  - user_security_log：账号安全日志（登录/改密/2FA/同步等），个人中心可查。
 */

export type AuditOp =
  | 'create_user' | 'modify_user_info' | 'reset_user_password' | 'ban_user' | 'unban_user'
  | 'disable_account' | 'modify_user_quota' | 'modify_user_override_policy' | 'modify_user_groups'
  | 'reset_user_2fa' | 'revoke_device_admin' | 'view_user_files' | 'download_file' | 'delete_file'
  | 'delete_user' | 'reset_policy' | 'push_tab_to_user' | 'share_session_context_to_other_user'
  | 'share_session_revoke' | 'extension_install_result' | 'admin_verify' | 'create_group'
  | 'modify_group' | 'delete_group' | 'create_policy_set' | 'modify_policy_set' | 'delete_policy_set'
  | 'upload_extension_package' | 'assign_forced_extension' | 'remove_forced_extension'
  | 'import_data_to_users' | 'create_policy_directive' | 'revoke_policy_directive'
  | 'modify_system_setting' | 'collab_moderation' | 'admin_login';

export async function adminAudit(params: {
  adminUserId: string;
  targetUserId?: string | null;
  operateType: AuditOp;
  targetFileId?: string | null;
  detail?: Record<string, unknown>;
  ip?: string | null;
}): Promise<void> {
  await q(
    `INSERT INTO admin_audit_log (admin_user_id, operate_target_user, operate_type, target_file_id, detail, ip_address)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
    [
      params.adminUserId,
      params.targetUserId ?? null,
      params.operateType,
      params.targetFileId ?? null,
      JSON.stringify(params.detail ?? {}),
      params.ip ?? null
    ]
  );
}

export async function userSecurityLog(params: {
  userId: string;
  eventType: string;
  detail?: Record<string, unknown>;
  ip?: string | null;
}): Promise<void> {
  await q(
    `INSERT INTO user_security_log (user_id, event_type, detail, ip_address)
     VALUES ($1, $2, $3::jsonb, $4)`,
    [params.userId, params.eventType, JSON.stringify(params.detail ?? {}), params.ip ?? null]
  );
}

export function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? '';
}
