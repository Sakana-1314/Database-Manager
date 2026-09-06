import { AppError } from '../errors';

/** Request-like：平台给的是标准 Request；部分旧 node-functions 文档示例里 body 已被解析成 JSON 对象。 */
export type RequestLike =
  | { json(): Promise<unknown>; arrayBuffer(): Promise<ArrayBuffer>; headers: { get?(k: string): string | null }; body?: unknown; method?: string; url?: string }
  | { body?: unknown; headers?: { get?(k: string): string | null }; method?: string; url?: string };

function hasFn(x: unknown, k: string): boolean {
  return typeof (x as Record<string, unknown>)?.[k] === 'function';
}

function isParsedObject(v: unknown): boolean {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export async function readJsonBody(req: RequestLike, maxBytes: number): Promise<unknown> {
  const r = req as { json?: () => Promise<unknown>; arrayBuffer?: () => Promise<ArrayBuffer>; headers?: { get?(k: string): string | null }; body?: unknown };
  // 1) 旧运行时：body 已是解析好的 JSON 对象
  if (r.body !== undefined && isParsedObject(r.body) && !hasFn(r, 'arrayBuffer') && !hasFn(r, 'json')) {
    return r.body;
  }
  // 2) 标准 Request：先查 Content-Length 上限，再 json()
  const cl = Number(r.headers?.get?.('content-length'));
  if (Number.isFinite(cl) && cl > maxBytes) {
    throw new AppError('PAYLOAD_TOO_LARGE', '请求体超出大小上限', { status: 413 });
  }
  if (hasFn(r, 'json')) {
    try {
      return await (r as { json(): Promise<unknown> }).json();
    } catch (e) {
      if (r.body === undefined) {
        // 空 body 也当作合法（便于 health/ping 简化调用）
        return {};
      }
      throw new AppError('DECODE', '请求体不是合法 JSON', { detail: e instanceof Error ? e.message : String(e) });
    }
  }
  if (hasFn(r, 'arrayBuffer')) {
    const buf = await (r as { arrayBuffer(): Promise<ArrayBuffer> }).arrayBuffer();
    if (buf.byteLength > maxBytes) throw new AppError('PAYLOAD_TOO_LARGE', '请求体超出大小上限', { status: 413 });
    const text = new TextDecoder().decode(buf);
    if (!text.trim()) return {};
    try {
      return JSON.parse(text);
    } catch (e) {
      throw new AppError('DECODE', '请求体不是合法 JSON', { detail: e instanceof Error ? e.message : String(e) });
    }
  }
  throw new AppError('BAD_REQUEST', '无法读取请求体');
}
