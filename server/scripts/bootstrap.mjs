#!/usr/bin/env node
/**
 * NodeByte Server 引导脚本（幂等）
 * 创建：默认用户组 / 管理员账号 / 管理员-组绑定
 * 用法：node scripts/bootstrap.mjs
 * 环境变量：DATABASE_URL、ADMIN_EMAIL、ADMIN_PASSWORD（缺省 admin@nodebyte.cn / admin12345，生产必改）
 */
import { Client } from 'pg';
import bcrypt from 'bcryptjs';

const connectionString = process.env.DATABASE_URL || 'postgres://nodebyte:nodebyte@localhost:5432/nodebyte';
const adminEmail = (process.env.ADMIN_EMAIL || 'admin@nodebyte.cn').toLowerCase();
const adminPassword = process.env.ADMIN_PASSWORD || 'admin12345';

const client = new Client({ connectionString });
await client.connect();

// 默认用户组
let group = (await client.query(`SELECT group_id FROM user_group ORDER BY created_at LIMIT 1`)).rows[0];
if (!group) {
  group = (await client.query(
    `INSERT INTO user_group (group_name, description, cloud_drop_quota_mb) VALUES ('默认组', '系统默认用户组', 10240) RETURNING group_id`
  )).rows[0];
  console.log('[bootstrap] default group created:', group.group_id);
}

// 管理员
const exist = (await client.query(`SELECT user_id FROM users WHERE email = $1`, [adminEmail])).rows[0];
if (exist) {
  console.log('[bootstrap] admin exists:', adminEmail);
} else {
  const hash = await bcrypt.hash(adminPassword, 10);
  const admin = (await client.query(
    `INSERT INTO users (username, email, password_hash, is_admin, group_id) VALUES ('admin', $1, $2, true, $3) RETURNING user_id`,
    [adminEmail, hash, group.group_id]
  )).rows[0];
  await client.query(`INSERT INTO user_group_member (user_id, group_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [admin.user_id, group.group_id]);
  await client.query(`INSERT INTO user_security_log (user_id, event_type, detail) VALUES ($1, 'bootstrap_admin_created', '{}'::jsonb)`, [admin.user_id]);
  console.log('[bootstrap] admin created:', adminEmail, '(password from ADMIN_PASSWORD env)');
}

// 系统设置兜底
await client.query(
  `INSERT INTO system_setting (setting_key, setting_value) VALUES ('enable_public_register', 'false'::jsonb)
   ON CONFLICT (setting_key) DO NOTHING`
);
console.log('[bootstrap] done.');
await client.end();
