import type { Column, ResultSet } from '@shared/index';
import { cellText, download } from './cell';

function csvEscape(v: string): string {
  if (/[",\n\r]/.test(v)) return '"' + v.replaceAll('"', '""') + '"';
  return v;
}

/** 结果集 → CSV 文本（UTF-8 兼容；前端导出时加 BOM） */
export function toCsv(resultset: ResultSet): string {
  const header = resultset.columns.map((c) => csvEscape(c.name)).join(',');
  const lines = resultset.rows.map((row) => resultset.columns.map((c) => csvEscape(cellText(row[c.name]))).join(','));
  return [header, ...lines].join('\r\n');
}

export function toJsonLines(resultset: ResultSet): string {
  return resultset.rows.map((r) => JSON.stringify(r)).join('\n');
}

export function toSqlInsert(resultset: ResultSet, table: string, schema?: string): string {
  const q = (s: string) => "'" + s.replaceAll("'", "''") + "'";
  const cols = resultset.columns.map((c) => c.name);
  const qualified = schema ? `"${schema}".${qIdent(table)}` : qIdent(table);
  const lines = resultset.rows.map((row) => {
    const vals = resultset.columns.map((c) => {
      const v = row[c.name];
      if (v === null || v === undefined) return 'NULL';
      if (typeof v === 'object') return q(JSON.stringify(v));
      if (typeof v === 'number') return String(v);
      if (typeof v === 'boolean') return v ? '1' : '0';
      return q(String(v));
    });
    return `INSERT INTO ${qualified} (${cols.map(qIdent).join(', ')}) VALUES (${vals.join(', ')});`;
  });
  return lines.join('\n');
}

function qIdent(s: string): string {
  return '`' + s.replaceAll('`', '``') + '`';
}

export function downloadResultset(resultset: ResultSet, kind: 'csv' | 'json' | 'sql', table?: string, schema?: string): void {
  const stamp = new Date().toISOString().slice(0, 19).replaceAll(':', '-');
  if (kind === 'csv') {
    // BOM 保证 Excel 中文不乱码
    download(`${table ?? 'export'}_${stamp}.csv`, '﻿' + toCsv(resultset), 'text/csv;charset=utf-8');
  } else if (kind === 'json') {
    download(`${table ?? 'export'}_${stamp}.jsonl`, toJsonLines(resultset), 'application/json;charset=utf-8');
  } else {
    download(`${table ?? 'export'}_${stamp}.sql`, toSqlInsert(resultset, table ?? 'table', schema), 'application/sql;charset=utf-8');
  }
}

export { cellText };
export type { Column };
