import type { CellValue, ColumnType } from '@shared/result';
import type { DialectKey } from './quote';

type DbCell = unknown;

/** DB 值 → 引擎无关 CellValue。colType 由元数据给出，决定对象/二进制如何打标签。 */
export function encodeCell(colType: ColumnType | undefined, v: DbCell): CellValue {
  if (v === undefined || v === null) return null;
  if (typeof v === 'bigint') return v.toString();
  if (Buffer.isBuffer(v)) return { $bin: (v as Buffer).toString('base64') };
  if (v instanceof Date) return v.toISOString();

  if (Array.isArray(v)) {
    // PG 数组 → 用 $json 承载以便 JSON 查看/编辑
    return { $json: (v as unknown[]).map((x) => encodeDeep(x)) };
  }
  if (typeof v === 'object') {
    if (colType === 'json' || colType === 'array') return { $json: v };
    return { $json: encodeDeep(v) };
  }
  return v as string | number | boolean;
}

function encodeDeep(x: unknown): unknown {
  if (x === null || x === undefined) return null;
  if (typeof x !== 'object') return x;
  if (Buffer.isBuffer(x)) return { $bin: (x as Buffer).toString('base64') };
  if (x instanceof Date) return x.toISOString();
  if (Array.isArray(x)) return x.map((y) => encodeDeep(y));
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(x as Record<string, unknown>)) out[k] = encodeDeep(val);
  return out;
}

/** 绑定参数解码：CellValue（含标签对象）→ 驱动可接受的 JS 值。 */
export function decodeParam(v: CellValue, engine: DialectKey, colType?: ColumnType): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    if ('$bin' in obj) return Buffer.from(String(obj.$bin), 'base64');
    if ('$json' in obj) {
      const inner = obj.$json;
      // MySQL 对对象参数只接受 JSON 列；这里统一交给驱动：pg 接受对象，mysql 则 JSON 序列化
      return engine === 'mysql' ? JSON.stringify(inner) : inner;
    }
    if ('$raw' in obj) return obj.$raw;
    // 普通对象（如 pg 数组已在 encode 时打 $json 标签）
    return engine === 'mysql' ? JSON.stringify(obj) : obj;
  }
  return v;
}

/** 把网格编辑/筛选里的“原始”值解析成 DB 比较值。 */
export function coerceCell(v: unknown): CellValue {
  return (v === undefined ? null : v) as CellValue;
}
