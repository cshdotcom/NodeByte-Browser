import { CODE, ok, err, readJson } from '@/lib/status';
import { authAdmin } from '@/lib/auth';
import { adminAudit, clientIp } from '@/lib/audit';
import { testTtsProvider, type TtsProviderConfig } from '@/lib/tts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * 管理后台 - TTS 上游连通性测试
 * POST /api/admin/tts-test  body: 单条 TtsProviderConfig（未保存也可测）
 * → { ok, detail, bytes?, latencyMs? }（合成 "你好，NodeByte 浏览器。"）
 */
export async function POST(req: Request) {
  const admin = await authAdmin(req);
  if (admin instanceof Response) return admin;

  const body = await readJson<Partial<TtsProviderConfig>>(req);
  if (!body?.provider) return err(CODE.BAD_REQUEST, '缺少 provider 类型');
  if (typeof body.weight !== 'number') body.weight = 50;
  body.enabled = true;

  const result = await testTtsProvider(body as TtsProviderConfig);
  await adminAudit({
    adminUserId: admin.userId,
    operateType: 'modify_system_setting',
    detail: { key: 'tts_test', provider: body.provider as string, ok: result.ok, latencyMs: result.latencyMs ?? null },
    ip: clientIp(req),
  });
  return ok(result);
}
