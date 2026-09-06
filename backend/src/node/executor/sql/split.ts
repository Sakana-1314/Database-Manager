import type { DialectKey } from './quote';

/**
 * 客户端 SQL 脚本切分器：把一段多语句脚本按顶层分号拆成独立语句。
 * 用于 PG（单次 query 不返回多结果集）的脚本模式；MySQL 走服务端 multipleStatements。
 * 覆盖：行/块注释、单双引号、MySQL 反引号标识符与反斜杠转义、PG 的 $tag$ dollar-quote、末尾分号。
 */
export function splitStatements(sql: string, engine: DialectKey): string[] {
  const out: string[] = [];
  let buf = '';
  let i = 0;
  const n = sql.length;
  let mode: 'code' | 'line' | 'block' | 'sq' | 'dq' | 'bt' | 'dollar' = 'code';
  let dollarTag = '';

  while (i < n) {
    const ch = sql[i];
    const next = i + 1 < n ? sql[i + 1] : '';

    if (mode === 'line') {
      if (ch === '\n') mode = 'code';
      buf += ch;
      i++;
      continue;
    }
    if (mode === 'block') {
      if (ch === '*' && next === '/') {
        buf += '*/';
        i += 2;
        mode = 'code';
      } else {
        buf += ch;
        i++;
      }
      continue;
    }
    if (mode === 'sq') {
      buf += ch;
      if (ch === '\\' && engine === 'mysql' && i + 1 < n) {
        buf += sql[i + 1];
        i += 2;
        continue;
      }
      if (ch === "'") mode = 'code';
      i++;
      continue;
    }
    if (mode === 'dq') {
      buf += ch;
      if (ch === '"' && sql[i - 1] !== '\\') mode = 'code';
      // PG 双引号内 "" 是转义；简化：遇到 " 且下一个不是 " 则结束
      if (ch === '"' && next === '"') {
        buf += next;
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    if (mode === 'bt') {
      buf += ch;
      if (ch === '`' && next === '`') {
        buf += next;
        i += 2;
        continue;
      }
      if (ch === '`') mode = 'code';
      i++;
      continue;
    }
    if (mode === 'dollar') {
      buf += ch;
      // 关闭 $tag$
      if (ch === '$' && sql.startsWith(dollarTag, i)) {
        const end = i + dollarTag.length;
        buf += sql.slice(i + 1, end);
        i = end;
        mode = 'code';
        dollarTag = '';
        continue;
      }
      i++;
      continue;
    }

    // code 模式
    if (ch === '-' && next === '-') {
      buf += '--';
      i += 2;
      mode = 'line';
      continue;
    }
    if (ch === '#') {
      // MySQL 特有单行注释
      buf += ch;
      i++;
      mode = 'line';
      continue;
    }
    if (ch === '/' && next === '*') {
      buf += '/*';
      i += 2;
      mode = 'block';
      continue;
    }
    if (ch === "'") {
      buf += ch;
      mode = 'sq';
      i++;
      continue;
    }
    if (engine !== 'mysql' && ch === '"') {
      buf += ch;
      mode = 'dq';
      i++;
      continue;
    }
    if (engine === 'mysql' && ch === '`') {
      buf += ch;
      mode = 'bt';
      i++;
      continue;
    }
    if (engine !== 'mysql' && ch === '$' && /[A-Za-z_$]/.test(next)) {
      // $tag$ 或 $1（位置参数）——但脚本模式无参数，直接 $ 开头当 dollar quote
      const m = /^\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$/.exec(sql.slice(i));
      if (m) {
        buf += m[0];
        dollarTag = m[0];
        i += m[0].length;
        mode = 'dollar';
        continue;
      }
    }
    if (ch === ';') {
      const trimmed = buf.trim();
      if (trimmed) out.push(trimmed);
      buf = '';
      i++;
      continue;
    }
    buf += ch;
    i++;
  }
  if (mode === 'block') {
    // 未闭合的块注释：整段丢弃剩余，避免吞掉下一句
    // 保守处理：把缓冲内容当作普通代码继续（通常 DDL 报语法错误）——这里直接丢弃到结尾
    return out;
  }
  const trimmed = buf.trim();
  if (trimmed) out.push(trimmed);
  return out;
}
