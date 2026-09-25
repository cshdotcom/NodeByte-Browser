'use client';

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

/** 轻量 i18n：zh / en，cookie 持久化（前后台中英双语，提示词 5.9/约束2.7） */

export const DICT = {
  zh: {
    appName: 'NodeByte Browser',
    login: '登录', logout: '退出登录', register: '自助注册', forgot: '忘记密码',
    identifier: '邮箱 / 用户名', password: '密码', totpCode: '两步验证码（6 位）',
    loginBtn: '登 录', needTotp: '该账号已启用两步验证，请输入验证码',
    registerClosed: '注册已关闭', sendCode: '发送验证码', verifyCode: '邮箱验证码',
    newPassword: '新密码（至少 8 位）', confirmPassword: '确认新密码',
    forgotA: '方式 A：密码遗忘但 2FA 可用', forgotB: '方式 B：密码与 2FA 全丢',
    cooling: '冷静期', confirm: '确认', cancel: '取消', save: '保存',
    overview: '概览', profile: '资料', security: '安全', devices: '设备', logs: '日志',
    used: '已用', total: '总配额', remaining: '剩余',
    revoke: '吊销', revoked: '已吊销', online: '在线', offline: '离线',
    adminConsole: '管理后台', users: '用户管理', groups: '用户组', policy: '策略集',
    files: '文件管理', extensions: '扩展管理', collab: '协作会话', audit: '审计日志', settings: '系统设置',
    create: '新建', edit: '编辑', delete: '删除', search: '搜索', batch: '批量操作',
    active: '正常', disabled: '已禁用', banned: '已封禁', expired: '已过期',
    loading: '加载中…', saved: '已保存', error: '操作失败',
    bind2fa: '绑定 2FA', enable: '启用', disable: '解绑',
    scanQr: '使用验证器 App 扫描二维码，然后输入 6 位验证码完成绑定',
    language: '语言'
  },
  en: {
    appName: 'NodeByte Browser',
    login: 'Sign in', logout: 'Sign out', register: 'Register', forgot: 'Forgot password',
    identifier: 'Email / Username', password: 'Password', totpCode: '2FA code (6 digits)',
    loginBtn: 'Sign in', needTotp: '2FA is enabled on this account, enter the code',
    registerClosed: 'Registration closed', sendCode: 'Send code', verifyCode: 'Email code',
    newPassword: 'New password (min 8 chars)', confirmPassword: 'Confirm password',
    forgotA: 'Method A: password lost, 2FA available', forgotB: 'Method B: both lost',
    cooling: 'Cooling period', confirm: 'Confirm', cancel: 'Cancel', save: 'Save',
    overview: 'Overview', profile: 'Profile', security: 'Security', devices: 'Devices', logs: 'Logs',
    used: 'Used', total: 'Quota', remaining: 'Free',
    revoke: 'Revoke', revoked: 'Revoked', online: 'Online', offline: 'Offline',
    adminConsole: 'Admin Console', users: 'Users', groups: 'Groups', policy: 'Policy Sets',
    files: 'Files', extensions: 'Extensions', collab: 'Collab', audit: 'Audit Log', settings: 'Settings',
    create: 'Create', edit: 'Edit', delete: 'Delete', search: 'Search', batch: 'Batch',
    active: 'Active', disabled: 'Disabled', banned: 'Banned', expired: 'Expired',
    loading: 'Loading…', saved: 'Saved', error: 'Request failed',
    bind2fa: 'Bind 2FA', enable: 'Enable', disable: 'Disable',
    scanQr: 'Scan the QR with your authenticator app, then enter the 6-digit code',
    language: 'Language'
  }
} as const;

export type Lang = keyof typeof DICT;
export type TKey = keyof typeof DICT.zh;

const I18nCtx = createContext<{ lang: Lang; t: (k: TKey) => string; setLang: (l: Lang) => void }>({
  lang: 'zh', t: (k) => DICT.zh[k], setLang: () => undefined
});

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>('zh');

  useEffect(() => {
    const m = document.cookie.match(/nb_lang=(zh|en)/);
    if (m) setLangState(m[1] as Lang);
  }, []);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    document.cookie = `nb_lang=${l}; Path=/; Max-Age=31536000`;
  }, []);

  const t = useCallback((k: TKey) => DICT[lang][k], [lang]);
  return <I18nCtx.Provider value={{ lang, t, setLang }}>{children}</I18nCtx.Provider>;
}

export function useI18n() {
  return useContext(I18nCtx);
}

export function LangToggle() {
  const { lang, setLang, t } = useI18n();
  return (
    <button className="lang-toggle" onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}>
      {lang === 'zh' ? 'English' : '中文'} · {t('language')}
    </button>
  );
}
