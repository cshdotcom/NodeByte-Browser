'use client';

import { useState } from 'react';
import { api } from '@/lib/client';

/** 忘记密码：方式 A（账号+TOTP 直接重置）/ 方式 B（邮箱链接 → 48h 服务端冷静期 → 二次确认 → 重置并清空 2FA） */
export default function ForgotPassword() {
  const [mode, setMode] = useState<'A' | 'B'>('A');
  const [msg, setMsg] = useState('');
  const [info, setInfo] = useState<{ resetToken?: string; stage?: string; remainingHours?: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const call = async (json: Record<string, unknown>) => {
    setBusy(true);
    const r = await api<{ resetToken?: string; stage?: string; remainingHours?: number }>('/api/auth/forgot-password', { method: 'POST', json });
    setMsg(r.message);
    setInfo(r.data ?? null);
    setBusy(false);
  };

  return (
    <div className="center-screen">
      <div className="card auth-card">
        <div className="auth-hero"><h1>忘记密码</h1><p>全部流程由服务端控制（48 小时冷静期前端不可控），全程写安全日志</p></div>
        <div className="tabs">
          <div className={`tab ${mode === 'A' ? 'active' : ''}`} onClick={() => setMode('A')}>方式 A：2FA 可用</div>
          <div className={`tab ${mode === 'B' ? 'active' : ''}`} onClick={() => setMode('B')}>方式 B：全部丢失</div>
        </div>
        {msg && <div className="notice notice-warn">{msg}</div>}

        {mode === 'A' && (
          <form onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); call({ mode: 'A', identifier: f.get('identifier'), totpCode: f.get('totpCode') }); }}>
            <div className="field"><label>账号（邮箱/用户名）</label><input className="input" name="identifier" required /></div>
            <div className="field"><label>TOTP 验证码</label><input className="input" name="totpCode" required maxLength={6} /></div>
            <button className="btn btn-primary btn-block" disabled={busy}>校验并获取重置凭证</button>
          </form>
        )}

        {mode === 'B' && (
          <form onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); call({ mode: 'B', email: f.get('email') }); }}>
            <div className="field"><label>绑定邮箱</label><input className="input" name="email" type="email" required /></div>
            <button className="btn btn-primary btn-block" disabled={busy}>发送验证链接</button>
            <div className="hint" style={{ marginTop: 8 }}>
              流程：邮箱验证链接 → 强制等待 48 小时冷静期 → 再次确认 → 重置密码并清空旧 2FA。
              {info?.stage === 'cooling' && ` 当前处于冷静期，剩余约 ${info.remainingHours} 小时。`}
              {info?.stage === 'ready' && ' 冷静期已结束，请在邮件链接中完成二次确认。'}
            </div>
          </form>
        )}

        {info?.resetToken && (
          <ResetWithToken resetToken={info.resetToken} />
        )}
        <div style={{ marginTop: 12 }}><a href="/">返回登录</a></div>
      </div>
    </div>
  );
}

function ResetWithToken({ resetToken }: { resetToken: string }) {
  const [msg, setMsg] = useState('');
  return (
    <form onSubmit={async (e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      const r = await api('/api/auth/reset-password', { method: 'POST', json: { resetToken, newPassword: f.get('p1') } });
      setMsg(r.message);
      if (r.code === 0) setTimeout(() => { location.href = '/'; }, 900);
    }}>
      <div className="notice notice-ok" style={{ marginTop: 12 }}>校验通过，请设置新密码</div>
      {msg && <div className="notice notice-warn">{msg}</div>}
      <div className="field"><label>新密码</label><input className="input" name="p1" type="password" required minLength={8} /></div>
      <button className="btn btn-primary btn-block">重置密码</button>
    </form>
  );
}
