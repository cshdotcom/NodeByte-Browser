import { CODE, ok, err } from '@/lib/status';
import { authUser, require2faBound } from '@/lib/auth';
import { buildMergedPolicy } from '@/lib/policy';
import { q, q1 } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/client/policy?deviceId=xxx   （服务端提示词 7.1，浏览器拉取合并策略）
 * 鉴权链：JWT → 账号状态/有效期 → 2FA 绑定态（Require2FA 时未绑定返回 40301）
 * 合并顺序：用户 override_policy_json > 用户组 policy_set > 全局默认
 * 返回：{ policyVersion, mandatory, recommended, sensitiveFields, quota, forceInstallExtensions }
 */
export async function GET(req: Request) {
  const u = await authUser(req);
  if (u instanceof Response) return u;

  const twoFa = await require2faBound(u);
  if (twoFa) return twoFa;

  const url = new URL(req.url);
  const deviceId = url.searchParams.get('deviceId') || u.jwtPayload.deviceId;

  // 更新设备在线与最后状态
  if (deviceId) {
    await q(
      `INSERT INTO user_devices (device_id, user_id, last_online_at)
       VALUES ($1, $2, now())
       ON CONFLICT (device_id) DO UPDATE SET last_online_at = now()`,
      [deviceId, u.userId]
    ).catch(() => undefined);
  }

  const policy = await buildMergedPolicy({
    user_id: u.userId,
    email: u.email,
    group_id: u.groupId,
    override_policy_json: u.overridePolicyJson
  });
  return ok(policy);
}
