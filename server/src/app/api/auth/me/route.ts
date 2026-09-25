import { q1 } from '@/lib/db';
import { ok } from '@/lib/status';
import { authUser } from '@/lib/auth';
import { getEffectiveQuotaMb, getUsedBytes } from '@/lib/quota';

export const dynamic = 'force-dynamic';

/** GET /api/auth/me — 当前登录账号信息与配额概览 */
export async function GET(req: Request) {
  const u = await authUser(req);
  if (u instanceof Response) return u;

  const [quotaMb, usedBytes] = await Promise.all([getEffectiveQuotaMb(u.userId), getUsedBytes(u.userId)]);
  const avatar = await q1<{ avatar_object_key: string | null }>(
    `SELECT avatar_object_key FROM users WHERE user_id = $1`, [u.userId]
  );
  return ok({
    userId: u.userId,
    email: u.email,
    username: u.username,
    isAdmin: u.isAdmin,
    totpEnabled: u.totpEnabled,
    avatarUrl: avatar?.avatar_object_key ? `/api/personal/avatar` : null,
    quota: {
      totalMb: quotaMb,
      usedMb: Math.round((usedBytes / 1024 / 1024) * 100) / 100,
      percent: quotaMb > 0 ? Math.min(100, Math.round((usedBytes / (quotaMb * 1024 * 1024)) * 100)) : 0
    }
  });
}
