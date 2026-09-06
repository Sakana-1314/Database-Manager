import type { ResultSet, Row, OpResult, CellValue } from '@shared/result';
import type { Limits } from '@shared/capability';
import { AppError, validationError } from '../../errors';
import type { SqlHandle } from './drivers/types';
import { quoteIdent, qualify } from './sql/quote';
import type { DialectKey } from './sql/quote';
import { splitStatements } from './sql/split';
import { buildFilter, buildOrderBy } from './sql/where';
import { decodeParam, encodeCell } from './sql/values';
import { introspect, type ColumnMeta } from './sqlmeta';
import type { PkSpec } from '@shared/ops';

export interface SqlRunArgs {
  database?: string;
  schema?: string;
  table?: string;
  page?: number;
  pageSize?: number;
  sql?: string;
  single?: boolean;
  analyze?: boolean;
  confirm?: boolean;
  charset?: string;
  collation?: string;
  kind?: 'procedure' | 'function';
  op: string;
  args: Record<string, unknown>;
  spec: { engine: 'mysql' | 'postgres'; database?: string; schema?: string };
}

function tableRef(engine: DialectKey, dbOrSchema: string | undefined, table: string): string {
  if (engine === 'mysql') {
    return dbOrSchema ? `${quoteIdent('mysql', dbOrSchema)}.${quoteIdent('mysql', table)}` : quoteIdent('mysql', table);
  }
  return `${quoteIdent('postgres', dbOrSchema || 'public')}.${quoteIdent('postgres', table)}`;
}

function toResultSet(raw: { fields: { name: string; columnType: import('@shared/result').ColumnType }[]; rows: unknown[][] }, durationMs: number): ResultSet {
  const columns = raw.fields.map((f) => ({ name: f.name, engineType: f.name, type: f.columnType }));
  const rows: Row[] = raw.rows.map((cells) => {
    const obj: Row = {};
    raw.fields.forEach((f, i) => {
      obj[f.name] = encodeCell(f.columnType, cells[i]);
    });
    return obj;
  });
  return { columns, rows, rowCount: rows.length, truncated: false, durationMs };
}

async function loadColumns(handle: SqlHandle, db: string | undefined, schema: string | undefined, table: string): Promise<ColumnMeta[]> {
  return introspect(handle).columns(db, schema, table);
}

export async function executeSqlOp(op: string, args: Record<string, unknown>, handle: SqlHandle, spec: { engine: 'mysql' | 'postgres'; database?: string; schema?: string }, limits: Limits): Promise<OpResult> {
  const engine: DialectKey = spec.engine;
  const db = str(args.database);
  const schema = str(args.schema);
  const table = str(args.table);
  const meta = introspect(handle);
  const started = Date.now();

  switch (op) {
    // ---------- 结构元数据 ----------
    case 'meta.listDatabases': {
      const list = await meta.listDatabases();
      return { kind: 'raw', data: { databases: list } };
    }
    case 'meta.listSchemas': {
      if (engine !== 'postgres') throw validationError('仅 PostgreSQL 支持 schema');
      const r = await handle.runSingle('SELECT nspname FROM pg_namespace WHERE nspname NOT LIKE $1 ORDER BY 1', ['pg\\_%']);
      const schemas = r.rows.map((row) => String(row[0])).filter((s) => !['information_schema'].includes(s));
      return { kind: 'raw', data: { schemas } };
    }
    case 'meta.listTables':
    case 'meta.listViews': {
      const kind = op === 'meta.listViews' ? 'view' : 'table';
      const list = await meta.listTables(db, schema, kind);
      return { kind: 'raw', data: { objects: list, kind } };
    }
    case 'meta.getColumns': {
      if (!table) throw validationError('缺少 table');
      const cols = await meta.columns(db, schema, table);
      return { kind: 'raw', data: { columns: cols } };
    }
    case 'meta.getPrimaryKey': {
      const pk = await meta.pk(db, schema, table!);
      return { kind: 'raw', data: { pk } };
    }
    case 'meta.getIndexes': {
      const indexes = await meta.indexes(db, schema, table!);
      return { kind: 'raw', data: { indexes } };
    }
    case 'meta.getForeignKeys': {
      const fks = await meta.fks(db, schema, table!);
      return { kind: 'raw', data: { foreignKeys: fks } };
    }
    case 'meta.getTableInfo': {
      const info = await meta.tableInfo(db, schema, table!);
      return { kind: 'raw', data: { tableInfo: { ...info, name: table } } };
    }
    case 'meta.getCreateTable': {
      const out = await meta.createTableSql(db, schema, table!);
      return { kind: 'raw', data: { sql: out.sql, approximate: out.approximate } };
    }
    case 'meta.getRoutines': {
      // MySQL / PG 只读列举，最小实现
      if (engine === 'mysql') {
        const dbn = db || spec.database;
        const r = await handle.runSingle(
          `SELECT ROUTINE_NAME, ROUTINE_TYPE, DTYPE FROM (SELECT ROUTINE_NAME, ROUTINE_TYPE, 'procedure' AS DTYPE FROM information_schema.routines WHERE routine_schema=? AND routine_type='PROCEDURE'
             UNION ALL SELECT ROUTINE_NAME, ROUTINE_TYPE, 'function' AS DTYPE FROM information_schema.routines WHERE routine_schema=? AND routine_type='FUNCTION') t ORDER BY 1`,
          [dbn, dbn],
        );
        const routines = r.rows.map((row) => ({ name: String(row[0]), kind: String(row[2]) as 'procedure' | 'function' }));
        return { kind: 'raw', data: { routines } };
      }
      const r = await handle.runSingle(
        `SELECT p.proname, p.prokind, l.lanname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang WHERE n.nspname=$1 AND p.prokind IN ('f','p') ORDER BY 1`,
        [schema || 'public'],
      );
      const routines = r.rows.map((row) => ({
        name: String(row[0]),
        kind: (String(row[1]) === 'p' ? 'procedure' : 'function') as 'procedure' | 'function',
        language: String(row[2]),
      }));
      return { kind: 'raw', data: { routines } };
    }
    case 'meta.dialectInfo': {
      if (engine === 'mysql') {
        const cs = await handle.runSingle('SHOW CHARSET', []);
        const coll = await handle.runSingle('SHOW COLLATION', []);
        const charsets = cs.rows.map((row) => String(row[0]));
        const collations = coll.rows.map((row) => ({ name: String(row[0]), charset: String(row[1]), default: String(row[3]).toUpperCase() === 'YES' }));
        return { kind: 'raw', data: { charsets, collations } };
      }
      return { kind: 'raw', data: { charsets: ['UTF8'], collations: [] } };
    }

    // ---------- 控制台 ----------
    case 'sql.run': {
      const sql = str(args.sql);
      if (!sql) throw validationError('缺少 sql');
      await ensureContext(handle, engine, db, schema, spec);
      const items = await runScript(handle, sql, engine);
      const dur = Date.now() - started;
      const results = items.map((item) => itemToOpItem(item, 0));
      if (results.length === 1) {
        const single = results[0];
        if (single.kind === 'resultset') single.resultset.durationMs = dur;
        else if ('durationMs' in single) single.durationMs = dur;
        return single as OpResult;
      }
      return { kind: 'multiple', items: results, durationMs: dur };
    }
    case 'sql.explain': {
      const sql = str(args.sql);
      const analyze = !!args.analyze;
      const prefix = engine === 'mysql' ? (analyze ? 'EXPLAIN ANALYZE ' : 'EXPLAIN FORMAT=JSON ') : analyze ? 'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' : 'EXPLAIN (FORMAT JSON) ';
      const raw = await handle.runSingle(prefix + sql);
      return { kind: 'resultset', resultset: toResultSet(raw, Date.now() - started) };
    }

    // ---------- 数据网格 ----------
    case 'grid.list': {
      if (!table) throw validationError('缺少 table');
      const page = num(args.page) || 1;
      const pageSize = Math.min(num(args.pageSize) || limits.defaultPageSize, limits.maxResultRows);
      const cols = await loadColumns(handle, db, schema, table);
      const allowed = new Set(cols.map((c) => c.name));
      const filters = (args.filter as import('@shared/ops').FilterSpec[]) ?? [];
      const sort = (args.sort as import('@shared/ops').SortSpec[]) ?? [];
      for (const f of filters) if (!allowed.has(f.column)) throw validationError(`未知列：${f.column}`);
      for (const s of sort) if (!allowed.has(s.column)) throw validationError(`未知列：${s.column}`);
      const ref = tableRef(engine, engine === 'mysql' ? db : schema, table);
      const where = buildFilter(engine, filters);
      const order = buildOrderBy(engine, sort);
      const offset = (page - 1) * pageSize;
      let sql: string;
      let params: unknown[];
      if (engine === 'postgres') {
        const n = where.values.length;
        sql = `SELECT * FROM ${ref} ${where.clause ? `WHERE ${where.clause}` : ''} ${order} LIMIT $${n + 1} OFFSET $${n + 2}`;
        params = [...where.values, pageSize, offset];
      } else {
        sql = `SELECT * FROM ${ref} ${where.clause ? `WHERE ${where.clause}` : ''} ${order} LIMIT ? OFFSET ?`;
        params = [...where.values, pageSize, offset];
      }
      const raw = await handle.runSingle(sql, params);
      const resultset = toResultSet(raw, Date.now() - started);
      const hasMore = raw.rows.length === pageSize;
      let total: number | undefined;
      if (args.count) total = await countFor(handle, engine, ref, where.clause, where.values);
      return { kind: 'raw', data: { resultset, hasMore, total } };
    }
    case 'grid.count': {
      if (!table) throw validationError('缺少 table');
      const filters = (args.filter as import('@shared/ops').FilterSpec[]) ?? [];
      const ref = tableRef(engine, engine === 'mysql' ? db : schema, table);
      if (!filters.length) {
        const info = await meta.tableInfo(db, schema, table);
        return { kind: 'raw', data: { total: info.rows ?? null, approximate: true } };
      }
      const where = buildFilter(engine, filters);
      const raw = await handle.runSingle(`SELECT COUNT(*) FROM ${ref} ${where.clause ? `WHERE ${where.clause}` : ''}`, where.values);
      const total = Number(raw.rows[0]?.[0] ?? 0);
      return { kind: 'raw', data: { total, approximate: false } };
    }

    // ---------- DML ----------
    case 'dml.insert': {
      if (!table) throw validationError('缺少 table');
      const rows = (args.rows as Row[]) ?? [];
      if (!rows.length) throw validationError('没有可插入的数据');
      const cols = await loadColumns(handle, db, schema, table);
      const colMeta = new Map(cols.map((c) => [c.name, c]));
      // 列顺序取表结构顺序
      const allKeys = new Set(rows.flatMap((r) => Object.keys(r)));
      const insertCols = cols.filter((c) => allKeys.has(c.name));
      const placeholders = rows.map((_, ri) => `(${insertCols.map((c, ci) => (engine === 'mysql' ? '?' : `$${ri * insertCols.length + ci + 1}`)).join(', ')})`).join(', ');
      const values: unknown[] = [];
      for (const row of rows) {
        for (const c of insertCols) {
          const rawV = row[c.name];
          values.push(decodeParam(rawV as CellValue, engine, colMeta.get(c.name)?.type));
        }
      }
      const ref = tableRef(engine, engine === 'mysql' ? db : schema, table);
      const sql = `INSERT INTO ${ref} (${insertCols.map((c) => quoteIdent(engine, c.name)).join(', ')}) VALUES ${placeholders}`;
      const raw = await handle.runSingle(sql, values);
      return { kind: 'ok', affectedRows: raw.affectedRows ?? rows.length, message: `插入 ${rows.length} 行`, durationMs: Date.now() - started };
    }
    case 'dml.update': {
      if (!table) throw validationError('缺少 table');
      const values = (args.values as Row) ?? {};
      const pks = (args.pks as PkSpec[]) ?? [];
      if (!pks.length) throw validationError('缺少主键定位');
      const cols = await loadColumns(handle, db, schema, table);
      const colMeta = new Map(cols.map((c) => [c.name, c]));
      const setKeys = Object.keys(values).filter((k) => colMeta.has(k));
      if (!setKeys.length) throw validationError('没有可更新的字段');
      const ref = tableRef(engine, engine === 'mysql' ? db : schema, table);
      const params: unknown[] = [];
      const setSql = setKeys.map((k, i) => `${quoteIdent(engine, k)} = ${engine === 'mysql' ? '?' : `$${i + 1}`}`).join(', ');
      params.push(...setKeys.map((k) => decodeParam(values[k] as CellValue, engine, colMeta.get(k)?.type)));
      const base = pks.length;
      const whereSql = pks.map((pk, i) => `${quoteIdent(engine, pk.column)} = ${engine === 'mysql' ? '?' : `$${setKeys.length + i + 1}`}`).join(' AND ');
      params.push(...pks.map((pk) => decodeParam(pk.value as CellValue, engine, colMeta.get(pk.column)?.type)));
      const sql = `UPDATE ${ref} SET ${setSql} WHERE ${whereSql}`;
      const raw = await handle.runSingle(sql, params);
      return { kind: 'ok', affectedRows: raw.affectedRows, message: `更新 ${raw.affectedRows ?? 0} 行`, durationMs: Date.now() - started };
    }
    case 'dml.deleteRows': {
      if (!table) throw validationError('缺少 table');
      const pkGroups = (args.pks as PkSpec[][]) ?? [];
      if (!pkGroups.length) throw validationError('缺少主键定位');
      const cols = await loadColumns(handle, db, schema, table);
      const colMeta = new Map(cols.map((c) => [c.name, c]));
      const ref = tableRef(engine, engine === 'mysql' ? db : schema, table);
      let deleted = 0;
      for (const pks of pkGroups) {
        const params: unknown[] = [];
        const whereSql = pks.map((pk, i) => `${quoteIdent(engine, pk.column)} = ${engine === 'mysql' ? '?' : `$${i + 1}`}`).join(' AND ');
        params.push(...pks.map((pk) => decodeParam(pk.value as CellValue, engine, colMeta.get(pk.column)?.type)));
        const raw = await handle.runSingle(`DELETE FROM ${ref} WHERE ${whereSql}`, params);
        deleted += raw.affectedRows ?? 0;
      }
      return { kind: 'ok', affectedRows: deleted, message: `删除 ${deleted} 行`, durationMs: Date.now() - started };
    }

    // ---------- DDL ----------
    case 'ddl.execute': {
      const sql = str(args.sql);
      if (!sql) throw validationError('缺少 sql');
      await ensureContext(handle, engine, db, schema, spec);
      const items = await runScript(handle, sql, engine);
      return { kind: 'ok', message: `已执行 ${items.length} 条语句`, durationMs: Date.now() - started };
    }
    case 'ddl.createDatabase': {
      const name = str(args.database);
      if (!name) throw validationError('缺少 database');
      if (engine === 'mysql') {
        const cs = quoteIdent('mysql', str(args.charset) || 'utf8mb4');
        const coll = str(args.collation) ? ` COLLATE ${quoteIdent('mysql', str(args.collation)!)}` : '';
        await handle.runSingle(`CREATE DATABASE ${quoteIdent('mysql', name)} CHARACTER SET ${cs}${coll}`);
      } else {
        await handle.runSingle(`CREATE DATABASE ${quoteIdent('postgres', name)}`);
      }
      return { kind: 'ok', message: `已创建数据库 ${name}`, durationMs: Date.now() - started };
    }
    case 'ddl.dropDatabase': {
      if (!args.confirm) throw new AppError('VALIDATION', '请确认删除', { status: 400 });
      const name = str(args.database);
      if (!name) throw validationError('缺少 database');
      await handle.runSingle(`DROP DATABASE ${quoteIdent(engine, name)}`);
      return { kind: 'ok', message: `已删除数据库 ${name}`, durationMs: Date.now() - started };
    }

    default:
      throw new AppError('OP_UNSUPPORTED', `不支持的 op：${op}`);
  }
}

// ---------- 私有工具 ----------

function str(v: unknown): string | undefined {
  return v === undefined || v === null ? undefined : String(v);
}
function num(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** 把控制台/ddl 脚本当作原始字段数组切分并执行，MySQL 多语句优先交给服务端 */
async function runScript(handle: SqlHandle, sql: string, engine: DialectKey): Promise<{ fields: { name: string; columnType: import('@shared/result').ColumnType }[]; rows: unknown[][] }[]> {
  const single = splitStatements(sql, engine).length <= 1;
  if (single) {
    const r = await handle.runSingle(sql, []);
    return [{ fields: r.fields, rows: r.rows }];
  }
  if (engine === 'mysql' && handle.runScriptNative) {
    // 含复合语句（PROCEDURE/FUNCTION/TRIGGER）整体交给服务端，避免客户端误切
    if (/CREATE\s+(?:OR\s+REPLACE\s+)?(?:PROCEDURE|FUNCTION|TRIGGER|EVENT)/i.test(sql)) {
      return handle.runScriptNative(sql);
    }
    const parts = splitStatements(sql, engine);
    const out = [];
    for (const part of parts) {
      const r = await handle.runSingle(part, []);
      out.push({ fields: r.fields, rows: r.rows });
    }
    return out;
  }
  // PostgreSQL：逐句执行
  const parts = splitStatements(sql, engine);
  const out = [];
  for (const part of parts) {
    const r = await handle.runSingle(part, []);
    out.push({ fields: r.fields, rows: r.rows });
  }
  return out;
}

/** MySQL 用 USE / PG 用 search_path 切换上下文（仅当与连接默认不同） */
async function ensureContext(handle: SqlHandle, engine: DialectKey, db: string | undefined, schema: string | undefined, spec: { engine: 'mysql' | 'postgres'; database?: string; schema?: string }): Promise<void> {
  if (engine === 'mysql') {
    if (db && db !== spec.database) {
      await handle.runSingle(`USE ${quoteIdent('mysql', db)}`, []);
    }
  } else {
    if (db && db !== spec.database) {
      throw validationError('PostgreSQL 的 SQL 执行运行在当前连接库内；如需切换请新建连接', db);
    }
    if (schema && schema !== spec.schema) {
      await handle.runSingle(`SET search_path TO ${quoteIdent('postgres', schema)}`, []);
    }
  }
}

async function countFor(handle: SqlHandle, engine: DialectKey, ref: string, whereClause: string, whereValues: unknown[]): Promise<number> {
  const r = await handle.runSingle(`SELECT COUNT(*) FROM ${ref} ${whereClause ? `WHERE ${whereClause}` : ''}`, whereValues);
  return Number(r.rows[0]?.[0] ?? 0);
}

function itemToOpItem(item: { fields: { name: string; columnType: import('@shared/result').ColumnType }[]; rows: unknown[][] }, ms: number): import('@shared/result').OpResultItem {
  if (item.rows.length === 0 && item.fields.length === 0) return { kind: 'ok', message: '执行成功', durationMs: ms };
  return { kind: 'resultset', resultset: toResultSet(item, ms) };
}
