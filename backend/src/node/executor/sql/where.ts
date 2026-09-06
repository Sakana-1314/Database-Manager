import type { FilterSpec, SortSpec } from '@shared/ops';
import type { DialectKey } from './quote';
import { quoteIdent } from './quote';

export interface BuiltFilter {
  /** 形如 "col1 = ? AND col2 >= ?" 或 ""（无过滤） */
  clause: string;
  /** 依出现顺序的绑定值 */
  values: unknown[];
}

function ph(engine: DialectKey, index: number): string {
  return engine === 'mysql' ? '?' : `$${index}`;
}

export function buildFilter(engine: DialectKey, filters: FilterSpec[] | undefined): BuiltFilter {
  if (!filters || filters.length === 0) return { clause: '', values: [] };
  const parts: string[] = [];
  const values: unknown[] = [];
  let idx = 1;
  for (const f of filters) {
    const col = quoteIdent(engine, f.column);
    switch (f.op) {
      case 'eq': parts.push(`${col} = ${ph(engine, idx++)}`); values.push(f.value); break;
      case 'ne': parts.push(`${col} <> ${ph(engine, idx++)}`); values.push(f.value); break;
      case 'gt': parts.push(`${col} > ${ph(engine, idx++)}`); values.push(f.value); break;
      case 'gte': parts.push(`${col} >= ${ph(engine, idx++)}`); values.push(f.value); break;
      case 'lt': parts.push(`${col} < ${ph(engine, idx++)}`); values.push(f.value); break;
      case 'lte': parts.push(`${col} <= ${ph(engine, idx++)}`); values.push(f.value); break;
      case 'like': parts.push(`${col} LIKE ${ph(engine, idx++)}`); values.push(f.value); break;
      case 'notLike': parts.push(`${col} NOT LIKE ${ph(engine, idx++)}`); values.push(f.value); break;
      case 'in': {
        const arr = Array.isArray(f.value) ? f.value : [f.value];
        const marks = arr.map(() => ph(engine, idx++)).join(', ');
        parts.push(`${col} IN (${marks})`);
        values.push(...arr);
        break;
      }
      case 'notIn': {
        const arr = Array.isArray(f.value) ? f.value : [f.value];
        const marks = arr.map(() => ph(engine, idx++)).join(', ');
        parts.push(`${col} NOT IN (${marks})`);
        values.push(...arr);
        break;
      }
      case 'between': {
        const [a, b] = Array.isArray(f.value) ? f.value : [f.value, f.value];
        parts.push(`${col} BETWEEN ${ph(engine, idx++)} AND ${ph(engine, idx++)}`);
        values.push(a, b);
        break;
      }
      case 'isNull': parts.push(`${col} IS NULL`); break;
      case 'notNull': parts.push(`${col} IS NOT NULL`); break;
      default: throw new Error(`unsupported filter op: ${(f as FilterSpec).op}`);
    }
  }
  return { clause: parts.length ? parts.join(' AND ') : '', values };
}

export function buildOrderBy(engine: DialectKey, sort: SortSpec[] | undefined): string {
  if (!sort || sort.length === 0) return '';
  const parts = sort.map((s) => `${quoteIdent(engine, s.column)} ${s.dir === 'desc' ? 'DESC' : 'ASC'}`);
  return `ORDER BY ${parts.join(', ')}`;
}
