import { ok } from '@/lib/status';

export const dynamic = 'force-dynamic';

/** POST /api/auth/logout — 清除 Web 会话 cookie；客户端侧删除本地 JWT */
export async function POST() {
  const resp = ok(null, '已退出登录');
  resp.headers.append('Set-Cookie', 'nb_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  return resp;
}
