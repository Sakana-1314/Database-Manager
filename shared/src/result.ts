/**
 * 引擎无关的结果形态。序列化约定：
 *  - bigint / decimal / numeric → string（避免精度丢失）
 *  - Date / time / interval → ISO-8601 字符串
 *  - binary / bytea / varbinary / BLOB → { $bin: <base64> }
 *  - MySQL JSON 列 → 解析为 { $json: <object> }，网格按 JSON 渲染
 *  - Mongo：整个结果走 kind:'raw'，值为 Extended JSON（含 $oid/$date/$binary …）
 */

export type ColumnType =
  | 'int'
  | 'number'
  | 'decimal'
  | 'text'
  | 'varchar'
  | 'bool'
  | 'date'
  | 'datetime'
  | 'time'
  | 'binary'
  | 'json'
  | 'uuid'
  | 'array'
  | 'other';

export interface Column {
  name: string;
  /** 数据库原生类型名，如 varchar(255)、timestamptz */
  engineType: string;
  type: ColumnType;
  nullable?: boolean;
}

/** 单元格值；带标签对象用于表达二进制 / 嵌套 JSON */
export type CellValue =
  | null
  | string
  | number
  | boolean
  | { $bin: string }
  | { $json: unknown }
  | { $raw: unknown };

export type Row = Record<string, CellValue>;

/** 一个结果集（SELECT/元数据结果）。rows 已按列序对齐到 columns。 */
export interface ResultSet {
  columns: Column[];
  rows: Row[];
  /** 本批行数（受上限截断，见 truncated） */
  rowCount: number;
  truncated: boolean;
  durationMs: number;
  affectedRows?: number;
  insertId?: string | number | null;
  /** 例如 SHOW WARNINGS / 语句说明 */
  message?: string;
}

export type OpResultItem =
  | { kind: 'resultset'; resultset: ResultSet }
  | { kind: 'ok'; affectedRows?: number; insertId?: string | number | null; message?: string; durationMs?: number };

export type OpResult =
  | { kind: 'resultset'; resultset: ResultSet }
  | { kind: 'multiple'; items: OpResultItem[]; durationMs: number }
  | { kind: 'raw'; data: unknown; meta?: { durationMs?: number; truncated?: boolean } }
  | { kind: 'ok'; message?: string; affectedRows?: number; durationMs?: number };

/** 查询网格分页信息（grid.list 专用返回值） */
export interface GridPage {
  resultset: ResultSet;
  hasMore: boolean;
  /** 精确计数或近似值；仅当本次请求带 count=true */
  total?: number;
}
