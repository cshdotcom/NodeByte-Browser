'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/client';

export default function Register() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [sent, setSent] = useState(false);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ enablePublicRegister: boolean }>('/api/site-config').then((r) => setEnabled(r.data?.enablePublicRegister ?? false));
  }, []);

  const send = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    const fd = new FormData(e.currentTarget);
    const r = await api('/api/auth/register/send-code', { method: 'POST', json: { email: fd.get('email') } });
    setMsg(r.message);
    if (r.code === 0) setSent(true);
    setBusy(false);
  };

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    const fd = new FormData(e.currentTarget);
    const r = await api('/api/auth/register', {
      method: 'POST',
      json: { email: fd.get('email'), code: fd.get('code'), password: fd.get('password'), username: fd.get('username') || undefined }
    });
    setMsg(r.message);
    if (r.code === 0) setTimeout(() => { location.href = '/'; }, 800);
    setBusy(false);
  };

  if (enabled === false) {
    return (
      <div className="center-screen">
        <div className="card auth-card" style={{ textAlign: 'center' }}>
          <div className="badge badge-warn">注册已关闭</div>
          <p className="muted" style={{ marginTop: 10 }}>管理员未开启自助注册，请联系管理员创建账号。</p>
          <a href="/">返回登录</a>
        </div>
      </div>
    );
  }

  return (
    <div className="center-screen">
      <div className="card auth-card">
        <div className="auth-hero"><h1>自助注册</h1><p>邮箱验证码注册（归属默认用户组，继承组配额与策略）</p></div>
        {msg && <div className="notice notice-warn">{msg}</div>}
        {!sent ? (
          <form onSubmit={send}>
            <div className="field"><label>邮箱</label><input className="input" name="email" type="email" required placeholder="you@example.com" /></div>
            <button className="btn btn-primary btn-block" disabled={busy} type="submit">{busy ? '发送中…' : '发送验证码'}</button>
          </form>
        ) : (
          <form onSubmit={submit}>
            <div className="field"><label>邮箱验证码</label><input className="input" name="code" required maxLength={6} placeholder="123456" /></div>
            <div className="field"><label>用户名（可选）</label><input className="input" name="username" placeholder="不填默认取邮箱前缀" /></div>
            <div className="field"><label>设置密码（至少 8 位）</label><input className="input" name="password" type="password" required minLength={8} /></div>
            <button className="btn btn-primary btn-block" disabled={busy} type="submit">{busy ? '提交中…' : '创建账号'}</button>
          </form>
        )}
        <div style={{ marginTop: 12 }}><a href="/">返回登录</a></div>
      </div>
    </div>
  );
}
