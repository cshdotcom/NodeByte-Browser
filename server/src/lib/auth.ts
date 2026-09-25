import { q1 } from './db';
import { CODE, err } from './status';
import { jwtVerify } from './crypto';

/**
 * 请求鉴权链（服务端提示词 附录D.1，后端不信任前端铁律）：
 *   JWT 有效 → 账号 active 且未过期 → 2FA 绑定态满足（Require2FA 时）
 *   → 功能黑白名单（用户组 feature_policy）→ 业务执行
 *
 * 返回值约定：失败时直接返回 Response（业务码 401/40301/40302/40303）。
 */

export type AuthedUser = {
  userId: string;
  email: string;
  username: string;
  isAdmin: boolean;
  groupId: string | null;
  totpEnabled: boolean;
  overridePolicyJson: Record<string, unknown> | null;
  jwtPayload: { sub: string; deviceId?: string; admin?: boolean; exp: number };
};

type UserRow = {
  user_id: string;
  email: string;
  username: string;
  is_admin: boolean;
  group_id: string | null;
  totp_enabled: boolean;
  account_status: 'active' | 'disabled' | 'banned';
  account_expire_at: Date | null;
  override_policy_json: Record<string, unknown> | null;
};

function extractToken(req: Request): string | null {
  const auth = req.headers.get('authorization');
  if (auth?.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  // Web 前台使用 httpOnly cookie
  const cookie = req.headers.get('cookie') ?? '';
  const m = cookie.match(/(?:^|;\s*)nb_token=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export async function authUser(req: Request): Promise<AuthedUser | Response> {
  const token = extractToken(req);
  if (!token) return err(CODE.UNAUTHORIZED, '未登录或令牌缺失');
  const payload = jwtVerify(token);
  if (!payload) return err(CODE.UNAUTHORIZED, '令牌无效或已过期');

  const u = await q1<UserRow>(`SELECT * FROM users WHERE user_id = $1`, [payload.sub]);
  if (!u) return err(CODE.UNAUTHORIZED, '账号不存在');

  // 账号状态与有效期（服务端判断，过期判断必须服务端完成）
  if (u.account_status === 'banned' || u.account_status === 'disabled')
    return err(CODE.ACCOUNT_DISABLED, u.account_status === 'banned' ? '账号已封禁' : '账号已禁用');
  if (u.account_expire_at && new Date(u.account_expire_at).getTime() < Date.now())
    return err(CODE.ACCOUNT_DISABLED, '账号已过期');

  // 设备吊销检查（浏览器客户端携带 deviceId）
  if (payload.deviceId) {
    const d = await q1<{ is_revoked: boolean }>(
      `SELECT is_revoked FROM user_devices WHERE device_id = $1 AND user_id = $2`,
      [payload.deviceId, u.user_id]
    );
    if (d?.is_revoked) return err(CODE.ACCOUNT_DISABLED, '设备已被吊销');
  }

  return {
    userId: u.user_id,
    email: u.email,
    username: u.username,
    isAdmin: u.is_admin,
    groupId: u.group_id,
    totpEnabled: u.totp_enabled,
    overridePolicyJson: u.override_policy_json,
    jwtPayload: payload
  };
}

/** 要求已绑定 2FA（策略 CustomRequire2FA 生效时）：未绑定 → 40301 */
export async function require2faBound(user: AuthedUser): Promise<Response | null> {
  const { getRequire2fa } = await import('./policy2fa');
  const require2fa = await getRequire2fa(user.userId);
  if (require2fa && !user.totpEnabled) {
    return err(CODE.NEED_BIND_2FA, '需要绑定 2FA 后才能使用该功能');
  }
  return null;
}

/** 功能黑白名单（用户组 feature_policy）：enabled=false → 40303 */
export async function requireFeature(user: AuthedUser, featureKey: string): Promise<Response | null> {
  if (!user.groupId) return null; // 无组用户走全局默认（默认允许）
  const r = await q1<{ enabled: boolean }>(
    `SELECT enabled FROM user_group_feature_policy WHERE group_id = $1 AND feature_key = $2`,
    [user.groupId, featureKey]
  );
  if (r && !r.enabled) return err(CODE.NO_PERMISSION, `功能已被组织管理员关闭: ${featureKey}`);
  return null;
}

/** 管理员鉴权 */
export async function authAdmin(req: Request): Promise<AuthedUser | Response> {
  const u = await authUser(req);
  if (u instanceof Response) return u;
  if (!u.isAdmin) return err(CODE.NO_PERMISSION, '需要管理员权限');
  return u;
}

/** 管理员二次鉴权会话校验（查看用户私有文件，15 分钟有效、绑定 target_user_id、不能跨用户） */
export async function requireAdminSession(
  req: Request,
  targetUserId: string | null
): Promise<Response | null> {
  const token = req.headers.get('x-admin-session') ?? '';
  if (!token) return err(CODE.NO_PERMISSION, '需要管理员二次鉴权（输入管理员密码）');
  const s = await q1<{ id: string; target_user_id: string | null; valid_until: Date }>(
    `SELECT id, target_user_id, valid_until FROM admin_session WHERE id = $1`,
    [token]
  );
  if (!s || new Date(s.valid_until).getTime() < Date.now())
    return err(CODE.NO_PERMISSION, '二次鉴权会话无效或已过期，请重新验证');
  if (targetUserId && s.target_user_id && s.target_user_id !== targetUserId)
    return err(CODE.NO_PERMISSION, '二次鉴权会话与目标用户不匹配（不能跨用户）');
  return null;
}
