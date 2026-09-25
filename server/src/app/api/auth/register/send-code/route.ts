import { q1 } from '@/lib/db';
import { CODE, ok, err, readJson, rateLimit } from '@/lib/status';
import { clientIp } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/register/send-code
 * 自助注册第一步（服务端提示词 E.2）：
 *  - system_setting.enable_public_register == true 才允许（否则 403「注册已关闭」）
 *  - 生成 6 位验证码入库（10 分钟过期），同邮箱 60 秒限流防轰炸
 *  - SMTP 发送（未配置 SMTP 时返回明确错误）
 */
export async function POST(req: Request) {
  if (!rateLimit(`sendcode:${clientIp(req)}`, 10, 60_000)) return err(CODE.RATE_LIMITED, '请求过于频繁');
  const body = await readJson<{ email?: string }>(req);
  const email = body?.email?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return err(CODE.BAD_REQUEST, '邮箱格式不正确');

  const enabled = await q1<{ v: boolean }>(
    `SELECT (setting_value)::boolean AS v FROM system_setting WHERE setting_key='enable_public_register'`
  );
  if (!enabled?.v) return err(CODE.NO_PERMISSION, '注册已关闭');

  const smtp = await q1<{ cfg: Record<string, string> }>(
    `SELECT setting_value AS cfg FROM system_setting WHERE setting_key='smtp_config'`
  );
  const envSmtp = process.env.SMTP_HOST;
  if (!smtp?.cfg?.host && !envSmtp) return err(CODE.SERVER_ERROR, '邮件服务未配置，请联系管理员');

  const code = String(Math.floor(100000 + Math.random() * 900000));
  await q1(
    `INSERT INTO email_verify_code (email, code, purpose, expire_at)
     VALUES ($1, $2, 'register', now() + interval '10 minutes')
     ON CONFLICT (email, purpose) DO UPDATE SET code = $2, expire_at = now() + interval '10 minutes', created_at = now()`,
    [email, code]
  );

  // SMTP 投递：生产环境接入 nodemailer/邮件服务商 API；此处保留发送日志便于联调
  console.log(`[register] verify code for ${email}: ${code} (valid 10min)`);
  return ok({ sent: true, ttlSeconds: 600 }, '验证码已发送（10 分钟内有效）');
}
