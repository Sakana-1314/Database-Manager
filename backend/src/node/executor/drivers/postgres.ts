import pg from 'pg';
import type { SslConfig } from '@shared/spec';
import { normalizeError } from '../../../errors';
import type { Limits } from '@shared/capability';
import type { ColumnType } from '@shared/result';
import type { RawField, RawResult, SqlHandle } from './types';

const { Client, types } = pg;

// 日期/时间一律按文本返回，避免 JS Date 时区漂移；会话统一 UTC（见 connect 后 SET TIME ZONE）。
for (const oid of [1082, 1083, 1114, 1184, 1186, 1266]) {
  try {
    types.setTypeParser(oid, (v: string) => v);
  } catch {
    /* noop */
  }
}

function columnTypeOf(oid: number): ColumnType {
  switch (oid) {
    case 16: return 'bool';
    case 20: case 21: case 23: case 26: case 28: case 29: return 'int';
    case 700: case 701: return 'number';
    case 1700: case 790: return 'decimal';
    case 1042: case 1043: case 25: case 18: case 19: case 869: case 650: case 1009: return 'varchar';
    case 1082: return 'date';
    case 1114: case 1184: return 'datetime';
    case 1083: case 1266: case 1186: return 'time';
    case 17: return 'binary';
    case 2950: return 'uuid';
    case 114: case 3802: return 'json';
    default:
      return oid >= 1000 && oid <= 1999 ? 'array' : 'other';
  }
}

function sslOptions(s?: SslConfig): unknown {
  if (!s || s.mode === 'disable') return false;
  const verify = s.mode === 'verify-ca' || s.mode === 'verify-full';
  return { ca: s.ca, cert: s.cert, key: s.key, rejectUnauthorized: verify };
}

export interface ConnectOpts {
  host: string;
  port: number;
  user: string;
  password?: string;
  database?: string;
  schema?: string;
  ssl?: SslConfig;
  sessionTimeZone?: string;
  limits: Limits;
  socket?: import('stream').Duplex;
}

export async function connectPostgres(opts: ConnectOpts): Promise<SqlHandle> {
  const client = new Client({
    host: opts.host,
    port: opts.port,
    user: opts.user,
    password: opts.password,
    database: opts.database || 'postgres',
    ssl: sslOptions(opts.ssl),
    stream: opts.socket,
    connectionTimeoutMillis: 10_000,
    statement_timeout: Math.min(opts.limits.opTimeoutMs, 30_000),
    query_timeout: Math.min(opts.limits.opTimeoutMs, 30_000),
  } as never);
  try {
    await client.connect();
  } catch (e) {
    throw normalizeError(e, 'PostgreSQL 连接失败');
  }
  try {
    const tz = opts.sessionTimeZone || 'UTC';
    await client.query(`SET TIME ZONE ${JSON.stringify(tz)}`);
    if (opts.schema && opts.schema !== 'public') {
      const q = opts.schema.replaceAll('"', '""');
      await client.query(`SET search_path TO "${q}"`);
    }
  } catch (e) {
    await client.end().catch(() => undefined);
    throw normalizeError(e, 'PostgreSQL 会话初始化失败');
  }

  const run = async (sql: string, params?: unknown[]): Promise<RawResult> => {
    try {
      const res = await client.query({ text: sql, values: params as never });
      const fields: RawField[] = (res.fields ?? []).map((f) => ({ name: f.name, columnType: columnTypeOf(f.dataTypeID), engineType: `pg(${f.dataTypeID})` }));
      const rows = (res.rows ?? []).map((r) => fields.map((f) => (r as Record<string, unknown>)[f.name]));
      const isSelect = String(res.command).startsWith('SELECT');
      return { fields, rows, affectedRows: isSelect ? undefined : res.rowCount ?? undefined };
    } catch (e) {
      throw normalizeError(e, '查询失败');
    }
  };

  return {
    engine: 'postgres',
    runSingle: run,
    async pingVersion() {
      const r = await run('SELECT version() AS v, current_database() AS db, NOW() AS now');
      return String(r.rows[0]?.[0] ?? 'PostgreSQL');
    },
    async close() {
      await client.end().catch(() => undefined);
    },
  };
}
