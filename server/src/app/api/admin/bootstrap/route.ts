import bcrypt from 'bcryptjs';
import { q, q1 } from '@/lib/db';
import { ok, err } from '@/lib/status';
import { sha256Hex } from '@/lib/crypto';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/bootstrap — 初始化引导（幂等，仅当系统无管理员时可用）
 * 创建：默认用户组 + 管理员账号 + 默认策略集绑定 + 系统设置兜底
 * body: { adminEmail, adminPassword, adminUsername? }
 * 生产环境建议使用 scripts/bootstrap.mjs（CLI），此接口用于容器首启自动化。
 */
export async function POST(req: Request) {
  const existing = await q1<{ n: string }>(`SELECT count(*) AS n FROM users WHERE is_admin = true`);
  if (Number(existing?.n ?? 0) > 0) return err(409, '管理员已存在，拒绝重复初始化');

  const body = (await req.json().catch(() => null)) as { adminEmail?: string; adminPassword?: string; adminUsername?: string } | null;
  const email = body?.adminEmail?.trim().toLowerCase();
  const password = body?.adminPassword ?? '';
  if (!email || password.length < 8) return err(400, '需要 adminEmail 与 adminPassword（>=8位）');

  // 默认组
  let group = await q1<{ group_id: string }>(`SELECT group_id FROM user_group ORDER BY created_at LIMIT 1`);
  if (!group) {
    group = await q1<{ group_id: string }>(
      `INSERT INTO user_group (group_name, description, cloud_drop_quota_mb) VALUES ('默认组', '系统默认用户组', 10240) RETURNING group_id`
    );
  }
  // 管理员
  const admin = await q1<{ user_id: string }>(
    `INSERT INTO users (username, email, password_hash, is_admin, group_id)
     VALUES ($1, $2, $3, true, $4) RETURNING user_id`,
    [body?.adminUsername?.trim() || 'admin', email, await bcrypt.hash(password, 10), group?.group_id ?? null]
  );
  if (admin && group) {
    await q(`INSERT INTO user_group_member (user_id, group_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [admin.user_id, group.group_id]);
  }
  await q(
    `INSERT INTO user_security_log (user_id, event_type, detail) VALUES ($1, 'bootstrap_admin_created', '{}'::jsonb)`,
    [admin?.user_id]
  );
  return ok({ adminUserId: admin?.user_id, groupId: group?.group_id }, '初始化完成');
}

/** GET /api/admin/bootstrap — 探测是否已初始化 */
export async function GET() {
  const n = await q1<{ n: string }>(`SELECT count(*) AS n FROM users WHERE is_admin = true`);
  return ok({ initialized: Number(n?.n ?? 0) > 0 });
}
