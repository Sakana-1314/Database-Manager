import { apiExec } from '../api/client';
import type { ConnectionSpec, OpId, OpResult, ResultSet, Column } from '@shared/index';
import type { ConnectionRecord } from './idb';

export interface TableMeta { name: string; kind: 'table' | 'view' | 'routine'; rows?: number; comment?: string; engine?: string; sizeBytes?: number }
export interface ColMeta { name: string; type: Column['type']; engineType: string; nullable: boolean; key?: string; default?: unknown; extra?: string; comment?: string; ordinal: number }

async function rawData(op: OpId, args: Record<string, unknown>, conn: ConnectionRecord, transport?: 'direct' | 'ssh' | 'http-tunnel'): Promise<unknown> {
  const res = await apiExec(op, args, conn as ConnectionSpec, transport);
  return res.kind === 'raw' ? res.data : null;
}

export async function loadDatabases(conn: ConnectionRecord): Promise<string[]> {
  if (conn.engine === 'mongodb') {
    const d = (await rawData('mongo.listDatabases', {}, conn)) as { databases: { name: string }[] } | null;
    return (d?.databases ?? []).map((x) => x.name);
  }
  const d = (await rawData('meta.listDatabases', {}, conn)) as { databases: string[] } | null;
  return d?.databases ?? [];
}

export async function loadCollections(conn: ConnectionRecord, db: string): Promise<string[]> {
  const d = (await rawData('mongo.listCollections', { db }, conn)) as { collections: { name: string }[] } | null;
  return (d?.collections ?? []).map((c) => c.name);
}

export async function loadObjects(conn: ConnectionRecord, database: string, schema?: string, kind: 'table' | 'view' = 'table'): Promise<TableMeta[]> {
  const d = (await rawData(kind === 'view' ? 'meta.listViews' : 'meta.listTables', { database, schema }, conn)) as { objects: TableMeta[] } | null;
  return d?.objects ?? [];
}

export async function loadColumns(conn: ConnectionRecord, database: string | undefined, table: string, schema?: string): Promise<ColMeta[]> {
  const d = (await rawData('meta.getColumns', { database, schema, table }, conn)) as { columns: ColMeta[] } | null;
  return d?.columns ?? [];
}

export interface GridPageOut { resultset: ResultSet; hasMore: boolean; total?: number }

export async function gridPage(
  conn: ConnectionRecord,
  database: string | undefined,
  table: string,
  page: number,
  pageSize: number,
  opts?: { schema?: string; sort?: unknown[]; filter?: unknown[] },
): Promise<GridPageOut> {
  const d = (await rawData('grid.list', { database, schema: opts?.schema, table, page, pageSize, sort: opts?.sort, filter: opts?.filter, count: true }, conn)) as GridPageOut | null;
  return d ?? { resultset: { columns: [], rows: [], rowCount: 0, truncated: false, durationMs: 0 }, hasMore: false };
}

export async function gridCount(conn: ConnectionRecord, database: string | undefined, table: string, opts?: { schema?: string; filter?: unknown[] }): Promise<{ total?: number; approximate?: boolean }> {
  const d = (await rawData('grid.count', { database, schema: opts?.schema, table, filter: opts?.filter }, conn)) as { total?: number; approximate?: boolean } | null;
  return d ?? {};
}

export async function execSql(conn: ConnectionRecord, sql: string, database?: string): Promise<OpResult> {
  const res = await apiExec('sql.run', { sql, database }, conn as ConnectionSpec);
  if (res.kind === 'multiple') return res;
  if (res.kind === 'resultset') return res;
  return res;
}

export async function execExplain(conn: ConnectionRecord, sql: string, analyze: boolean): Promise<ResultSet | null> {
  const res = await apiExec('sql.explain', { sql, analyze }, conn as ConnectionSpec);
  return res.kind === 'resultset' ? res.resultset : null;
}

export async function testConnection(conn: ConnectionRecord): Promise<{ reachable: boolean; engine?: string; version?: string }> {
  const res = await apiExec('meta.testConnection', {}, conn as ConnectionSpec);
  const d = res.kind === 'raw' ? (res.data as { reachable: boolean; engine?: string; version?: string }) : null;
  return d ?? { reachable: false };
}
