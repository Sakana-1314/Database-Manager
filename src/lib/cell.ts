import type { CellValue } from '@shared/index';

/** 把引擎无关 CellValue 渲染成可读文本 */
export function cellText(v: CellValue | undefined): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'object') {
    if ('$bin' in v) return `[二进制 ${String((v as { $bin: string }).$bin).length}B]`;
    if ('$json' in v) return pretty(v.$json, false);
    if ('$raw' in v) return pretty(v.$raw, false);
    return pretty(v, false);
  }
  return String(v);
}

export function isJsonCell(v: CellValue | undefined): boolean {
  return !!v && typeof v === 'object' && ('$json' in v || '$raw' in v);
}

export function pretty(v: unknown, indent = true): string {
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v, null, indent ? 2 : undefined) ?? String(v);
  } catch {
    return String(v);
  }
}

export function compactJson(v: unknown, max = 300): string {
  const s = pretty(v, false);
  return s.length > max ? s.slice(0, max) + '…' : s;
}

export function download(filename: string, text: string, mime = 'text/plain;charset=utf-8'): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 数字对齐等网格偏好 */
export function isNumericColumn(type: string): boolean {
  return ['int', 'number', 'decimal'].includes(type);
}

export function tsLabel(ms?: number): string {
  if (ms === undefined) return '';
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(2)} s`;
}
