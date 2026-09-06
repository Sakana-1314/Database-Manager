import { resolveEnv, type EnvMap } from './env';
import type { RequestLike } from './request';

export interface Ctx {
  env: EnvMap;
  method: string;
  pathname: string;
  url: string;
  request: RequestLike;
  headers: { get?(k: string): string | null };
  /** 仅当 entry 需要把执行上下文传给下层（中间件 data 等） */
  data: Record<string, unknown>;
}

function pathOf(request: RequestLike, fallbackUrl: string | undefined): string {
  const u = (request as { url?: string }).url ?? fallbackUrl ?? '';
  if (!u) return '/';
  if (/^https?:\/\//i.test(u)) {
    try {
      return new URL(u).pathname;
    } catch {
      return u.split('?')[0] || '/';
    }
  }
  return u.split('?')[0] || '/';
}

function methodOf(request: RequestLike, ctxMethod: string | undefined): string {
  const m = (request as { method?: string }).method ?? ctxMethod;
  return (m ?? 'GET').toUpperCase();
}

export function makeCtx(context: unknown, opts?: { path?: string; method?: string; env?: EnvMap }): Ctx {
  const c = context as {
    request?: RequestLike;
    env?: unknown;
    url?: string;
    method?: string;
    pathname?: string;
  };
  const request = (c.request ?? context) as RequestLike;
  const headers = request.headers ? request.headers : { get: () => null };
  const pathname = opts?.path ?? c.pathname ?? pathOf(request, c.url);
  return {
    env: opts?.env ?? resolveEnv(c.env),
    method: opts?.method ?? methodOf(request, c.method),
    pathname,
    url: c.url ?? (request as { url?: string }).url ?? pathname,
    request,
    headers,
    data: {},
  };
}

export type HeadersLike = { get?(k: string): string | null };
