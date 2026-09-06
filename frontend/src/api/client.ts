import type { ConnectionSpec, Transport, OpId, RequestEnvelope, ResponseEnvelope, OpResult } from '@shared/index';
import { ApiError } from './errors';
import { useAuth } from '../stores/auth';

/** op/传输 → EdgeOne 执行端点（edge 便宜层 vs node 直连层） */
export function endpointFor(op: OpId, transport?: Transport): string {
  if (op === 'auth.login') return '/api/auth';
  if (op === 'meta.capabilities' || op === 'meta.ping') return '/api/meta';
  if (transport === 'http-tunnel') return '/api/tunnel';
  return '/api/db';
}

export const REQUEST_TIMEOUT_MS = 70_000;

async function postJson(url: string, body: unknown, token?: string): Promise<{ status: number; json: unknown }> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    let json: unknown = null;
    const text = await res.text();
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: res.status, json };
  } catch (e) {
    if (ac.signal.aborted) throw new ApiError('TIMEOUT', '请求超时');
    throw new ApiError('BAD_REQUEST', '网络错误', e instanceof Error ? e.message : String(e));
  } finally {
    clearTimeout(timer);
  }
}

/** 登录（无需 token） */
export async function apiLogin(username: string, password: string): Promise<{ token: string; expiresAt: number; issuedAt: number }> {
  const { status, json } = await postJson('/api/auth', { username, password });
  const env = json as ResponseEnvelope;
  if (!env || env.ok !== true) {
    const e = (env as { error?: { code: string; message: string; detail?: string } })?.error;
    throw new ApiError(e?.code ?? 'UNAUTHORIZED', e?.message ?? '登录失败', e?.detail, status);
  }
  const data = env.result.kind === 'raw' ? (env.result.data as { token: string; expiresAt: number; issuedAt: number }) : null;
  if (!data?.token) throw new ApiError('UNAUTHORIZED', '登录返回异常');
  return data;
}

/** 通用执行调用：把封包打到对应端点并解码信封 */
export async function apiExec(
  op: OpId,
  args: Record<string, unknown>,
  connection: ConnectionSpec | null,
  transport?: Transport,
): Promise<OpResult> {
  const auth = useAuth();
  if (!auth.token) throw new ApiError('UNAUTHORIZED', '未登录');
  const envelope: RequestEnvelope = {
    protocolVersion: 1,
    transport: transport ?? connection?.ssh ? 'ssh' : connection?.tunnel ? 'http-tunnel' : 'direct',
    connection: (connection ?? {}) as ConnectionSpec,
    op,
    args,
  };
  const url = endpointFor(op, envelope.transport);
  const { status, json } = await postJson(url, envelope, auth.token);
  const env = json as ResponseEnvelope;
  if (!env || typeof env !== 'object' || !('ok' in env)) {
    throw new ApiError('BAD_REQUEST', '接口返回异常', JSON.stringify(json).slice(0, 300), status);
  }
  if (env.ok) return env.result;
  const err = env.error;
  const apiErr = new ApiError(err.code, err.message, err.detail, status);
  if (err.code === 'UNAUTHORIZED') auth.clear(); // 顺手清本地态，由路由守卫带去登录页
  throw apiErr;
}

/** 无连接的轻量调用（capabilities/ping） */
export async function apiMeta(op: 'meta.capabilities' | 'meta.ping'): Promise<unknown> {
  const auth = useAuth();
  if (!auth.token) throw new ApiError('UNAUTHORIZED', '未登录');
  const { status, json } = await postJson('/api/meta', { op }, auth.token);
  const env = json as ResponseEnvelope;
  if (env && env.ok) return env.result;
  const e = (env as { error?: { code: string; message: string; detail?: string } })?.error;
  throw new ApiError(e?.code ?? 'BAD_REQUEST', e?.message ?? '请求失败', e?.detail, status);
}
