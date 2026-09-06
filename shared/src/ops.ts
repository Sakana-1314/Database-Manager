import type { Engine } from './spec';

/** 所有 op 的集合。授权登录本身在 /api/auth，仅含 auth.login。 */
export const OpId = {
  // —— 认证（edge /api/auth）——
  authLogin: 'auth.login',
  // —— 元（edge /api/meta，无传输）——
  capabilities: 'meta.capabilities',
  ping: 'meta.ping',
  // —— 控制台 / 执行（node /api/db 或 edge /api/tunnel）——
  testConnection: 'meta.testConnection',
  sqlRun: 'sql.run',
  sqlExplain: 'sql.explain',
  // —— 结构元数据（sql 引擎）——
  listDatabases: 'meta.listDatabases',
  listSchemas: 'meta.listSchemas',
  listTables: 'meta.listTables',
  listViews: 'meta.listViews',
  getColumns: 'meta.getColumns',
  getPrimaryKey: 'meta.getPrimaryKey',
  getIndexes: 'meta.getIndexes',
  getForeignKeys: 'meta.getForeignKeys',
  getTableInfo: 'meta.getTableInfo',
  getCreateTable: 'meta.getCreateTable',
  getRoutines: 'meta.getRoutines',
  dialectInfo: 'meta.dialectInfo',
  // —— 数据网格 / DML ——
  gridList: 'grid.list',
  gridCount: 'grid.count',
  dmlInsert: 'dml.insert',
  dmlUpdate: 'dml.update',
  dmlDeleteRows: 'dml.deleteRows',
  // —— DDL ——
  ddlCreateDatabase: 'ddl.createDatabase',
  ddlDropDatabase: 'ddl.dropDatabase',
  ddlExecute: 'ddl.execute',
  // —— Mongo（raw/Extended JSON）——
  mongoListDatabases: 'mongo.listDatabases',
  mongoListCollections: 'mongo.listCollections',
  mongoGetCollectionInfo: 'mongo.getCollectionInfo',
  mongoListIndexes: 'mongo.listIndexes',
  mongoRun: 'mongo.run',
  mongoCreateIndex: 'mongo.createIndex',
  mongoDropIndex: 'mongo.dropIndex',
  mongoDropCollection: 'mongo.dropCollection',
  mongoInsertMany: 'mongo.insertMany',
  mongoUpdateOne: 'mongo.updateOne',
  mongoDeleteOne: 'mongo.deleteOne',
  mongoCollectionStats: 'mongo.collectionStats',
} as const;

export type OpId = (typeof OpId)[keyof typeof OpId];

/** —— 参数类型定义（tunnel 实现的语义契约，见 tunnel/PROTOCOL.md） —— */

export type SortDir = 'asc' | 'desc';
export interface SortSpec {
  column: string;
  dir: SortDir;
}

export type FilterOp =
  | 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte'
  | 'like' | 'notLike' | 'in' | 'notIn' | 'between' | 'isNull' | 'notNull';

export interface FilterSpec {
  column: string;
  op: FilterOp;
  /** isNull/notNull 时省略 value；between 时为 [min,max]；in 时为数组 */
  value?: unknown;
}

export interface PkSpec {
  column: string;
  /** 网格中的单元格原始值（作为绑定参数使用） */
  value: unknown;
}

export interface ArgsMap {
  'auth.login': { username: string; password: string };
  'meta.capabilities': {};
  'meta.ping': {};
  'meta.testConnection': {};
  'sql.run': { sql: string; single?: boolean; database?: string; schema?: string };
  'sql.explain': { sql: string; analyze?: boolean; database?: string; schema?: string };
  // —— 结构元数据 ——
  'meta.listDatabases': {};
  'meta.listSchemas': { database: string };
  'meta.listTables': { database?: string; schema?: string };
  'meta.listViews': { database?: string; schema?: string };
  'meta.getColumns': { database?: string; schema?: string; table: string };
  'meta.getPrimaryKey': { database?: string; schema?: string; table: string };
  'meta.getIndexes': { database?: string; schema?: string; table: string };
  'meta.getForeignKeys': { database?: string; schema?: string; table: string };
  'meta.getTableInfo': { database?: string; schema?: string; table: string };
  'meta.getCreateTable': { database?: string; schema?: string; table: string };
  'meta.getRoutines': { database?: string; schema?: string; kind?: 'procedure' | 'function' };
  'meta.dialectInfo': {};
  // —— 数据网格 / DML ——
  'grid.list': {
    database?: string; schema?: string; table: string;
    page: number; pageSize: number;
    sort?: SortSpec[]; filter?: FilterSpec[]; columns?: string[];
    count?: boolean;
  };
  'grid.count': { database?: string; schema?: string; table: string; filter?: FilterSpec[] };
  'dml.insert': { database?: string; schema?: string; table: string; rows: RowLike[] };
  'dml.update': { database?: string; schema?: string; table: string; pks: PkSpec[]; values: RowLike };
  'dml.deleteRows': { database?: string; schema?: string; table: string; pks: PkSpec[][] };
  // —— DDL ——
  'ddl.createDatabase': { database: string; collation?: string; charset?: string };
  'ddl.dropDatabase': { database: string; confirm?: boolean };
  'ddl.execute': { database?: string; schema?: string; sql: string };
  // —— Mongo（值一律 Extended JSON；集合级 op 需要 db/collection）——
  'mongo.listDatabases': {};
  'mongo.listCollections': { db: string };
  'mongo.getCollectionInfo': { db: string; collection: string };
  'mongo.listIndexes': { db: string; collection: string };
  'mongo.run': {
    db: string; collection?: string; mode: 'find' | 'aggregate' | 'count';
    filter?: unknown; project?: unknown; sort?: unknown; limit?: number; skip?: number;
    pipeline?: unknown[];
  };
  'mongo.createIndex': { db: string; collection: string; keys: Record<string, number | string>; options?: Record<string, unknown> };
  'mongo.dropIndex': { db: string; collection: string; index: string };
  'mongo.dropCollection': { db: string; collection: string; confirm?: boolean };
  'mongo.insertMany': { db: string; collection: string; documents: unknown[] };
  'mongo.updateOne': { db: string; collection: string; filter: unknown; update: unknown; upsert?: boolean };
  'mongo.deleteOne': { db: string; collection: string; filter: unknown };
  'mongo.collectionStats': { db: string; collection: string };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RowLike = Record<string, any>;

/** op → 支持的引擎（capability 门禁表，前后端共享同一份事实） */
export const OP_ENGINES: Record<OpId, Engine[]> = {
  'auth.login': [],
  'meta.capabilities': [],
  'meta.ping': [],
  'meta.testConnection': ['mysql', 'postgres', 'mongodb'],
  'sql.run': ['mysql', 'postgres'],
  'sql.explain': ['mysql', 'postgres'],
  'meta.listDatabases': ['mysql', 'postgres'],
  'meta.listSchemas': ['postgres'],
  'meta.listTables': ['mysql', 'postgres'],
  'meta.listViews': ['mysql', 'postgres'],
  'meta.getColumns': ['mysql', 'postgres'],
  'meta.getPrimaryKey': ['mysql', 'postgres'],
  'meta.getIndexes': ['mysql', 'postgres'],
  'meta.getForeignKeys': ['mysql', 'postgres'],
  'meta.getTableInfo': ['mysql', 'postgres'],
  'meta.getCreateTable': ['mysql', 'postgres'],
  'meta.getRoutines': ['mysql', 'postgres'],
  'meta.dialectInfo': ['mysql', 'postgres'],
  'grid.list': ['mysql', 'postgres'],
  'grid.count': ['mysql', 'postgres'],
  'dml.insert': ['mysql', 'postgres'],
  'dml.update': ['mysql', 'postgres'],
  'dml.deleteRows': ['mysql', 'postgres'],
  'ddl.createDatabase': ['mysql', 'postgres'],
  'ddl.dropDatabase': ['mysql', 'postgres'],
  'ddl.execute': ['mysql', 'postgres'],
  'mongo.listDatabases': ['mongodb'],
  'mongo.listCollections': ['mongodb'],
  'mongo.getCollectionInfo': ['mongodb'],
  'mongo.listIndexes': ['mongodb'],
  'mongo.run': ['mongodb'],
  'mongo.createIndex': ['mongodb'],
  'mongo.dropIndex': ['mongodb'],
  'mongo.dropCollection': ['mongodb'],
  'mongo.insertMany': ['mongodb'],
  'mongo.updateOne': ['mongodb'],
  'mongo.deleteOne': ['mongodb'],
  'mongo.collectionStats': ['mongodb'],
};

/** 人类可读的中文描述，前端按钮/文档用 */
export const OP_LABELS: Record<OpId, string> = {
  'auth.login': '登录',
  'meta.capabilities': '能力表',
  'meta.ping': '心跳',
  'meta.testConnection': '测试连接',
  'sql.run': '执行 SQL',
  'sql.explain': '执行计划',
  'meta.listDatabases': '列出数据库',
  'meta.listSchemas': '列出模式',
  'meta.listTables': '列出表',
  'meta.listViews': '列出视图',
  'meta.getColumns': '读取列信息',
  'meta.getPrimaryKey': '读取主键',
  'meta.getIndexes': '读取索引',
  'meta.getForeignKeys': '读取外键',
  'meta.getTableInfo': '读取表信息',
  'meta.getCreateTable': '读取建表语句',
  'meta.getRoutines': '读取存储过程',
  'meta.dialectInfo': '方言信息',
  'grid.list': '浏览数据',
  'grid.count': '行数统计',
  'dml.insert': '插入行',
  'dml.update': '更新行',
  'dml.deleteRows': '删除行',
  'ddl.createDatabase': '创建数据库',
  'ddl.dropDatabase': '删除数据库',
  'ddl.execute': '执行 DDL',
  'mongo.listDatabases': '列出数据库',
  'mongo.listCollections': '列出集合',
  'mongo.getCollectionInfo': '集合信息',
  'mongo.listIndexes': '列出索引',
  'mongo.run': 'Mongo 查询',
  'mongo.createIndex': '创建索引',
  'mongo.dropIndex': '删除索引',
  'mongo.dropCollection': '删除集合',
  'mongo.insertMany': '插入文档',
  'mongo.updateOne': '更新文档',
  'mongo.deleteOne': '删除文档',
  'mongo.collectionStats': '集合统计',
};
