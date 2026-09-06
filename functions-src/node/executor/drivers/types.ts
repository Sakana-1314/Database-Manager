import type { ColumnType } from '@shared/result';

export interface RawField {
  name: string;
  columnType: ColumnType;
  engineType: string;
}

/** 驱动返回的最小公共原始结果（引擎无关） */
export interface RawResult {
  fields: RawField[];
  /** 与 fields 对齐的原始单元格值数组 */
  rows: unknown[][];
  affectedRows?: number;
  insertId?: unknown;
  message?: string;
}

/** 单个驱动连接的生命周期接口 */
export interface SqlHandle {
  engine: 'mysql' | 'postgres';
  /** 单条语句（可带参数），返回一个结果 */
  runSingle(sql: string, params?: unknown[]): Promise<RawResult>;
  /** 整段脚本：不拆句直接交给驱动多语句执行（仅 MySQL 使用） */
  runScriptNative?(sql: string): Promise<RawResult[]>;
  pingVersion(): Promise<string>;
  close(): Promise<void>;
}
