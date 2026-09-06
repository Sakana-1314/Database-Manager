import type { ColumnType } from '@shared/result';
import { quoteIdent } from './sql/quote';
import type { SqlHandle } from './drivers/types';

export interface TableMeta { name: string; kind: 'table' | 'view' | 'routine'; rows?: number; comment?: string; engine?: string; sizeBytes?: number }
export interface ColumnMeta {
  name: string; type: ColumnType; engineType: string; nullable: boolean;
  key?: string; default?: unknown; extra?: string; comment?: string; ordinal: number;
}
export interface IndexMeta { name: string; columns: string[]; unique: boolean; primary: boolean }
export interface FkMeta { name: string; columns: string[]; refTable: string; refColumns: string[]; onUpdate?: string; onDelete?: string }

type E = 'mysql' | 'postgres';

/** MySQL → ColumnType（精细，依据 information_schema COLUMN_TYPE） */
function myColType(columnType: string, dataType: string): ColumnType {
  const c = columnType.toLowerCase();
  if (/json/i.test(dataType)) return 'json';
  if (/tinyint\(1\)/.test(c) || /bool|boolean/.test(dataType)) return 'bool';
  if (/^(big|tiny|small|medium|int|integer)/i.test(dataType)) return 'int';
  if (/decimal|numeric|double|float|real/i.test(dataType)) return 'decimal';
  if (/^date$/.test(dataType)) return 'date';
  if (/timestamp|datetime/.test(dataType)) return 'datetime';
  if (/^time|year/.test(dataType)) return 'time';
  if (/blob|binary|varbinary|bit|geometry|point|polygon/.test(dataType)) return 'binary';
  if (/char|text|enum|set/.test(dataType)) return 'varchar';
  return 'other';
}

/** PG udt_name → ColumnType */
function pgColType(udt: string): ColumnType {
  const t = udt.replace(/^_/, '');
  if (t !== udt) return 'array';
  switch (t) {
    case 'int2': case 'int4': case 'int8': case 'oid': case 'xid': case 'int': return 'int';
    case 'float4': case 'float8': return 'number';
    case 'numeric': case 'money': return 'decimal';
    case 'bool': return 'bool';
    case 'date': return 'date';
    case 'timestamp': case 'timestamptz': return 'datetime';
    case 'time': case 'timetz': case 'interval': return 'time';
    case 'bytea': return 'binary';
    case 'json': case 'jsonb': return 'json';
    case 'uuid': return 'uuid';
    default: return 'varchar';
  }
}

export interface Intro {
  listDatabases(): Promise<string[]>;
  listTables(db?: string, schema?: string, kind?: 'table' | 'view'): Promise<TableMeta[]>;
  columns(db?: string, schema?: string, table?: string): Promise<ColumnMeta[]>;
  pk(db?: string, schema?: string, table?: string): Promise<string[]>;
  indexes(db?: string, schema?: string, table?: string): Promise<IndexMeta[]>;
  fks(db?: string, schema?: string, table?: string): Promise<FkMeta[]>;
  tableInfo(db?: string, schema?: string, table?: string): Promise<Partial<TableMeta>>;
  createTableSql(db?: string, schema?: string, table?: string): Promise<{ sql: string; approximate?: boolean }>;
}

export function introspect(handle: SqlHandle): Intro {
  const engine: E = handle.engine;
  const q = (sql: string, params: unknown[]) => handle.runSingle(sql, params);

  if (engine === 'mysql') {
    return {
      async listDatabases() {
        const r = await q('SELECT schema_name FROM information_schema.schemata ORDER BY schema_name', []);
        return r.rows.map((row) => String(row[0]));
      },
      async listTables(db, _schema, kind) {
        const isView = kind === 'view';
        const typeCond = isView ? `table_type = 'VIEW'` : `table_type IN ('BASE TABLE','SYSTEM VERSIONED')`;
        const r = await q(
          `SELECT table_name, table_type, table_rows, table_comment, engine FROM information_schema.tables WHERE table_schema = ? AND ${typeCond} ORDER BY table_name`,
          [db],
        );
        return r.rows.map((row) => ({
          name: String(row[0]),
          kind: (String(row[1]).includes('VIEW') ? 'view' : 'table') as TableMeta['kind'],
          rows: row[2] === null ? undefined : Number(row[2]),
          comment: row[3] ? String(row[3]) : undefined,
          engine: row[4] ? String(row[4]) : undefined,
        }));
      },
      async columns(db, _schema, table) {
        const r = await q(
          `SELECT c.column_name, c.data_type, c.column_type, c.is_nullable, c.column_key, c.column_default, c.extra, c.ordinal_position,
                  c.character_maximum_length, c.numeric_precision, c.numeric_scale,
                  (SELECT col.comment FROM information_schema.columns col WHERE col.table_schema=c.table_schema AND col.table_name=c.table_name AND col.column_name=c.column_name) AS ccomment
           FROM information_schema.columns c
           WHERE c.table_schema=? AND c.table_name=? ORDER BY c.ordinal_position`,
          [db, table],
        );
        return r.rows.map((row, i) => {
          const dataType = String(row[1]);
          const columnType = row[2] ? String(row[2]) : dataType;
          return {
            name: String(row[0]),
            type: myColType(columnType, dataType),
            engineType: columnType,
            nullable: String(row[3]).toUpperCase() === 'YES',
            key: row[4] ? String(row[4]) : undefined,
            default: row[5],
            extra: row[6] ? String(row[6]) : undefined,
            comment: row[10] ? String(row[10]) : undefined,
            ordinal: i + 1,
          };
        });
      },
      async pk(db, _schema, table) {
        const r = await q(
          `SELECT kcu.column_name FROM information_schema.key_column_usage kcu
           WHERE kcu.table_schema=? AND kcu.table_name=? AND kcu.constraint_name='PRIMARY'
           ORDER BY kcu.ordinal_position`,
          [db, table],
        );
        return r.rows.map((row) => String(row[0]));
      },
      async indexes(db, _schema, table) {
        const r = await q(
          `SELECT index_name, MAX(non_unique), index_type FROM information_schema.statistics
           WHERE table_schema=? AND table_name=? GROUP BY index_name, index_type ORDER BY MIN(seq_in_index)`,
          [db, table],
        );
        const cols = await q(
          `SELECT index_name, column_name FROM information_schema.statistics
           WHERE table_schema=? AND table_name=? ORDER BY seq_in_index`,
          [db, table],
        );
        const colMap = new Map<string, string[]>();
        for (const row of cols.rows) {
          const key = String(row[0]);
          if (!colMap.has(key)) colMap.set(key, []);
          colMap.get(key)!.push(String(row[1]));
        }
        return r.rows.map((row) => {
          const name = String(row[0]);
          return { name, columns: colMap.get(name) ?? [], unique: Number(row[1]) === 0, primary: name === 'PRIMARY' };
        });
      },
      async fks(db, _schema, table) {
        const r = await q(
          `SELECT rc.constraint_name, kcu.column_name, kcu.referenced_table_name, kcu.referenced_column_name,
                  rc.update_rule, rc.delete_rule
           FROM information_schema.referential_constraints rc
           JOIN information_schema.key_column_usage kcu
             ON rc.constraint_schema = kcu.constraint_schema AND rc.constraint_name = kcu.constraint_name
           WHERE rc.constraint_schema = ? AND kcu.table_name = ?
           ORDER BY kcu.ordinal_position`,
          [db, table],
        );
        const map = new Map<string, FkMeta>();
        for (const row of r.rows) {
          const name = String(row[0]);
          const cur = map.get(name) ?? {
            name, columns: [], refTable: String(row[2]), refColumns: [], onUpdate: String(row[4]), onDelete: String(row[5]),
          };
          cur.columns.push(String(row[1]));
          cur.refColumns.push(String(row[3]));
          map.set(name, cur);
        }
        return [...map.values()];
      },
      async tableInfo(db, _schema, table) {
        const r = await q(
          `SELECT table_rows, engine, table_collation, table_comment, (data_length + index_length)
           FROM information_schema.tables WHERE table_schema=? AND table_name=?`,
          [db, table],
        );
        const row = r.rows[0];
        if (!row) return {};
        return { rows: row[0] === null ? undefined : Number(row[0]), engine: row[1] ? String(row[1]) : undefined, comment: row[3] ? String(row[3]) : undefined, sizeBytes: Number(row[4] ?? 0) };
      },
      async createTableSql(db, _schema, table) {
        if (!db || !table) throw new Error('mysql createTableSql 需要 db + table');
        const r = await handle.runSingle(`SHOW CREATE TABLE ${quoteIdent('mysql', db)}.${quoteIdent('mysql', table)}`, []);
        // SHOW CREATE TABLE 第二列即语句
        const sql = r.rows[0]?.[1] ? String(r.rows[0]![1]) : '';
        return { sql };
      },
    };
  }

  // —— PostgreSQL ——
  return {
    async listDatabases() {
      const r = await q('SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname', []);
      return r.rows.map((row) => String(row[0]));
    },
    async listTables(_db, schema, kind) {
      const sch = schema || 'public';
      const typeCond = kind === 'view' ? "c.relkind = 'v'" : "c.relkind IN ('r','p')";
      const r = await q(
        `SELECT c.relname AS name, c.relkind AS kind, c.reltuples::bigint AS rows, obj_description(c.oid) AS comment
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = $1 AND ${typeCond} ORDER BY c.relname`,
        [sch],
      );
      return r.rows.map((row) => ({
        name: String(row[0]),
        kind: (String(row[1]) === 'v' ? 'view' : 'table') as TableMeta['kind'],
        rows: row[2] === null ? undefined : Number(row[2]),
        comment: row[3] ? String(row[3]) : undefined,
      }));
    },
    async columns(_db, schema, table) {
      const r = await q(
        `SELECT c.column_name, c.data_type, c.udt_name, c.is_nullable, c.column_default,
                c.character_maximum_length, c.numeric_precision, c.ordinal_position, c.is_identity,
                col_description(format('%I.%I', c.table_schema, c.table_name)::regclass, c.ordinal_position) AS comment
         FROM information_schema.columns c
         WHERE c.table_schema = $1 AND c.table_name = $2 ORDER BY c.ordinal_position`,
        [schema || 'public', table],
      );
      return r.rows.map((row) => {
        const udt = String(row[2]);
        return {
          name: String(row[0]),
          type: pgColType(udt),
          engineType: /^_/.test(udt) ? `${udt.slice(1)}[]` : udt,
          nullable: String(row[3]).toUpperCase() === 'YES',
          default: row[4],
          extra: row[8] === 'YES' ? 'identity' : undefined,
          comment: row[9] ? String(row[9]) : undefined,
          ordinal: Number(row[7]),
        };
      });
    },
    async pk(_db, schema, table) {
      const r = await q(
        `SELECT a.attname FROM pg_index ix
         JOIN pg_class t ON t.oid = ix.indrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
         JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
         JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
         WHERE n.nspname = $1 AND t.relname = $2 AND ix.indisprimary ORDER BY k.ord`,
        [schema || 'public', table],
      );
      return r.rows.map((row) => String(row[0]));
    },
    async indexes(_db, schema, table) {
      const r = await q(
        `SELECT i.relname AS index_name, ix.indisunique AS uq, ix.indisprimary AS pk,
                a.attname AS column_name, k.ord
         FROM pg_index ix
         JOIN pg_class i ON i.oid = ix.indexrelid
         JOIN pg_class t ON t.oid = ix.indrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
         JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
         JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
         WHERE n.nspname = $1 AND t.relname = $2
         ORDER BY i.relname, k.ord`,
        [schema || 'public', table],
      );
      const map = new Map<string, IndexMeta>();
      for (const row of r.rows) {
        const name = String(row[0]);
        const cur = map.get(name) ?? {
          name, columns: [], unique: row[1] === true || row[1] === 't', primary: row[2] === true || row[2] === 't',
        };
        cur.columns.push(String(row[3]));
        map.set(name, cur);
      }
      return [...map.values()];
    },
    async fks(_db, schema, table) {
      const r = await q(
        `SELECT con.conname, a.attname, ft.relname, fa.attname,
                conf.confupdtype, conf.confdeltype
         FROM pg_constraint con
         JOIN pg_class t ON t.oid = con.conrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
         JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
         JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
         JOIN LATERAL unnest(con.confkey) WITH ORDINALITY AS fk(attnum, ford) ON true AND fk.ford = k.ord
         JOIN pg_class ft ON ft.oid = con.confrelid
         JOIN pg_attribute fa ON fa.attrelid = ft.oid AND fa.attnum = fk.attnum
         WHERE con.contype = 'f' AND n.nspname = $1 AND t.relname = $2
         ORDER BY k.ord`,
        [schema || 'public', table],
      );
      const rule: Record<string, string> = { a: 'NO ACTION', r: 'RESTRICT', c: 'CASCADE', n: 'SET NULL', d: 'SET DEFAULT' };
      const map = new Map<string, FkMeta>();
      for (const row of r.rows) {
        const name = String(row[0]);
        const cur = map.get(name) ?? {
          name, columns: [], refTable: String(row[2]), refColumns: [], onUpdate: rule[String(row[4])], onDelete: rule[String(row[5])],
        };
        cur.columns.push(String(row[1]));
        cur.refColumns.push(String(row[3]));
        map.set(name, cur);
      }
      return [...map.values()];
    },
    async tableInfo(_db, schema, table) {
      const r = await q(
        `SELECT c.reltuples::bigint, pg_total_relation_size(c.oid), obj_description(c.oid)
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = $1 AND c.relname = $2`,
        [schema || 'public', table],
      );
      const row = r.rows[0];
      if (!row) return {};
      return { rows: row[0] === null ? undefined : Number(row[0]), sizeBytes: Number(row[1] ?? 0), comment: row[2] ? String(row[2]) : undefined };
    },
    async createTableSql(_db, schema, table) {
      const cols = await this.columns(undefined, schema || 'public', table);
      const pk = await this.pk(undefined, schema || 'public', table);
      const parts = cols.map((c) => {
        const nulls = c.nullable ? '' : ' NOT NULL';
        const def = c.default !== null && c.default !== undefined && c.default !== '' ? ` DEFAULT ${c.default}` : '';
        return `  ${quoteIdent('postgres', c.name)} ${c.engineType}${nulls}${def}`;
      });
      if (pk.length) parts.push(`  PRIMARY KEY (${pk.map((p) => quoteIdent('postgres', p)).join(', ')})`);
      const sql = `CREATE TABLE ${quoteIdent('postgres', schema || 'public')}.${quoteIdent('postgres', table!)} (\n${parts.join(',\n')}\n);`;
      return { sql, approximate: true };
    },
  };
}
