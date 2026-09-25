import crypto from 'node:crypto';

/**
 * 零第三方依赖安全原语：
 *  - JWT (HS256) 签发 / 校验
 *  - TOTP (RFC-6238) + Base32
 *  - AES-256-GCM 加解密（TOTP 密钥落库加密、内部令牌等）
 */

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-to-a-long-random-secret-value';

// ---------------------------------------------------------------- JWT (HS256)
type JwtPayload = {
  sub: string;        // userId
  deviceId?: string;
  admin?: boolean;
  iat: number;
  exp: number;
};

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function sign(data: string): string {
  return crypto.createHmac('sha256', JWT_SECRET).update(data).digest('base64url');
}

export function jwtSign(payload: Omit<JwtPayload, 'iat' | 'exp'>, ttlSeconds: number): string {
  const now = Math.floor(Date.now() / 1000);
  const body: JwtPayload = { ...payload, iat: now, exp: now + ttlSeconds };
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const data = `${head}.${b64url(JSON.stringify(body))}`;
  return `${data}.${sign(data)}`;
}

export function jwtVerify(token: string): JwtPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const data = `${parts[0]}.${parts[1]}`;
  const expect = sign(data);
  const a = Buffer.from(expect);
  const b = Buffer.from(parts[2]);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString()) as JwtPayload;
    if (payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- Base32 (RFC-4648, no padding in otpauth secrets)
const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[=\s]/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of clean) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

// ---------------------------------------------------------------- TOTP (RFC-6238, 30s, 6 digits, SHA1)
export function totpGenerateSecret(bytes = 20): string {
  return base32Encode(crypto.randomBytes(bytes)); // 默认 160bit → 32 字符
}

export function totpCode(secretBase32: string, timeStep = 30, at = Date.now()): string {
  const key = base32Decode(secretBase32);
  const counter = Math.floor(at / 1000 / timeStep);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const h = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = h[h.length - 1] & 0x0f;
  const bin =
    ((h[offset] & 0x7f) << 24) | ((h[offset + 1] & 0xff) << 16) | ((h[offset + 2] & 0xff) << 8) | (h[offset + 3] & 0xff);
  return String(bin % 1_000_000).padStart(6, '0');
}

/** 校验：允许 ±1 个时间窗（服务端校时窗口，见服务端提示词 E.1） */
export function totpVerify(secretBase32: string, code: string): boolean {
  const now = Date.now();
  for (const drift of [-1, 0, 1]) {
    if (totpCode(secretBase32, 30, now + drift * 30_000) === String(code).trim()) return true;
  }
  return false;
}

export function totpUri(secretBase32: string, account: string, issuer = 'NodeByte Browser'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret: secretBase32, issuer, algorithm: 'SHA1', digits: '6', period: '30' });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// ---------------------------------------------------------------- AES-256-GCM
function aesKey(): Buffer {
  // 派生稳定的 32 字节密钥（TOTP 密钥等落库加密用）
  return crypto.createHash('sha256').update(`${JWT_SECRET}::aes`).digest();
}

export function aesGcmEncrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', aesKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${enc.toString('base64url')}.${tag.toString('base64url')}`;
}

export function aesGcmDecrypt(blob: string): string | null {
  try {
    const [v, iv, data, tag] = blob.split('.');
    if (v !== 'v1') return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey(), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    const dec = Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]);
    return dec.toString('utf8');
  } catch {
    return null;
  }
}

/** 随机 token（分享链接、恢复码等） */
export function randomToken(bytes = 24): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256Hex(input: string | Buffer): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}
