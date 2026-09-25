'use client';

import { useState } from 'react';
import { api, bearerHeaders } from '@/lib/client';

/** 2FA 绑定引导页（40301 强制跳转目标）：setup → 扫码 → enable */
export default function TwofaPage() {
  const [qr, setQr] = useState('');
  const [secret, setSecret] = useState('');
  const [msg, setMsg] = useState('');
  const [okDone, setOkDone] = useState(false);

  const setup = async () => {
    const r = await api<{ qrDataUrl: string; secret: string }>('/api/auth/2fa/setup', {
      method: 'POST', headers: bearerHeaders()
    });
    if (r.code === 0 && r.data) { setQr(r.data.qrDataUrl); setSecret(r.data.secret); }
    else setMsg(r.message);
  };

  const enable = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const r = await api('/api/auth/2fa/enable', { method: 'POST', headers: bearerHeaders(), json: { code: f.get('code') } });
    setMsg(r.message);
    if (r.code === 0) { setOkDone(true); setTimeout(() => { location.href = '/u'; }, 900); }
  };

  return (
    <div className="center-screen">
      <div className="card auth-card">
        <div className="auth-hero"><h1>绑定两步验证（2FA）</h1><p>组织策略要求绑定 2FA 后才能使用同步 / DROP / 协作</p></div>
        {msg && <div className="notice notice-warn">{msg}</div>}
        {okDone && <div className="notice notice-ok">绑定成功，正在进入个人中心…</div>}
        {!qr ? (
          <button className="btn btn-primary btn-block" onClick={setup}>生成二维码与密钥</button>
        ) : (
          <>
            <div style={{ textAlign: 'center', margin: '12px 0' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qr} alt="TOTP QR" width={220} height={220} style={{ borderRadius: 12 }} />
              <p className="hint">或手动输入密钥（16 位）：</p>
              <div className="mono" style={{ fontSize: 16, letterSpacing: 2 }}>{secret}</div>
            </div>
            <form onSubmit={enable}>
              <div className="field"><label>6 位验证码</label><input className="input" name="code" required maxLength={6} inputMode="numeric" /></div>
              <button className="btn btn-primary btn-block">完成绑定</button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
