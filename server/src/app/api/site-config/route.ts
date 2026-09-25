import { q1 } from '@/lib/db';
import { ok } from '@/lib/status';

export const dynamic = 'force-dynamic';

/** GET /api/site-config — 公开站点配置（注册开关、默认域名），无需登录 */
export async function GET() {
  const reg = await q1<{ v: boolean }>(
    `SELECT (setting_value)::boolean AS v FROM system_setting WHERE setting_key='enable_public_register'`
  );
  return ok({
    enablePublicRegister: Boolean(reg?.v),
    defaultDomain: process.env.NEXT_PUBLIC_DEFAULT_DOMAIN || 'bsync.nodebyte.cn'
  });
}
