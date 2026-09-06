import { createConnection, type Connection, type FieldPacket, type RowDataPacket, type ResultSetHeader } from 'mysql2/promise';
import type { SslConfig } from '@shared/spec';
import type { ColumnType } from '@shared/result';
import { normalizeError } from '../../../errors';
import type { Limits } from '@shared/capability';
import type { RawField, RawResult, SqlHandle } from './types';

const FIELD_JSON = 245;

function columnTypeOf(code: number, isBinary: boolean): ColumnType {
  if (code === FIELD_JSON) return 'json';
  switch (code) {
    case 0:
    case 246:
      return 'decimal';
    case 1:
    case 2:
    case 3:
    case 8:
    case 9:
      return 'int';
    case 4:
    case 5:
      return 'number';
    case 10:
    case 14:
      return 'date';
    case 7:
    case 12:
    case 17:
    case 18:
      return 'datetime';
    case 11:
    case 19:
      return 'time';
    case 13:
      return 'int';
    case 249:
    case 250:
    case 251:
    case 252:
    case 253:
    case 254:
      return isBinary ? 'binary' : 'varchar';
    case 255:
      return 'binary';
    default:
      return 'varchar';
  }
}

function fieldToRaw(f: FieldPacket): RawField {
  const isBin = (Number(f.flags) & 128) !== 0; // BINARY_FLAG
  const t = columnTypeOf(Number(f.type), isBin);
  return { name: f.name, columnType: t, engineType: `mysql(${f.type})` };
}

function sslOptions(s?: SslConfig): Record<string, unknown> | undefined {
  if (!s || s.mode === 'disable') return undefined;
  const reject = s.mode === 'verify-ca' || s.mode === 'verify-full';
  return {
    ca: s.ca ? [s.ca] : undefined,
    cert: s.cert,
    key: s.key,
    rejectUnauthorized: reject,
  };
}

export interface ConnectOpts {
  host: string;
  port: number;
  user: string;
  password?: string;
  database?: string;
  ssl?: SslConfig;
  sessionTimeZone?: string;
  limits: Limits;
  /** 直接传一个已建立的 socket（SSH forwardOut） */
  socket?: import('stream').Duplex;
}

function isHeader(x: unknown): x is ResultSetHeader {
  return !!x && typeof x === 'object' && typeof (x as ResultSetHeader).affectedRows === 'number';
}

function fromRowsFields(rows: unknown, fields: FieldPacket[] | undefined): RawResult {
  if (isHeader(rows)) {
    const h = rows as unknown as ResultSetHeader;
    return { fields: [], rows: [], affectedRows: h.affectedRows, insertId: h.insertId ?? undefined, message: `Affected ${h.affectedRows}` };
  }
  const arr = (rows as RowDataPacket[]) ?? [];
  const raws: RawField[] = (fields as FieldPacket[] | undefined)?.map(fieldToRaw) ?? [];
  const names = raws.length
    ? raws.map((c) => c.name)
    : arr.length
      ? Object.keys(arr[0] as Record<string, unknown>)
      : [];
  const data = arr.map((r) => names.map((n) => (r as Record<string, unknown>)[n]));
  if (!raws.length && names.length) {
    names.forEach((n) => raws.push({ name: n, columnType: 'varchar' as ColumnType, engineType: 'text' }));
  }
  return { fields: raws, rows: data, affectedRows: undefined };
}

function normalizeSingle(rows: RowDataPacket[] | ResultSetHeader, fields: FieldPacket[]): RawResult {
  return fromRowsFields(rows, fields);
}

/** 解析 multipleStatements 结果（扁平 或 成对两种形态都兼容） */
function parseMulti(results: unknown): RawResult[] {
  if (!Array.isArray(results)) return [fromRowsFields(results, undefined)];
  const first = results[0];
  const pairStyle = Array.isArray(first) && Array.isArray(first[0]);
  const out: RawResult[] = [];
  if (pairStyle) {
    for (const pair of results as unknown[]) {
      const p = pair as unknown[];
      if (Array.isArray(p) && p.length >= 1) out.push(fromRowsFields(p[0], p[1] as FieldPacket[] | undefined));
      else out.push(fromRowsFields(p, undefined));
    }
  } else {
    for (const item of results as unknown[]) out.push(fromRowsFields(item, undefined));
  }
  return out;
}

export async function connectMysql(opts: ConnectOpts): Promise<SqlHandle> {
  let conn: Connection;
  try {
    conn = await createConnection({
      host: opts.host,
      port: opts.port,
      user: opts.user,
      password: opts.password,
      database: opts.database,
      ssl: sslOptions(opts.ssl),
      stream: opts.socket,
      supportBigNumbers: true,
      bigNumberStrings: true,
      dateStrings: true,
      connectTimeout: 10_000,
      allowPublicKeyRetrieval: true,
      charset: 'utf8mb4',
    } as never);
  } catch (e) {
    throw normalizeError(e, 'MySQL 连接失败');
  }

  const run = async (sql: string, params?: unknown[]): Promise<RawResult> => {
    try {
      const [rows, fields] = await conn.query({ sql, values: params as never });
      return normalizeSingle(rows as never, (fields as FieldPacket[]) ?? []);
    } catch (e) {
      throw normalizeError(e, '查询失败');
    }
  };

  try {
    const tz = opts.sessionTimeZone && opts.sessionTimeZone !== 'Z' ? opts.sessionTimeZone : '+00:00';
    await conn.query(`SET time_zone = '${tz}'`).catch(() => undefined);
  } catch (e) {
    await conn.end().catch(() => undefined);
    throw normalizeError(e, 'MySQL 会话初始化失败');
  }

  return {
    engine: 'mysql',
    runSingle: run,
    async runScriptNative(sql) {
      try {
        const [results] = (await conn.query(sql)) as unknown as [unknown];
        return parseMulti(results);
      } catch (e) {
        throw normalizeError(e, '脚本执行失败');
      }
    },
    async pingVersion() {
      const r = await run('SELECT VERSION() AS v, @@version_comment AS c, NOW() AS now');
      return `MySQL ${String(r.rows[0]?.[0] ?? '')}`;
    },
    async close() {
      await conn.end().catch(() => undefined);
    },
  };
}
