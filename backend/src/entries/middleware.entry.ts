import { verifyToken, bearerFromHeader } from '../auth/jwt';
import { resolveEnv } from '../core/env';
import { jsonResponse } from '../core/respond';

function pathOf(context: Record<string, unknown>): string {
  const req = context.request as { url?: string; method?: string } | undefined;
  const u = (req && req.url) || String(context.url || '/');
  if (/^https?:\/\//i.test(u)) {
    try {
      return new URL(u).pathname;
    } catch {
      /* ignore */
    }
  }
  return u.split('?')[0] || '/';
}

function unauth(): Response {
  return jsonResponse(401, { ok: false, error: { code: 'UNAUTHORIZED', message: '未登录或登录已过期' } });
}

/**
 * 根 middleware（Edge）：仅拦 /api/*（登录接口放行），校验 JWT。
 * 若运行时不支持 middleware，由各端点内的 requireAuth 兜底，本文件可忽略。
 * 返回 undefined / context.next() 继续处理，返回 Response 则短路。
 */
export async function onRequest(context: Record<string, unknown>): Promise<Response | undefined> {
  try {
    const method = String((context.request as { method?: string } | undefined)?.method ?? context.method ?? 'GET').toUpperCase();
    if (method === 'OPTIONS') return next(context);
    const path = pathOf(context);
    if (!path.startsWith('/api') || path === '/api/auth' || path === '/api/auth/') return next(context);

    const headers = (context.request as { headers?: { get?(k: string): string | null } })?.headers;
    const token = headers && bearerFromHeader(headers);
    if (!token) return unauth();
    try {
      await verifyToken(token, resolveEnv(context.env));
    } catch {
      return unauth();
    }
    (context as { data?: Record<string, unknown> }).data = { ...((context as { data?: Record<string, unknown> }).data ?? {}), user: 'admin' };
    return next(context);
  } catch {
    return next(context);
  }
}

function next(context: Record<string, unknown>): Response | undefined {
  const n = (context as { next?: () => unknown }).next;
  if (typeof n === 'function') {
    const out = n();
    // 有些运行时要求返回 Promise<Response | undefined>；直接返回原样
    return out as Response | undefined;
  }
  return undefined;
}

export default onRequest;
