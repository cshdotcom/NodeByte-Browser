import { ok } from '@/lib/status';
import { authUser, require2faBound } from '@/lib/auth';
import { getEffectiveQuotaMb, getUsedBytes } from '@/lib/quota';

export const dynamic = 'force-dynamic';

/** GET /api/client/quota — 云存储总配额/已用/剩余（设置页与个人面板进度条） */
export async function GET(req: Request) {
  const u = await authUser(req);
  if (u instanceof Response) return u;
  const t = await require2faBound(u);
  if (t) return t;

  const [totalMb, usedBytes] = await Promise.all([getEffectiveQuotaMb(u.userId), getUsedBytes(u.userId)]);
  const usedMb = Math.round((usedBytes / 1024 / 1024) * 100) / 100;
  return ok({
    cloudTotalMb: totalMb,
    cloudUsedMb: usedMb,
    cloudFreeMb: Math.max(0, Math.round((totalMb - usedMb) * 100) / 100),
    percent: totalMb > 0 ? Math.min(100, Math.round((usedBytes / (totalMb * 1024 * 1024)) * 100)) : 0
  });
}
