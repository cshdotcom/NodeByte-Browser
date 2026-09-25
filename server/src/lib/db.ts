import { Pool, type QueryResult, type QueryResultRow } from 'pg';

/**
 * PostgreSQL 访问层：连接池 + 参数化查询助手。
 * 数据库 DDL 见 server/sql/init.sql（来源：服务端提示词 附录B）。
 */

const connectionString =
  process.env.DATABASE_URL || 'postgres://nodebyte:nodebyte@localhost:5432/nodebyte';

declare global {
  // eslint-disable-next-line no-var
  var __nbPool: Pool | undefined;
}

export const pool: Pool =
  globalThis.__nbPool ??
  new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000
  });

if (process.env.NODE_ENV !== 'production') globalThis.__nbPool = pool;

/** 参数化查询（$1,$2... 占位，杜绝拼接注入） */
export async function q<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<QueryResult<T>> {
  return pool.query<T>(text, params);
}

/** 查询单行（无则 null） */
export async function q1<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<T | null> {
  const r = await q<T>(text, params);
  return r.rows[0] ?? null;
}

/** 事务执行 */
export async function tx<T>(fn: (client: { query: Pool['query'] }) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client as unknown as { query: Pool['query'] });
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
