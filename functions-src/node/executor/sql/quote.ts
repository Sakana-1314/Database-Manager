/** 标识符/字面量转义 + 占位符 —— 无任何 SQL 状态，纯函数。 */

export type DialectKey = 'mysql' | 'postgres';

const MYSQL_IDENT_OPEN = '`';
const PG_IDENT_OPEN = '"';

export function quoteIdent(engine: DialectKey, name: string): string {
  if (engine === 'mysql') {
    const open = MYSQL_IDENT_OPEN;
    return `${open}${name.replaceAll(open, `${open}${open}`)}${open}`;
  }
  const open = PG_IDENT_OPEN;
  return `${open}${name.replaceAll(open, `${open}${open}`)}${open}`;
}

/** 把 "schema.table" 变成带引号的限定名。schema 可为空。 */
export function qualify(engine: DialectKey, schema: string | undefined, table: string): string {
  if (engine === 'postgres' && schema && schema !== 'public' && schema !== '') {
    return `${quoteIdent(engine, schema)}.${quoteIdent(engine, table)}`;
  }
  // mysql 的 db.schema 概念 = database；由调用方用 database 限定
  return quoteIdent(engine, table);
}

/** 字符串字面量（仅在拼接非用户输入、如生成 DDL 预览时的默认值时使用） */
export function quoteString(engine: DialectKey, s: string): string {
  if (engine === 'mysql') {
    return `'${s.replaceAll('\\', '\\\\').replaceAll("'", "''")}'`;
  }
  return `'${s.replaceAll("'", "''")}'`;
}

export function placeholder(engine: DialectKey, index: number): string {
  return engine === 'mysql' ? '?' : `$${index}`;
}

/** LIMIT/OFFSET 分页子句 */
export function paginationClause(engine: DialectKey, page: number, pageSize: number): { limit: string; values: number[] } {
  // 统一用绑定参数，避免注入
  if (engine === 'postgres') return { limit: `LIMIT $1 OFFSET $2`, values: [pageSize, (page - 1) * pageSize] };
  return { limit: `LIMIT ? OFFSET ?`, values: [pageSize, (page - 1) * pageSize] };
}
