import { q, tx } from './db';
import { aesGcmEncrypt } from './crypto';
import { IMPORT_TYPES, typeLabel, type ImportType, type ParsedRow } from './csv';

/**
 * 导入执行引擎：把解析后的 CSV 行写入目标用户账号的「待下发导入区」。
 *
 *  - 管理端（admin_csv）：可写入一个或多个用户（批量勾选 / 按组 / 全部）；
 *  - 个人中心（self_csv）：只能写入当前登录用户自己的账号；
 *  - 密码明文仅在导入瞬间经过服务端，落库即 AES-256-GCM 静态加密；
 *    客户端经 /api/sync/imported 拉取并转为本地端到端加密数据后 ack，
 *    服务端副本删除（收敛为「服务端零明文驻留」）。
 */

export type ImportTargets =
  | { allUsers: true }
  | { groupIds: string[] }
  | { userIds: string[] };

export type ImportApplyResult = {
  batchId: string;
  type: ImportType;
  mode: 'merge' | 'replace';
  targets: number;
  rowsPerUser: number;
  totalRows: number;
};

/** 按目标解析用户 ID 列表（admin 用） */
async function resolveTargetUserIds(targets: ImportTargets): Promise<string[]> {
  if ('allUsers' in targets && targets.allUsers) {
    const r = await q<{ user_id: string }>(`SELECT user_id FROM users WHERE account_status = 'active'`);
    return r.rows.map((x) => x.user_id);
  }
  if ('groupIds' in targets && targets.groupIds?.length) {
    const r = await q<{ user_id: string }>(
      `SELECT DISTINCT u.user_id FROM users u
        WHERE u.account_status='active' AND u.user_id IN
          (SELECT user_id FROM user_group_member WHERE group_id = ANY($1::uuid[]))
        OR u.group_id = ANY($1::uuid[])`,
      [targets.groupIds]
    );
    return r.rows.map((x) => x.user_id);
  }
  const ids = 'userIds' in targets ? (targets.userIds ?? []) : [];
  if (!ids.length) return [];
  const r = await q<{ user_id: string }>(`SELECT user_id FROM users WHERE user_id = ANY($1::uuid[]) AND account_status='active'`, [ids]);
  return r.rows.map((x) => x.user_id);
}

/** 校验用户 ID 列表存在且 active（self 用） */
async function filterSelfIds(ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const r = await q<{ user_id: string }>(`SELECT user_id FROM users WHERE user_id = ANY($1::uuid[]) AND account_status='active'`, [ids]);
  return r.rows.map((x) => x.user_id);
}

export async function applyImport(opts: {
  type: ImportType;
  mode: 'merge' | 'replace';
  source: 'admin_csv' | 'self_csv';
  rows: ParsedRow[];
  targets: string[] | ImportTargets;
  importedBy: string | null;
  fileName: string;
  selfOnly?: boolean;
}): Promise<ImportApplyResult> {
  if (!IMPORT_TYPES.includes(opts.type)) throw new Error(`不支持的数据类型: ${opts.type}`);
  const userIds = Array.isArray(opts.targets)
    ? (opts.selfOnly ? await filterSelfIds(opts.targets) : await filterSelfIds(opts.targets))
    : await resolveTargetUserIds(opts.targets);
  if (userIds.length === 0) throw new Error('没有可写入的目标用户（不存在或状态非 active）');

  // 分批写入（每批 500 行 × 用户数），避免超长参数数组
  const batchId = await tx(async (c) => {
    const br = await c.query(
      `INSERT INTO import_batch (data_type, mode, source, imported_by, target_count, row_count, file_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING batch_id`,
      [opts.type, opts.mode, opts.source, opts.importedBy, userIds.length, opts.rows.length, opts.fileName]
    );
    const batchId = br.rows[0].batch_id as string;

    for (const userId of userIds) {
      if (opts.mode === 'replace') {
        // replace：清空该用户该类型的待下发导入区（不影响客户端已合并的本地数据）
        if (opts.type === 'passwords') await c.query(`DELETE FROM user_imported_passwords WHERE user_id=$1`, [userId]);
        if (opts.type === 'bookmarks') await c.query(`DELETE FROM user_imported_bookmarks WHERE user_id=$1`, [userId]);
        if (opts.type === 'history') await c.query(`DELETE FROM user_imported_history WHERE user_id=$1`, [userId]);
      }
      for (let i = 0; i < opts.rows.length; i += 500) {
        const chunk = opts.rows.slice(i, i + 500);
        if (opts.type === 'passwords') {
          // 逐行插入（密码需逐条静态加密，语句级 batch 收益有限，安全优先）
          for (const r of chunk) {
            const row = r as Extract<ParsedRow, { kind: 'password' }>;
            await c.query(
              `INSERT INTO user_imported_passwords (user_id, batch_id, origin, name, url, username, password_enc)
               VALUES ($1,$2,$3,$4,$5,$6,$7)`,
              [userId, batchId, row.origin, row.name, row.url, row.username, aesGcmEncrypt(row.password)]
            );
          }
        } else if (opts.type === 'bookmarks') {
          for (const r of chunk) {
            const row = r as Extract<ParsedRow, { kind: 'bookmark' }>;
            await c.query(
              `INSERT INTO user_imported_bookmarks (user_id, batch_id, title, url, folder, date_added)
               VALUES ($1,$2,$3,$4,$5,$6)`,
              [userId, batchId, row.title, row.url, row.folder, row.dateAdded]
            );
          }
        } else {
          for (const r of chunk) {
            const row = r as Extract<ParsedRow, { kind: 'history' }>;
            await c.query(
              `INSERT INTO user_imported_history (user_id, batch_id, url, title, visited_at, visit_count)
               VALUES ($1,$2,$3,$4,$5,$6)`,
              [userId, batchId, row.url, row.title, row.visitedAt, row.visitCount]
            );
          }
        }
      }
    }
    return batchId;
  });

  return {
    batchId,
    type: opts.type,
    mode: opts.mode,
    targets: userIds.length,
    rowsPerUser: opts.rows.length,
    totalRows: userIds.length * opts.rows.length
  };
}

export function labelOf(t: ImportType): string {
  return typeLabel(t);
}
