'use client';

import { useEffect, useState } from 'react';
import { I18nProvider, LangToggle, useI18n } from '@/i18n';
import { api } from '@/lib/client';
import Login from './login-form';

function Shell() {
  const { t } = useI18n();
  const [regOpen, setRegOpen] = useState<boolean | null>(null);
  useEffect(() => {
    api<{ settings?: Record<string, unknown> }>('/api/admin/bootstrap').then(() => undefined).catch(() => undefined);
    fetch('/api/site-config', { credentials: 'include' })
      .then((r) => r.json())
      .then((j) => setRegOpen(Boolean(j?.data?.enablePublicRegister)))
      .catch(() => setRegOpen(false));
  }, []);

  return (
    <div className="center-screen" style={{ background: 'radial-gradient(1200px 500px at 20% -10%, var(--primary-weak), transparent), var(--bg)' }}>
      <div className="card auth-card">
        <div className="row-between">
          <div className="brand"><span className="logo">NB</span>{t('appName')}</div>
          <LangToggle />
        </div>
        <div className="auth-hero" style={{ marginTop: 16 }}>
          <h1>{t('login')}</h1>
          <p>NodeByte 账号 · bsync.nodebyte.cn</p>
        </div>
        <Login />
        {regOpen === false && (
          <div className="notice notice-warn" style={{ marginTop: 12 }}>{t('registerClosed')}</div>
        )}
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <I18nProvider>
      <Shell />
    </I18nProvider>
  );
}
