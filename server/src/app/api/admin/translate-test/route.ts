import { CODE, ok, err, readJson } from '@/lib/status';
import { authAdmin } from '@/lib/auth';
import { adminAudit, clientIp } from '@/lib/audit';
import { testProvider, type ProviderConfig } from '@/lib/translate';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * 管理后台 - 翻译接口连通性测试（用户需求：配置后可验证接口是否可用）
 *
 * POST /api/admin/translate-test
 *   body: ProviderConfig（单条，未保存前也可测试）
 *   → { ok, detail, sample?, latencyMs? }
 *
 * 测试内容：把 "Hello, world! This is a test." 翻译为 zh-CN，
 * 返回延迟与译文样例，管理员据此判断接口配置是否正确。
 */
export async function POST(req: Request) {
  const admin = await authAdmin(req);
  if (admin instanceof Response) return admin;

  const body = await readJson<Partial<ProviderConfig>>(req);
  if (!body?.provider) return err(CODE.BAD_REQUEST, '缺少 provider 类型');
  if (typeof body.weight !== 'number') body.weight = 50;
  body.enabled = true;

  const result = await testProvider(body as ProviderConfig);

  await adminAudit({
    adminUserId: admin.userId,
    operateType: 'modify_system_setting',
    detail: {
      key: 'translate_test',
      provider: body.provider as string,
      ok: result.ok,
      latencyMs: result.latencyMs ?? null,
    },
    ip: clientIp(req),
  });

  return ok(result);
}
