-- =====================================================================
-- NodeByte Server - PostgreSQL 初始化 DDL
-- 来源：服务端后台开发提示词 附录B（核心表 DDL，可直接执行）
-- 扩展：user_security_log（账号安全日志）、审计表防改删触发器、种子数据
-- 执行方式：psql -f init.sql  或由 docker compose 初始化自动执行
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------
-- 1. 账号组织
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_group (
  group_id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_name            text NOT NULL UNIQUE,
  description           text,
  cloud_drop_quota_mb   integer NOT NULL DEFAULT 1024,
  policy_set_id         uuid,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS policy_set (
  policy_set_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text NOT NULL,
  mandatory_json    jsonb NOT NULL DEFAULT '{}',
  recommended_json  jsonb NOT NULL DEFAULT '{}',
  sensitive_fields  text[] NOT NULL DEFAULT '{}',
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- 注意：user_group.policy_set_id 引用 policy_set，建完 policy_set 后补外键
ALTER TABLE user_group
  DROP CONSTRAINT IF EXISTS fk_group_policy_set;
ALTER TABLE user_group
  ADD CONSTRAINT fk_group_policy_set
  FOREIGN KEY (policy_set_id) REFERENCES policy_set(policy_set_id) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE IF NOT EXISTS users (
  user_id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username               text NOT NULL,
  email                  text NOT NULL UNIQUE,
  password_hash          text NOT NULL,
  is_admin               boolean NOT NULL DEFAULT false,
  group_id               uuid REFERENCES user_group(group_id),
  account_expire_at      timestamptz,
  account_status         text NOT NULL DEFAULT 'active' CHECK (account_status IN ('active','disabled','banned')),
  override_cloud_quota_mb integer,
  override_policy_json   jsonb,
  avatar_object_key      text,
  totp_secret_encrypted  text,
  totp_enabled           boolean NOT NULL DEFAULT false,
  created_at             timestamptz NOT NULL DEFAULT now(),
  last_login_at          timestamptz
);

CREATE TABLE IF NOT EXISTS user_group_member (
  user_id   uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  group_id  uuid NOT NULL REFERENCES user_group(group_id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, group_id)
);

CREATE TABLE IF NOT EXISTS user_group_feature_policy (
  group_id    uuid NOT NULL REFERENCES user_group(group_id) ON DELETE CASCADE,
  feature_key text NOT NULL,
  enabled     boolean NOT NULL DEFAULT true,
  PRIMARY KEY (group_id, feature_key)
);

CREATE TABLE IF NOT EXISTS user_devices (
  device_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  device_name        text,
  device_fingerprint text,
  last_online_at     timestamptz,
  last_status        jsonb NOT NULL DEFAULT '{}',
  is_revoked         boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_devices_user ON user_devices(user_id);

CREATE TABLE IF NOT EXISTS system_setting (
  setting_key   text PRIMARY KEY,
  setting_value jsonb NOT NULL
);

-- ---------------------------------------------------------------------
-- 2. 同步存储
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_cloud_usage (
  user_id     uuid PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  used_bytes  bigint NOT NULL DEFAULT 0,
  last_update timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sync_snapshot (
  snapshot_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  snapshot_type    text NOT NULL CHECK (snapshot_type IN ('real_time_delta','manual_backup')),
  data_type        text NOT NULL DEFAULT 'settings',
  version          bigint NOT NULL DEFAULT 0,
  delta_meta       jsonb NOT NULL DEFAULT '{}',
  minio_blob_key   text,
  size_bytes       bigint NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  expire_at        timestamptz
);
CREATE INDEX IF NOT EXISTS idx_sync_user_type ON sync_snapshot(user_id, data_type, version DESC);

CREATE TABLE IF NOT EXISTS user_file_meta (
  file_id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id           uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  file_name               text NOT NULL,
  minio_object_key        text NOT NULL,
  file_size_bytes         bigint NOT NULL DEFAULT 0,
  file_type               text NOT NULL CHECK (file_type IN ('drop_file','screenshot','sync_extension_crx','sync_blob','user_backup_export','note_file','avatar')),
  is_encrypted_client_side boolean NOT NULL DEFAULT false,
  group_id                uuid,
  created_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_file_owner ON user_file_meta(owner_user_id, created_at DESC);

-- ---------------------------------------------------------------------
-- 3. Drop
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS device_push_message (
  msg_id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_user_id       uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  send_type            text NOT NULL CHECK (send_type IN ('tab_page','session_context','collab_invite','file','text')),
  payload              jsonb NOT NULL DEFAULT '{}',
  target_device_ids    uuid[] NOT NULL DEFAULT '{}',
  target_user_emails   text[] NOT NULL DEFAULT '{}',
  expire_at            timestamptz,
  is_client_encrypted  boolean NOT NULL DEFAULT false,
  is_session_revoked   boolean NOT NULL DEFAULT false,
  revoked_at           timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_push_sender ON device_push_message(sender_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS user_shared_session_store (
  shared_session_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id        uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  source_msg_id        uuid REFERENCES device_push_message(msg_id),
  sender_user_id       uuid,
  display_name         text,
  note_tag             text,
  minio_encrypted_key  text NOT NULL,
  is_effective         boolean NOT NULL DEFAULT true,
  received_at          timestamptz NOT NULL DEFAULT now(),
  last_used_at         timestamptz
);
CREATE INDEX IF NOT EXISTS idx_shared_owner ON user_shared_session_store(owner_user_id);

-- ---------------------------------------------------------------------
-- 4. 协作
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS collab_session (
  session_id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id           uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  share_token             text NOT NULL UNIQUE,
  token_expire_at         timestamptz,
  is_active               boolean NOT NULL DEFAULT true,
  permissions_json        jsonb NOT NULL DEFAULT '{}',
  allowed_user_ids        uuid[] NOT NULL DEFAULT '{}',
  allow_multi_participant boolean NOT NULL DEFAULT false,
  session_max_participants integer NOT NULL DEFAULT 1,
  created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS collab_participant (
  participant_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id            uuid NOT NULL REFERENCES collab_session(session_id) ON DELETE CASCADE,
  user_id               uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  join_at               timestamptz NOT NULL DEFAULT now(),
  leave_at              timestamptz,
  role                  text NOT NULL DEFAULT 'viewer' CHECK (role IN ('viewer','controller')),
  is_muted              boolean NOT NULL DEFAULT false,
  is_camera_disabled    boolean NOT NULL DEFAULT false,
  allow_send_audio      boolean NOT NULL DEFAULT false,
  allow_send_video      boolean NOT NULL DEFAULT false,
  is_kicked             boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_participant_session ON collab_participant(session_id);

-- ---------------------------------------------------------------------
-- 5. 管理
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_session (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid NOT NULL,
  target_user_id uuid,
  valid_until   timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admin_audit_log (
  log_id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id      uuid NOT NULL,
  operate_target_user uuid,
  operate_type       text NOT NULL,
  target_file_id     uuid,
  detail             jsonb NOT NULL DEFAULT '{}',
  ip_address         text,
  operate_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_time ON admin_audit_log(operate_at DESC);

-- 审计日志防改删：禁止 UPDATE / DELETE（应用层与数据库双层防护）
CREATE OR REPLACE FUNCTION block_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'admin_audit_log is append-only: UPDATE/DELETE are forbidden';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_block_update ON admin_audit_log;
CREATE TRIGGER trg_audit_block_update
  BEFORE UPDATE OR DELETE ON admin_audit_log
  FOR EACH ROW EXECUTE FUNCTION block_audit_mutation();

-- ---------------------------------------------------------------------
-- 5.5 扩展管理与强制下发（模式2：包下发 / 模式3：ID 下发）
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS extension_pool (
  ext_id           text NOT NULL,                 -- 扩展 ID 或包标识
  package_object_key text,                        -- MinIO 中的 crx/zip（模式2）
  file_size_bytes  bigint NOT NULL DEFAULT 0,
  uploaded_by      uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ext_id)
);

CREATE TABLE IF NOT EXISTS forced_extension (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ext_id           text NOT NULL,
  source           text NOT NULL DEFAULT 'cache_internal' CHECK (source IN ('cache_internal','external_store','package')),
  download_url     text,
  allow_uninstall  boolean NOT NULL DEFAULT false,
  target_user_id   uuid REFERENCES users(user_id) ON DELETE CASCADE,
  target_group_id  uuid REFERENCES user_group(group_id) ON DELETE CASCADE,
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_forced_ext_target ON forced_extension(target_user_id, target_group_id);

CREATE TABLE IF NOT EXISTS extension_install_log (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid,
  user_group_id  uuid,
  ext_id         text NOT NULL,
  download_source text NOT NULL,                  -- edge_store / chrome_store / internal_package
  result_status  text NOT NULL,                   -- success / edge_failed / chrome_failed / network_error / verify_failed
  error_detail   text,
  device_id      uuid,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 6. 用户安全日志（登录/改密/2FA 变更/同步等自助可查）
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_security_log (
  log_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  event_type text NOT NULL,
  detail     jsonb NOT NULL DEFAULT '{}',
  ip_address text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_secblog_user ON user_security_log(user_id, created_at DESC);

-- 注册验证码（自助注册开关开启时使用）
CREATE TABLE IF NOT EXISTS email_verify_code (
  email      text NOT NULL,
  code       text NOT NULL,
  purpose    text NOT NULL DEFAULT 'register',
  expire_at  timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (email, purpose)
);

-- 忘记密码方式 B：冷静期申请单（48 小时服务端控制）
CREATE TABLE IF NOT EXISTS password_reset_request (
  request_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  method      text NOT NULL CHECK (method IN ('totp','email_cooling')),
  token       text,
  stage       text NOT NULL DEFAULT 'init' CHECK (stage IN ('init','cooling','ready','done')),
  ready_at    timestamptz,
  expire_at   timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 7. 种子数据（bootstrap.mjs 会补充管理员与默认组）
-- ---------------------------------------------------------------------
INSERT INTO system_setting (setting_key, setting_value) VALUES
  ('enable_public_register', 'false'::jsonb),
  ('default_quota_mb', '10240'::jsonb),
  ('default_group', 'null'::jsonb),
  ('smtp_config', '{}'::jsonb),
  ('global_policy', '{
    "mandatory": {
      "CustomRequire2FA": false,
      "CustomLockSyncServer": false,
      "CustomAllowMultiProfile": true,
      "CustomAllowGuestMode": true,
      "CustomAllowIncognito": true,
      "CustomAllowSync": true,
      "CustomAllowExportBackup": true,
      "CustomSyncDisabledTypes": [],
      "CustomDisableRendererSandbox": false,
      "CustomAllowJavaScript": true,
      "CustomAllowWebSockets": true,
      "CustomAllowWsUnderHttps": false,
      "SiteListMode": "blacklist",
      "DefaultSearchProviderEnabled": true,
      "DefaultSearchProviderSearchURL": "https://cn.bing.com/search?q={searchTerms}"
    },
    "recommended": {
      "ShowHomeButton": true,
      "ProxyMode": "system",
      "HomepageLocation": "https://www.bing.com"
    }
  }'::jsonb),
  ('default_policy_sensitive_fields', '["CustomProxyVlessConfig","CustomDisableRendererSandbox"]'::jsonb)
ON CONFLICT (setting_key) DO NOTHING;
