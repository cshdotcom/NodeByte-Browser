/**
 * 业务状态码约定（客户端/服务端一致，见 docs/architecture.md）
 * 客户端浏览器识别后执行对应动作。
 */
export const CODE = {
  OK: 0,
  UNAUTHORIZED: 401,            // 未登录/令牌过期 → 弹窗跳转登录
  NEED_BIND_2FA: 40301,         // 需绑定 2FA → 强制跳转绑定页
  ACCOUNT_DISABLED: 40302,      // 账号禁用/封禁/过期 → 提示并退出登录
  NO_PERMISSION: 40303,         // 无功能权限（用户组黑白名单拦截）→ 功能入口置灰
  QUOTA_EXCEEDED: 41301,        // 存储配额超限 → 提示「存储空间已满」
  RATE_LIMITED: 429,            // 限流 → 稍后重试
  BAD_REQUEST: 400,             // 参数错误
  NOT_FOUND: 404,               // 资源不存在
  CONFLICT: 409,                // 冲突（邮箱已注册等）
  SERVER_ERROR: 500
} as const;

export type CodeValue = (typeof CODE)[keyof typeof CODE];

/** 统一 JSON 信封 { code, message, data } */
export function ok<T>(data?: T, message = 'ok', init?: ResponseInit): Response {
  return Response.json({ code: CODE.OK, message, data: data ?? null }, init);
}

export function err(code: number, message: string, status?: number, extra?: Record<string, unknown>): Response {
  const http = status ?? httpStatusOf(code);
  return Response.json({ code, message, data: extra ?? null }, { status: http });
}

function httpStatusOf(code: number): number {
  switch (code) {
    case CODE.UNAUTHORIZED: return 401;
    case CODE.NEED_BIND_2FA: return 200;      // 业务码随 200 返回，客户端按 code 跳转
    case CODE.ACCOUNT_DISABLED: return 200;
    case CODE.NO_PERMISSION: return 200;
    case CODE.QUOTA_EXCEEDED: return 200;
    case CODE.RATE_LIMITED: return 429;
    case CODE.BAD_REQUEST: return 400;
    case CODE.NOT_FOUND: return 404;
    case CODE.CONFLICT: return 409;
    default: return 500;
  }
}

/** 读取 JSON body 的安全封装 */
export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

/** 简单限流器（进程内；多实例部署可替换 Redis） */
const buckets = new Map<string, { count: number; resetAt: number }>();
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (b.count >= limit) return false;
  b.count += 1;
  return true;
}
