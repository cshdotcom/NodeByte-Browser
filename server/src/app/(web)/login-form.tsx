'use client';

import { api, bearerHeaders } from '@/lib/client';

export default function Login() {
  const onLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const r = await api<{ jwt: string; deviceId: string; require2faBind: boolean; isAdmin: boolean }>('/api/auth/login', {
      method: 'POST',
      json: {
        identifier: fd.get('identifier'),
        password: fd.get('password'),
        totpCode: fd.get('totpCode') || undefined,
        deviceName: 'Web'
      }
    });
    if (r.code === 0 && r.data?.jwt) {
      localStorage.setItem('nb_jwt', r.data.jwt);
      if (r.data.require2faBind) { location.href = '/twofa'; return; }
      location.href = r.data.isAdmin ? '/admin' : '/u';
      return;
    }
    alert(r.message || '登录失败');
  };

  return (
    <form onSubmit={onLogin}>
      <div className="field">
        <label>账号</label>
        <input className="input" name="identifier" placeholder="邮箱 / 用户名" required autoFocus />
      </div>
      <div className="field">
        <label>密码</label>
        <input className="input" name="password" type="password" placeholder="密码" required />
      </div>
      <div className="field">
        <label>两步验证码（可选，已启用 2FA 时必填）</label>
        <input className="input" name="totpCode" placeholder="123456" inputMode="numeric" maxLength={6} />
      </div>
      <button className="btn btn-primary btn-block" type="submit">登 录</button>
      <div className="row-between" style={{ marginTop: 14 }}>
        <a href="/forgot-password">忘记密码</a>
        <a href="/register">自助注册</a>
      </div>
      <p className="hint" style={{ marginTop: 12 }}>
        NodeByte Browser 客户端登录与此处使用同一账号体系；业务状态码 401/40301/40302/40303/41301/429 由客户端识别并执行对应动作。
        {bearerHeaders().authorization ? '' : ''}
      </p>
    </form>
  );
}
