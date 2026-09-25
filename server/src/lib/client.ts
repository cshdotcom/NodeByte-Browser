'use client';

/** 客户端 API 助手：统一信封 {code,message,data}；401 时跳转登录 */
export async function api<T = unknown>(
  url: string,
  options: RequestInit & { json?: unknown } = {}
): Promise<{ code: number; message: string; data: T }> {
  const { json, ...rest } = options;
  const resp = await fetch(url, {
    ...rest,
    headers: {
      'content-type': 'application/json',
      ...(rest.headers ?? {})
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    credentials: 'include'
  });
  const body = (await resp.json().catch(() => ({ code: resp.status, message: '响应解析失败', data: null }))) as {
    code: number; message: string; data: T;
  };
  if (body.code === 401 && !location.pathname.startsWith('/')) {
    location.href = '/';
  }
  return body;
}

export function fmtBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function fmtTime(s: string | Date | null | undefined): string {
  if (!s) return '-';
  const d = new Date(s);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 从 localStorage 读 JWT（浏览器客户端模式调试用）；Web 模式走 httpOnly cookie */
export function bearerHeaders(): Record<string, string> {
  const jwt = typeof window !== 'undefined' ? localStorage.getItem('nb_jwt') : null;
  return jwt ? { authorization: `Bearer ${jwt}` } : {};
}
