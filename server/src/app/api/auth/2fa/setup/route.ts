import { q } from '@/lib/db';
import { CODE, ok, err } from '@/lib/status';
import { authUser } from '@/lib/auth';
import { totpGenerateSecret, totpUri, aesGcmEncrypt } from '@/lib/crypto';
import { userSecurityLog, clientIp } from '@/lib/audit';
import QRCode from 'qrcode';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/2fa/setup
 * 生成 16 位 TOTP 密钥（Base32）与 otpauth 二维码（RFC-6238）。
 * 密钥加密暂存（未 enable 前不生效），需再调 /2fa/enable 完成绑定。
 */
export async function POST(req: Request) {
  const u = await authUser(req);
  if (u instanceof Response) return u;

  const secret = totpGenerateSecret(10); // 80bit → 16 字符 Base32
  await q(
    `UPDATE users SET totp_secret_encrypted = $2, totp_enabled = false WHERE user_id = $1`,
    [u.userId, aesGcmEncrypt(secret)]
  );
  const uri = totpUri(secret, u.email);
  const qrDataUrl = await QRCode.toDataURL(uri, { margin: 1, width: 240 });
  await userSecurityLog({ userId: u.userId, eventType: '2fa_setup_started', ip: clientIp(req) });
  return ok({ secret, uri, qrDataUrl }, '请用验证器 App 扫码，然后输入 6 位验证码完成绑定');
}
