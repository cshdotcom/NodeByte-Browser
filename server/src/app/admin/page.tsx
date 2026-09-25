'use client';

import { useCallback, useEffect, useState } from 'react';
import { I18nProvider, LangToggle, useI18n } from '@/i18n';
import { api, bearerHeaders, fmtBytes, fmtTime } from '@/lib/client';

/* 管理后台：概览 / 用户 / 用户组 / 策略集 / 文件(二次鉴权) / 扩展 / 审计 / 设置
   所有模块支持搜索、筛选、分页；批量操作二次确认（提示词 5.8）。 */

type Stats = {
  users: number; activeUsers: number; devices: number; storageBytes: number;
  files: number; activeCollabSessions: number; auditCount: number;
  recentAudits: Array<{ operate_type: string; operate_at: string; admin_name: string; target_name: string }>;
};

function Shell() {
  const { t } = useI18n();
  const [tab, setTab] = useState<'stats' | 'users' | 'groups' | 'policy' | 'files' | 'ext' | 'audit' | 'settings'>('stats');
  const [me, setMe] = useState<{ username: string; isAdmin: boolean } | null>(null);

  useEffect(() => {
    api<{ username: string; isAdmin: boolean }>('/api/auth/me', { headers: bearerHeaders() }).then((r) => {
      if (r.code === 0 && r.data?.isAdmin) setMe(r.data);
      else if (r.code === 0) location.href = '/u';
      else location.href = '/';
    });
  }, []);

  if (!me) return <div className="center-screen"><span className="spin" /></div>;

  return (
    <div className="page-wrap">
      <div className="topbar">
        <div className="brand"><span className="logo">NB</span>{t('adminConsole')}</div>
        <div className="row">
          <LangToggle />
          <a className="btn btn-ghost btn-sm" href="/u">{t('profile')}</a>
          <button className="btn btn-ghost btn-sm" onClick={async () => { await api('/api/auth/logout', { method: 'POST' }); location.href = '/'; }}>{t('logout')}</button>
        </div>
      </div>
      <div className="container">
        <div className="tabs">
          {([['stats', t('overview')], ['users', t('users')], ['groups', t('groups')], ['policy', t('policy')],
             ['files', t('files')], ['ext', t('extensions')], ['audit', t('audit')], ['settings', t('settings')]] as const).map(([k, label]) => (
            <div key={k} className={`tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{label}</div>
          ))}
        </div>
        {tab === 'stats' && <StatsPanel />}
        {tab === 'users' && <UsersPanel />}
        {tab === 'groups' && <GroupsPanel />}
        {tab === 'policy' && <PolicyPanel />}
        {tab === 'files' && <FilesPanel />}
        {tab === 'ext' && <ExtPanel />}
        {tab === 'audit' && <AuditPanel />}
        {tab === 'settings' && <SettingsPanel />}
      </div>
    </div>
  );
}

function StatsPanel() {
  const [s, setS] = useState<Stats | null>(null);
  useEffect(() => { api<Stats>('/api/admin/stats', { headers: bearerHeaders() }).then((r) => r.code === 0 && setS(r.data)); }, []);
  if (!s) return <span className="spin" />;
  const cards: Array<[string, string]> = [
    ['用户', `${s.activeUsers} / ${s.users}`], ['设备', String(s.devices)],
    ['文件', String(s.files)], ['存储', fmtBytes(s.storageBytes)],
    ['活跃协作会话', String(s.activeCollabSessions)], ['审计条目', String(s.auditCount)]
  ];
  return (
    <>
      <div className="grid grid-4">
        {cards.map(([k, v]) => (
          <div key={k} className="card" style={{ padding: 16 }}>
            <div className="muted">{k}</div>
            <div className="stat-num">{v}</div>
          </div>
        ))}
      </div>
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-title">最近审计</div>
        <div className="table-wrap"><table className="tbl">
          <thead><tr><th>时间</th><th>操作</th><th>操作人</th><th>目标</th></tr></thead>
          <tbody>{s.recentAudits.map((a, i) => (
            <tr key={i}><td>{fmtTime(a.operate_at)}</td><td><span className="badge badge-dim">{a.operate_type}</span></td><td>{a.admin_name}</td><td>{a.target_name ?? '-'}</td></tr>
          ))}</tbody>
        </table></div>
      </div>
    </>
  );
}

type UserRow = {
  user_id: string; username: string; email: string; account_status: string; account_expire_at: string | null;
  override_cloud_quota_mb: number | null; group_name: string | null; used_bytes: string | number; created_at: string; is_admin: boolean;
};

function UsersPanel() {
  const { t } = useI18n();
  const [rows, setRows] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState({ q: '', status: '', expired: '' });
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    const p = new URLSearchParams({ page: String(page), pageSize: '15', ...query });
    const r = await api<{ total: number; users: UserRow[] }>(`/api/admin/users?${p}`, { headers: bearerHeaders() });
    if (r.code === 0) { setRows(r.data?.users ?? []); setTotal(r.data?.total ?? 0); }
  }, [page, query]);
  useEffect(() => { load(); }, [load]);

  const action = async (id: string, json: Record<string, unknown>, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    const r = await api(`/api/admin/users/${id}/actions`, { method: 'POST', headers: bearerHeaders(), json });
    setMsg(r.message); load();
  };

  const batch = async () => {
    if (sel.size === 0) return;
    if (!window.confirm(`批量禁用 ${sel.size} 个用户？（二次确认）`)) return;
    for (const id of sel) await action(id, { action: 'disable' });
    setSel(new Set()); load();
  };

  return (
    <>
      {msg && <div className="notice notice-ok">{msg}</div>}
      <div className="card">
        <div className="row-between">
          <div className="row">
            <input className="input" style={{ width: 220 }} placeholder={t('search') + ' 用户名/邮箱'} value={query.q}
              onChange={(e) => { setPage(1); setQuery({ ...query, q: e.target.value }); }} />
            <select className="input" style={{ width: 130 }} value={query.status} onChange={(e) => { setPage(1); setQuery({ ...query, status: e.target.value }); }}>
              <option value="">全部状态</option><option value="active">{t('active')}</option>
              <option value="disabled">{t('disabled')}</option><option value="banned">{t('banned')}</option>
            </select>
            <select className="input" style={{ width: 130 }} value={query.expired} onChange={(e) => { setPage(1); setQuery({ ...query, expired: e.target.value }); }}>
              <option value="">全部有效期</option><option value="true">{t('expired')}</option><option value="false">未过期</option>
            </select>
          </div>
          <div className="row">
            <button className="btn btn-ghost btn-sm" onClick={batch} disabled={sel.size === 0}>{t('batch')}禁用（{sel.size}）</button>
            <button className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)}>{t('create')}用户</button>
          </div>
        </div>
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table className="tbl">
            <thead><tr>
              <th><input type="checkbox" checked={sel.size > 0 && sel.size === rows.length} onChange={(e) => setSel(e.target.checked ? new Set(rows.map((r) => r.user_id)) : new Set())} /></th>
              <th>用户</th><th>组</th><th>状态</th><th>有效期</th><th>配额/已用</th><th>创建时间</th><th>操作</th>
            </tr></thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.user_id}>
                  <td><input type="checkbox" checked={sel.has(u.user_id)} onChange={(e) => {
                    const n = new Set(sel); e.target.checked ? n.add(u.user_id) : n.delete(u.user_id); setSel(n);
                  }} /></td>
                  <td>{u.username}{u.is_admin && ' ⭐'}<div className="muted mono">{u.email}</div></td>
                  <td>{u.group_name ?? '-'}</td>
                  <td>
                    <span className={`badge ${u.account_status === 'active' ? 'badge-ok' : 'badge-danger'}`}>
                      {u.account_status === 'active' ? t('active') : u.account_status === 'disabled' ? t('disabled') : t('banned')}
                    </span>
                  </td>
                  <td>{u.account_expire_at ? fmtTime(u.account_expire_at) : '永久'}</td>
                  <td>{u.override_cloud_quota_mb != null ? `${u.override_cloud_quota_mb}MB` : '继承'} / {fmtBytes(Number(u.used_bytes))}</td>
                  <td>{fmtTime(u.created_at)}</td>
                  <td>
                    <div className="row" style={{ gap: 4 }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => action(u.user_id, { action: u.account_status === 'active' ? 'disable' : 'activate' })}>
                        {u.account_status === 'active' ? '禁用' : '启用'}
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={() => {
                        const pwd = prompt('临时密码（>=8位）：'); if (pwd) action(u.user_id, { action: 'reset_password', newPassword: pwd });
                      }}>重置密码</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => action(u.user_id, { action: 'reset_2fa' }, '确认强制重置该用户 2FA？（写审计日志）')}>重置2FA</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => action(u.user_id, { action: 'revoke_devices' })}>吊销设备</button>
                      <button className="btn btn-danger btn-sm" onClick={async () => {
                        if (!window.confirm('删除用户为高危操作且级联删除全部数据，确定？')) return;
                        const r = await api(`/api/admin/users/${u.user_id}`, { method: 'DELETE', headers: bearerHeaders(), json: { confirm: true } });
                        setMsg(r.message); load();
                      }}>删除</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="row-between" style={{ marginTop: 10 }}>
          <span className="muted">共 {total} 条</span>
          <div className="row">
            <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</button>
            <span className="muted">{page}</span>
            <button className="btn btn-ghost btn-sm" disabled={page * 15 >= total} onClick={() => setPage(page + 1)}>下一页</button>
          </div>
        </div>
      </div>
      {showCreate && <CreateUser onClose={() => setShowCreate(false)} onDone={() => { setShowCreate(false); load(); }} />}
    </>
  );
}

function CreateUser({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [groups, setGroups] = useState<Array<{ group_id: string; group_name: string }>>([]);
  const [msg, setMsg] = useState('');
  useEffect(() => { api<{ groups: Array<{ group_id: string; group_name: string }> }>('/api/admin/groups', { headers: bearerHeaders() }).then((r) => r.code === 0 && setGroups(r.data?.groups ?? [])); }, []);
  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="card modal" onClick={(e) => e.stopPropagation()}>
        <div className="card-title">新建用户</div>
        {msg && <div className="notice notice-danger">{msg}</div>}
        <form onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const r = await api('/api/admin/users', {
            method: 'POST', headers: bearerHeaders(),
            json: {
              username: f.get('username'), email: f.get('email'), password: f.get('password'),
              groupId: f.get('groupId') || null, accountValidDays: Number(f.get('accountValidDays') ?? 0),
              overrideQuotaMb: f.get('overrideQuotaMb') ? Number(f.get('overrideQuotaMb')) : null
            }
          });
          setMsg(r.message);
          if (r.code === 0) onDone();
        }}>
          <div className="field"><label>用户名</label><input className="input" name="username" required /></div>
          <div className="field"><label>邮箱（全局唯一）</label><input className="input" name="email" type="email" required /></div>
          <div className="field"><label>初始密码（≥8位）</label><input className="input" name="password" required minLength={8} /></div>
          <div className="field"><label>用户组</label>
            <select className="input" name="groupId"><option value="">（无组）</option>{groups.map((g) => <option key={g.group_id} value={g.group_id}>{g.group_name}</option>)}</select>
          </div>
          <div className="field"><label>有效期（天，0=永久）</label><input className="input" name="accountValidDays" type="number" defaultValue={0} min={0} /></div>
          <div className="field"><label>独立配额（MB，留空=继承组/全局）</label><input className="input" name="overrideQuotaMb" type="number" min={0} /></div>
          <div className="row-between">
            <button type="button" className="btn btn-ghost" onClick={onClose}>{'取消'}</button>
            <button className="btn btn-primary">创建</button>
          </div>
        </form>
      </div>
    </div>
  );
}

type Group = { group_id: string; group_name: string; description: string | null; cloud_drop_quota_mb: number; policy_set_name: string | null; member_count: string | number; features: Record<string, boolean> | null };

const FEATURE_KEYS = ['allow_drop_file_screenshot', 'allow_sync', 'allow_export_backup', 'allow_collab_invite', 'allow_joplin_integration', 'allow_vless_proxy', 'allow_disable_sandbox', 'allow_share_session_context', 'allow_forward_shared_session'];

function GroupsPanel() {
  const [rows, setRows] = useState<Group[]>([]);
  const [msg, setMsg] = useState('');
  const load = useCallback(async () => {
    const r = await api<{ groups: Group[] }>('/api/admin/groups', { headers: bearerHeaders() });
    if (r.code === 0) setRows(r.data?.groups ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="card">
      {msg && <div className="notice notice-ok">{msg}</div>}
      <div className="card-title">用户组与功能黑白名单
        <button className="btn btn-primary btn-sm" onClick={async () => {
          const name = prompt('组名称：'); if (!name) return;
          const quota = prompt('组云存储配额（MB）：', '10240');
          const r = await api('/api/admin/groups', { method: 'POST', headers: bearerHeaders(), json: { groupName: name, cloudDropQuotaMb: Number(quota ?? 1024) } });
          setMsg(r.message); load();
        }}>新建组</button>
      </div>
      <div className="table-wrap"><table className="tbl">
        <thead><tr><th>组</th><th>成员</th><th>配额</th><th>策略集</th><th>功能开关（点击切换）</th></tr></thead>
        <tbody>
          {rows.map((g) => (
            <tr key={g.group_id}>
              <td>{g.group_name}<div className="muted">{g.description}</div></td>
              <td>{g.member_count}</td>
              <td>{g.cloud_drop_quota_mb} MB</td>
              <td>{g.policy_set_name ?? '-'}</td>
              <td>
                <div className="row" style={{ gap: 4 }}>
                  {FEATURE_KEYS.map((k) => {
                    const enabled = g.features ? g.features[k] !== false : true;
                    return (
                      <button key={k} className={`btn btn-sm ${enabled ? 'btn-ghost' : 'btn-danger'}`} title={k}
                        onClick={async () => {
                          const r = await api('/api/admin/groups', {
                            method: 'POST', headers: bearerHeaders(),
                            json: { action: 'set_features', groupId: g.group_id, features: { [k]: !enabled } }
                          });
                          setMsg(r.message); load();
                        }}>{k.replace('allow_', '')}{enabled ? '' : ' ✕'}</button>
                    );
                  })}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table></div>
      <p className="hint">allow_forward_shared_session 默认 false 防扩散；allow_disable_sandbox 高危需二次确认与审计。</p>
    </div>
  );
}

type PolicySet = { policy_set_id: string; name: string; mandatory_json: Record<string, unknown>; recommended_json: Record<string, unknown>; sensitive_fields: string[]; group_count: string | number };

function PolicyPanel() {
  const [rows, setRows] = useState<PolicySet[]>([]);
  const [editing, setEditing] = useState<PolicySet | null>(null);
  const [msg, setMsg] = useState('');
  const load = useCallback(async () => {
    const r = await api<{ policySets: PolicySet[] }>('/api/admin/policy-sets', { headers: bearerHeaders() });
    if (r.code === 0) setRows(r.data?.policySets ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="card">
      {msg && <div className="notice notice-ok">{msg}</div>}
      <div className="card-title">策略集（可视化编辑 mandatory / recommended / 敏感字段）
        <button className="btn btn-primary btn-sm" onClick={() => setEditing({ policy_set_id: '', name: '新策略集', mandatory_json: {}, recommended_json: {}, sensitive_fields: [], group_count: 0 })}>新建</button>
      </div>
      <div className="table-wrap"><table className="tbl">
        <thead><tr><th>名称</th><th>绑定组数</th><th>mandatory 键数</th><th>敏感字段</th><th>操作</th></tr></thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.policy_set_id}>
              <td>{p.name}</td><td>{p.group_count}</td>
              <td>{Object.keys(p.mandatory_json ?? {}).length}</td>
              <td className="mono muted">{(p.sensitive_fields ?? []).join(', ')}</td>
              <td className="row" style={{ gap: 4 }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setEditing(p)}>编辑</button>
                <button className="btn btn-danger btn-sm" onClick={async () => {
                  const r = await api(`/api/admin/policy-sets?id=${p.policy_set_id}`, { method: 'DELETE', headers: bearerHeaders() });
                  setMsg(r.message); load();
                }}>删除</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table></div>
      {editing && <PolicyEditor ps={editing} onClose={() => setEditing(null)} onDone={(m) => { setMsg(m); setEditing(null); load(); }} />}
    </div>
  );
}

function PolicyEditor({ ps, onClose, onDone }: { ps: PolicySet; onClose: () => void; onDone: (m: string) => void }) {
  const [mandatory, setMandatory] = useState(JSON.stringify(ps.mandatory_json ?? {}, null, 2));
  const [recommended, setRecommended] = useState(JSON.stringify(ps.recommended_json ?? {}, null, 2));
  const [sensitive, setSensitive] = useState((ps.sensitive_fields ?? []).join(', '));
  const [msg, setMsg] = useState('');
  const save = async () => {
    try {
      const body = {
        policySetId: ps.policy_set_id || undefined,
        name: ps.name,
        mandatory: JSON.parse(mandatory),
        recommended: JSON.parse(recommended),
        sensitiveFields: sensitive.split(',').map((s) => s.trim()).filter(Boolean)
      };
      const r = ps.policy_set_id
        ? await api('/api/admin/policy-sets', { method: 'PATCH', headers: bearerHeaders(), json: body })
        : await api('/api/admin/policy-sets', { method: 'POST', headers: bearerHeaders(), json: body });
      if (r.code === 0) onDone('策略集已保存并通知在线设备'); else setMsg(r.message);
    } catch { setMsg('JSON 解析失败，请检查格式'); }
  };
  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="card modal" style={{ maxWidth: 760 }} onClick={(e) => e.stopPropagation()}>
        <div className="card-title">编辑策略集：{ps.name}</div>
        {msg && <div className="notice notice-danger">{msg}</div>}
        <div className="field"><label>名称</label><input className="input" defaultValue={ps.name} onChange={(e) => { ps.name = e.target.value; }} /></div>
        <div className="field"><label>mandatory JSON（下发后设置页置灰）</label>
          <textarea className="input mono" rows={10} value={mandatory} onChange={(e) => setMandatory(e.target.value)} /></div>
        <div className="field"><label>recommended JSON（默认值，用户可改）</label>
          <textarea className="input mono" rows={6} value={recommended} onChange={(e) => setRecommended(e.target.value)} /></div>
        <div className="field"><label>敏感字段（逗号分隔，UI 隐藏明文）</label>
          <input className="input mono" value={sensitive} onChange={(e) => setSensitive(e.target.value)} /></div>
        <div className="row-between">
          <button className="btn btn-ghost" onClick={onClose}>取消</button>
          <button className="btn btn-primary" onClick={save}>保存</button>
        </div>
      </div>
    </div>
  );
}

type FileRow = { file_id: string; file_name: string; file_size_bytes: string | number; file_type: string; is_encrypted_client_side: boolean; created_at: string; username: string; email: string };

function FilesPanel() {
  const [rows, setRows] = useState<FileRow[]>([]);
  const [adminSession, setAdminSession] = useState('');
  const [target, setTarget] = useState('');
  const [ftype, setFtype] = useState('');
  const [msg, setMsg] = useState('');
  const load = useCallback(async () => {
    if (!adminSession) return;
    const p = new URLSearchParams({ targetUserId: target, type: ftype });
    const r = await api<{ files: FileRow[] }>(`/api/admin/files?${p}`, { headers: { ...bearerHeaders(), 'x-admin-session': adminSession } });
    if (r.code === 0) setRows(r.data?.files ?? []); else setMsg(r.message);
  }, [adminSession, target, ftype]);
  useEffect(() => { load(); }, [load]);

  if (!adminSession) {
    return (
      <div className="card">
        <div className="card-title">管理员二次鉴权</div>
        <p className="muted">查看/下载用户私有文件前必须输入管理员密码；生成 15 分钟临时凭证（绑定目标用户，不能跨用户）。全局搜索留空目标用户。</p>
        {msg && <div className="notice notice-danger">{msg}</div>}
        <form onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const r = await api<{ adminSessionId: string }>('/api/admin/files', {
            method: 'POST', headers: bearerHeaders(),
            json: { action: 'verify', password: f.get('password'), targetUserId: f.get('target') || null }
          });
          setMsg(r.message);
          if (r.code === 0 && r.data?.adminSessionId) { setAdminSession(r.data.adminSessionId); setTarget(String(f.get('target') ?? '')); }
        }}>
          <div className="grid grid-2">
            <div className="field"><label>目标用户 ID（留空=全局搜索）</label><input className="input mono" name="target" /></div>
            <div className="field"><label>管理员密码</label><input className="input" name="password" type="password" required /></div>
          </div>
          <button className="btn btn-primary">验证并进入文件管理</button>
        </form>
      </div>
    );
  }

  return (
    <div className="card">
      {msg && <div className="notice notice-ok">{msg}</div>}
      <div className="card-title">文件管理
        <div className="row">
          <select className="input" style={{ width: 160 }} value={ftype} onChange={(e) => setFtype(e.target.value)}>
            <option value="">全部类型</option>
            {['drop_file', 'screenshot', 'sync_extension_crx', 'sync_blob', 'user_backup_export', 'note_file', 'avatar'].map((x) => <option key={x}>{x}</option>)}
          </select>
          <button className="btn btn-ghost btn-sm" onClick={() => { setAdminSession(''); setMsg(''); }}>退出二次鉴权</button>
        </div>
      </div>
      <div className="table-wrap"><table className="tbl">
        <thead><tr><th>文件</th><th>所有者</th><th>大小</th><th>类型</th><th>加密</th><th>时间</th><th>操作</th></tr></thead>
        <tbody>
          {rows.map((f) => (
            <tr key={f.file_id}>
              <td>{f.file_name}</td><td>{f.username}</td>
              <td>{fmtBytes(Number(f.file_size_bytes))}</td>
              <td><span className="badge badge-dim">{f.file_type}</span></td>
              <td>{f.is_encrypted_client_side ? <span className="badge badge-warn">客户端密文</span> : '否'}</td>
              <td>{fmtTime(f.created_at)}</td>
              <td className="row" style={{ gap: 4 }}>
                <button className="btn btn-ghost btn-sm" onClick={async () => {
                  const r = await api<{ downloadUrl: string; hint: string | null }>(`/api/admin/files?download=${f.file_id}&adminSession=${adminSession}`, { headers: bearerHeaders() });
                  setMsg(r.message || '');
                  if (r.code === 0 && r.data?.downloadUrl) { window.open(r.data.downloadUrl); if (r.data.hint) alert(r.data.hint); }
                }}>下载</button>
                <button className="btn btn-danger btn-sm" onClick={async () => {
                  if (!window.confirm('删除文件（含 MinIO 对象并扣减用量）？')) return;
                  const r = await api(`/api/admin/files?fileId=${f.file_id}&adminSession=${adminSession}`, { method: 'DELETE', headers: bearerHeaders() });
                  setMsg(r.message); load();
                }}>删除</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </div>
  );
}

function ExtPanel() {
  const [data, setData] = useState<{ pool: Array<{ ext_id: string; file_size_bytes: string | number }>; forced: Array<{ id: string; ext_id: string; source: string; target_username: string | null; target_group_name: string | null }>; logs: Array<{ id: string; username: string | null; ext_id: string; download_source: string; result_status: string; error_detail: string | null; created_at: string }> } | null>(null);
  const [msg, setMsg] = useState('');
  const load = useCallback(async () => {
    const r = await api<NonNullable<typeof data>>('/api/admin/extensions', { headers: bearerHeaders() });
    if (r.code === 0) setData(r.data);
  }, []);
  useEffect(() => { load(); }, [load]);
  if (!data) return <span className="spin" />;

  return (
    <div className="card">
      {msg && <div className="notice notice-ok">{msg}</div>}
      <div className="card-title">扩展管理（包下发 / ID 下发：Edge 源 → Chrome 源 → 失败上报）
        <button className="btn btn-primary btn-sm" onClick={async () => {
          const extId = prompt('扩展 ID / 包标识：'); if (!extId) return;
          const r0 = await api<{ uploadUrl: string; objectKey: string }>('/api/admin/extensions', { method: 'POST', headers: bearerHeaders(), json: { action: 'register_package', extId } });
          if (r0.code !== 0) { setMsg(r0.message); return; }
          const url = prompt('已生成上传 URL，粘贴到浏览器新标签打开后 PUT 上传 crx 文件：', r0.data?.uploadUrl);
          if (url === null) return;
          const r1 = await api('/api/admin/extensions', { method: 'POST', headers: bearerHeaders(), json: { action: 'confirm_package', extId, objectKey: r0.data?.objectKey } });
          setMsg(r1.message); load();
        }}>上传扩展包</button>
      </div>
      <div className="table-wrap"><table className="tbl">
        <thead><tr><th>扩展</th><th>来源</th><th>目标</th><th>操作</th></tr></thead>
        <tbody>
          {data.forced.map((f) => (
            <tr key={f.id}>
              <td className="mono">{f.ext_id}</td><td><span className="badge badge-dim">{f.source}</span></td>
              <td>{f.target_username ?? f.target_group_name ?? '-'}</td>
              <td><button className="btn btn-danger btn-sm" onClick={async () => {
                const r = await api('/api/admin/extensions', { method: 'POST', headers: bearerHeaders(), json: { action: 'remove_force', extId: f.id } });
                setMsg(r.message); load();
              }}>移除下发</button></td>
            </tr>
          ))}
        </tbody>
      </table></div>
      <div className="card-title" style={{ marginTop: 16 }}>下发结果日志（精确到扩展 ID / 下载源 / 结果 / 设备）</div>
      <div className="table-wrap"><table className="tbl">
        <thead><tr><th>时间</th><th>用户</th><th>扩展</th><th>下载源</th><th>结果</th><th>错误</th></tr></thead>
        <tbody>
          {data.logs.map((l) => (
            <tr key={l.id}>
              <td>{fmtTime(l.created_at)}</td><td>{l.username ?? '-'}</td><td className="mono">{l.ext_id}</td>
              <td><span className="badge badge-dim">{l.download_source}</span></td>
              <td><span className={`badge ${l.result_status === 'success' ? 'badge-ok' : 'badge-danger'}`}>{l.result_status}</span></td>
              <td className="muted">{l.error_detail ?? '-'}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </div>
  );
}

function AuditPanel() {
  const [rows, setRows] = useState<Array<{ log_id: string; operate_type: string; operate_at: string; admin_name: string; target_name: string | null; ip_address: string | null; detail: Record<string, unknown> }>>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  useEffect(() => {
    api<{ total: number; logs: NonNullable<typeof rows> }>(`/api/admin/audit?page=${page}&q=${encodeURIComponent(q)}`, { headers: bearerHeaders() })
      .then((r) => { if (r.code === 0) { setRows(r.data?.logs ?? []); setTotal(r.data?.total ?? 0); } });
  }, [page, q]);
  return (
    <div className="card">
      <div className="card-title">审计日志（append-only：数据库触发器禁止 UPDATE/DELETE）
        <input className="input" style={{ width: 240 }} placeholder="搜索操作类型/用户" value={q} onChange={(e) => { setPage(1); setQ(e.target.value); }} />
      </div>
      <div className="table-wrap"><table className="tbl">
        <thead><tr><th>时间</th><th>类型</th><th>操作人</th><th>目标用户</th><th>IP</th><th>详情</th></tr></thead>
        <tbody>
          {rows.map((l) => (
            <tr key={l.log_id}>
              <td>{fmtTime(l.operate_at)}</td>
              <td><span className="badge badge-dim">{l.operate_type}</span></td>
              <td>{l.admin_name}</td><td>{l.target_name ?? '-'}</td>
              <td className="mono">{l.ip_address ?? '-'}</td>
              <td className="mono muted" style={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis' }}>{JSON.stringify(l.detail)}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
      <div className="row-between" style={{ marginTop: 10 }}>
        <span className="muted">共 {total} 条</span>
        <div className="row">
          <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</button>
          <span className="muted">{page}</span>
          <button className="btn btn-ghost btn-sm" disabled={page * 30 >= total} onClick={() => setPage(page + 1)}>下一页</button>
        </div>
      </div>
    </div>
  );
}

function SettingsPanel() {
  const [settings, setSettings] = useState<Record<string, unknown> | null>(null);
  const [msg, setMsg] = useState('');
  const load = useCallback(async () => {
    const r = await api<{ settings: Record<string, unknown> }>('/api/admin/settings', { headers: bearerHeaders() });
    if (r.code === 0) setSettings(r.data?.settings ?? {});
  }, []);
  useEffect(() => { load(); }, [load]);
  if (!settings) return <span className="spin" />;

  const save = async (key: string, value: unknown) => {
    const r = await api('/api/admin/settings', { method: 'PATCH', headers: bearerHeaders(), json: { key, value } });
    setMsg(`${key}: ${r.message}`);
  };

  return (
    <div className="card">
      {msg && <div className="notice notice-ok">{msg}</div>}
      <div className="card-title">系统设置</div>
      <div className="row-between" style={{ marginBottom: 12 }}>
        <div>
          <b>自助注册开关（enable_public_register）</b>
          <p className="hint">关闭时注册页 403「注册已关闭」；开启后需 SMTP 配置，邮箱验证码注册。</p>
        </div>
        <div className="row">
          <button className="btn btn-ghost btn-sm" onClick={() => save('enable_public_register', true)}>开启</button>
          <button className="btn btn-danger btn-sm" onClick={() => save('enable_public_register', false)}>关闭</button>
        </div>
      </div>
      <div className="field">
        <label>默认配额（default_quota_mb）</label>
        <div className="row">
          <input className="input" style={{ width: 160 }} id="quotaInput" defaultValue={String(settings['default_quota_mb'] ?? 10240)} />
          <button className="btn btn-ghost btn-sm" onClick={() => save('default_quota_mb', Number((document.getElementById('quotaInput') as HTMLInputElement).value))}>保存</button>
        </div>
      </div>
      <div className="field">
        <label>全局默认策略（global_policy · mandatory/recommended JSON）</label>
        <textarea className="input mono" id="gpInput" rows={12} defaultValue={JSON.stringify(settings['global_policy'] ?? {}, null, 2)} />
        <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => {
          try { save('global_policy', JSON.parse((document.getElementById('gpInput') as HTMLTextAreaElement).value)); }
          catch { setMsg('JSON 解析失败'); }
        }}>保存全局策略</button>
      </div>
      <p className="hint">SMTP 配置（smtp_config）由环境变量或此处 JSON 提供；WebSocket 信令与 SFU 为独立服务，通过反向代理暴露 wss://。</p>
    </div>
  );
}

export default function AdminPage() {
  return <I18nProvider><Shell /></I18nProvider>;
}
