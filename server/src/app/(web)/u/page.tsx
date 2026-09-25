'use client';

import { useCallback, useEffect, useState } from 'react';
import { I18nProvider, LangToggle, useI18n } from '@/i18n';
import { api, bearerHeaders, fmtBytes, fmtTime } from '@/lib/client';

type Me = {
  userId: string; email: string; username: string; isAdmin: boolean; totpEnabled: boolean;
  quota: { totalMb: number; usedMb: number; percent: number };
};

function Shell() {
  const { t, lang } = useI18n();
  const [me, setMe] = useState<Me | null>(null);
  const [tab, setTab] = useState<'profile' | 'security' | 'devices' | 'logs' | 'import'>('profile');
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    const r = await api<Me>('/api/auth/me', { headers: bearerHeaders() });
    if (r.code === 0) setMe(r.data);
    else if (r.code === 401) location.href = '/';
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="page-wrap">
      <div className="topbar">
        <div className="brand"><span className="logo">NB</span>{t('appName')} · {t('profile')}</div>
        <div className="row">
          <LangToggle />
          {me?.isAdmin && <a className="btn btn-ghost btn-sm" href="/admin">{t('adminConsole')}</a>}
          <button className="btn btn-ghost btn-sm" onClick={async () => { await api('/api/auth/logout', { method: 'POST' }); location.href = '/'; }}>{t('logout')}</button>
        </div>
      </div>
      <div className="container">
        {msg && <div className="notice notice-ok">{msg}</div>}
        {me && (
          <div className="card">
            <div className="card-title">
              <span>{me.username}（{me.email}）</span>
              <span className="badge badge-primary">2FA {me.totpEnabled ? 'ON' : 'OFF'}</span>
            </div>
            <div className="grid grid-2">
              <AvatarBox onMsg={setMsg} reload={load} />
              <div>
                <div className="row-between"><span className="muted">{t('used')} {me.quota.usedMb} MB / {t('total')} {me.quota.totalMb} MB</span><b>{me.quota.percent}%</b></div>
                <div className="progress" style={{ marginTop: 6 }}><div style={{ width: `${me.quota.percent}%` }} /></div>
                <p className="hint">配额优先级：用户独立 &gt; 用户组 &gt; 全局默认；头像等特殊元数据文件占用配额但不在文件列表展示。</p>
              </div>
            </div>
          </div>
        )}
        <div className="tabs" style={{ marginTop: 16 }}>
          {(['profile', 'security', 'devices', 'logs', 'import'] as const).map((k) => (
            <div key={k} className={`tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{k === 'import' ? (lang === 'zh' ? '数据导入' : 'Import') : t(k)}</div>
          ))}
        </div>
        {tab === 'profile' && me && <ProfileCard me={me} onMsg={setMsg} reload={load} />}
        {tab === 'security' && <SecurityCard onMsg={setMsg} />}
        {tab === 'devices' && <DevicesCard onMsg={setMsg} reload={load} />}
        {tab === 'logs' && <LogsCard />}
        {tab === 'import' && <ImportCard onMsg={setMsg} reload={load} />}
      </div>
    </div>
  );
}

function AvatarBox({ onMsg, reload }: { onMsg: (s: string) => void; reload: () => void }) {
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  useEffect(() => {
    api<{ url: string }>('/api/personal/avatar', { headers: bearerHeaders() }).then((r) => { if (r.code === 0) setAvatarUrl(r.data?.url ?? null); });
  }, []);
  const upload = async (file: File) => {
    const create = await api<{ fileId: string; uploadUrl: string }>('/api/personal/avatar', { method: 'POST', headers: bearerHeaders(), json: { fileName: file.name, size: file.size } });
    if (create.code !== 0) { onMsg(create.message); return; }
    await fetch(create.data.uploadUrl, { method: 'PUT', body: file, headers: { 'content-type': file.type || 'application/octet-stream' } });
    const bind = await api('/api/personal/avatar', { method: 'PATCH', headers: bearerHeaders(), json: { fileId: create.data.fileId } });
    onMsg(bind.message);
    const u = await api<{ url: string }>('/api/personal/avatar', { headers: bearerHeaders() });
    if (u.code === 0) setAvatarUrl(u.data?.url ?? null);
    reload();
  };
  return (
    <div className="row">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {avatarUrl ? <img className="avatar" src={avatarUrl} alt="avatar" /> : <div className="avatar" />}
      <div>
        <input type="file" accept="image/*" style={{ display: 'none' }} id="avatarFile" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }} />
        <label className="btn btn-ghost btn-sm" htmlFor="avatarFile">上传/更换头像</label>
        <button className="btn btn-ghost btn-sm" style={{ marginLeft: 8 }} onClick={async () => { await api('/api/personal/avatar', { method: 'DELETE', headers: bearerHeaders() }); setAvatarUrl(null); onMsg('已删除头像'); }}>删除</button>
        <p className="hint">头像占用个人云配额（file_type=avatar）</p>
      </div>
    </div>
  );
}

function ProfileCard({ me, onMsg, reload }: { me: Me; onMsg: (s: string) => void; reload: () => void }) {
  const { t } = useI18n();
  return (
    <div className="card">
      <div className="card-title">{t('profile')}</div>
      <form onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const r = await api('/api/personal/profile', {
          method: 'PATCH', headers: bearerHeaders(),
          json: { username: f.get('username') || undefined, email: f.get('email') || undefined, password: f.get('password') || undefined }
        });
        onMsg(r.message);
        if (r.code === 0) reload();
      }}>
        <div className="grid grid-2">
          <div className="field"><label>用户名</label><input className="input" name="username" defaultValue={me.username} /></div>
          <div className="field"><label>修改邮箱（需验证密码）</label><input className="input" name="email" type="email" placeholder={me.email} /></div>
          <div className="field"><label>当前密码（修改邮箱时必填）</label><input className="input" name="password" type="password" /></div>
        </div>
        <button className="btn btn-primary">{t('save')}</button>
      </form>
    </div>
  );
}

function SecurityCard({ onMsg }: { onMsg: (s: string) => void }) {
  const { t } = useI18n();
  const [totpOn, setTotpOn] = useState<boolean | null>(null);
  useEffect(() => { api<Me>('/api/auth/me', { headers: bearerHeaders() }).then((r) => setTotpOn(r.data?.totpEnabled ?? false)); }, []);
  return (
    <div className="card">
      <div className="card-title">{t('security')} · 2FA</div>
      <p className="muted">TOTP（RFC-6238，30 秒验证码）。解绑需要密码 + 有效验证码。</p>
      <div className="row">
        <a className="btn btn-primary btn-sm" href="/twofa">{totpOn ? '重新绑定' : t('bind2fa')}</a>
        <button className="btn btn-danger btn-sm" onClick={async (e) => {
          e.preventDefault();
          const password = prompt('输入登录密码：'); if (!password) return;
          const code = prompt('输入 6 位验证码：'); if (!code) return;
          const r = await api('/api/auth/2fa/disable', { method: 'POST', headers: bearerHeaders(), json: { password, code } });
          onMsg(r.message);
          setTotpOn(false);
        }}>{t('disable')} 2FA</button>
      </div>
    </div>
  );
}

type Device = { device_id: string; device_name: string; last_online_at: string; is_revoked: boolean; created_at: string };

function DevicesCard({ onMsg, reload }: { onMsg: (s: string) => void; reload: () => void }) {
  const { t } = useI18n();
  const [list, setList] = useState<Device[]>([]);
  const load = useCallback(async () => {
    const r = await api<{ devices: Device[] }>('/api/personal/devices', { headers: bearerHeaders() });
    if (r.code === 0) setList(r.data?.devices ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);
  return (
    <div className="card">
      <div className="card-title">{t('devices')}</div>
      <div className="table-wrap">
        <table className="tbl">
          <thead><tr><th>设备</th><th>最后在线</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>
            {list.map((d) => (
              <tr key={d.device_id}>
                <td>{d.device_name || '未知设备'}<div className="mono muted">{d.device_id.slice(0, 8)}…</div></td>
                <td>{fmtTime(d.last_online_at)}</td>
                <td>{d.is_revoked ? <span className="badge badge-danger">{t('revoked')}</span> : <span className="badge badge-ok">{t('active')}</span>}</td>
                <td>
                  {!d.is_revoked && (
                    <button className="btn btn-danger btn-sm" onClick={async () => {
                      const r = await api(`/api/personal/devices?deviceId=${d.device_id}`, { method: 'DELETE', headers: bearerHeaders() });
                      onMsg(r.message); load(); reload();
                    }}>{t('revoke')}</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type Log = { log_id: string; event_type: string; detail: Record<string, unknown>; ip_address: string; created_at: string };

/* =====================================================================
   数据导入（自助）：CSV 导入到**自己**的账号（密码/书签/历史）。
   与管理端导入共用解析与执行引擎；导入数据计入个人云配额。
   ===================================================================== */

const IMPORT_TYPE_LABEL_SELF: Record<string, string> = { passwords: '密码', bookmarks: '书签', history: '历史记录' };

function ImportCard({ onMsg, reload }: { onMsg: (s: string) => void; reload: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [type, setType] = useState<'passwords' | 'bookmarks' | 'history'>('passwords');
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Record<string, number> | null>(null);

  const loadPending = useCallback(async () => {
    const r = await api<{ pending: Record<string, number> }>('/api/personal/import', { headers: bearerHeaders() });
    if (r.code === 0) setPending(r.data?.pending ?? {});
  }, []);
  useEffect(() => { loadPending(); }, [loadPending]);

  const doImport = async () => {
    if (!file) return;
    if (!window.confirm(`将 ${IMPORT_TYPE_LABEL_SELF[type]}导入到你自己的账号（${mode === 'replace' ? '覆盖模式，现有待下发数据将被清空' : '合并模式'}），确定？`)) return;
    setBusy(true);
    const fd = new FormData();
    fd.append('file', file); fd.append('type', type); fd.append('mode', mode);
    const r = await fetch('/api/personal/import', { method: 'POST', headers: bearerHeaders(), body: fd })
      .then((x) => x.json()).catch(() => ({ code: -1, message: '网络错误' }));
    setBusy(false);
    onMsg(r.message ?? '');
    if (r.code === 0) { setFile(null); loadPending(); reload(); }
  };

  return (
    <div className="card">
      <div className="card-title">导入到我的账号</div>
      <p className="hint">
        支持从常见浏览器导出的 CSV 导入：密码（Chrome/Edge/Firefox/Bitwarden 导出格式自动识别列）、书签（title,url,folder）、历史（url,title,time）。
        导入后数据进入你的账号「待下发区」，NodeByte 浏览器登录同步时自动并入本机端到端加密存储；密码服务端仅静态加密暂存，浏览器确认后副本删除。
        浏览器设置内也可直接导入 CSV（nodebyte://settings → 数据导入）。
      </p>
      <div className="row" style={{ marginTop: 10 }}>
        <select className="input" style={{ width: 150 }} value={type} onChange={(e) => setType(e.target.value as typeof type)}>
          <option value="passwords">密码（CSV）</option>
          <option value="bookmarks">书签（CSV）</option>
          <option value="history">历史记录（CSV）</option>
        </select>
        <select className="input" style={{ width: 150 }} value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
          <option value="merge">合并模式</option>
          <option value="replace">覆盖模式</option>
        </select>
        <input type="file" accept=".csv,text/csv" className="input" style={{ width: 240 }} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <button className="btn btn-primary btn-sm" disabled={busy || !file} onClick={doImport}>导入（二次确认）</button>
      </div>
      {pending && (
        <p className="hint" style={{ marginTop: 8 }}>
          待下发：密码 {pending['passwords'] ?? 0} 条 · 书签 {pending['bookmarks'] ?? 0} 条 · 历史 {pending['history'] ?? 0} 条
        </p>
      )}
    </div>
  );
}

function LogsCard() {
  const [type, setType] = useState<'security' | 'sync'>('security');
  const [list, setList] = useState<Log[]>([]);
  useEffect(() => {
    api<{ logs: Log[] }>(`/api/personal/logs?type=${type}`, { headers: bearerHeaders() }).then((r) => setList(r.data?.logs ?? []));
  }, [type]);
  return (
    <div className="card">
      <div className="card-title">
        <span>{type === 'security' ? '账号安全日志' : '同步 / DROP 历史'}</span>
        <div className="tabs" style={{ margin: 0 }}>
          <div className={`tab ${type === 'security' ? 'active' : ''}`} onClick={() => setType('security')}>安全</div>
          <div className={`tab ${type === 'sync' ? 'active' : ''}`} onClick={() => setType('sync')}>同步</div>
        </div>
      </div>
      <div className="table-wrap">
        <table className="tbl">
          <thead><tr><th>时间</th><th>事件</th><th>IP</th><th>详情</th></tr></thead>
          <tbody>
            {list.map((l) => (
              <tr key={l.log_id}>
                <td>{fmtTime(l.created_at)}</td>
                <td><span className="badge badge-dim">{l.event_type}</span></td>
                <td className="mono">{l.ip_address || '-'}</td>
                <td className="mono muted" style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis' }}>{JSON.stringify(l.detail)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function Page() {
  return <I18nProvider><Shell /></I18nProvider>;
}
