import type { RequestEnvelope } from '@shared/protocol';
import type { CoreHandler } from '../entry';
import { readJsonBody } from '../request';
import { okEnvelope, jsonResponse } from '../respond';
import { readLimits } from '../limits';
import { requireAuth } from '../../auth/guard';
import { AppError } from '../../errors';

function asEnvelope(v: unknown): RequestEnvelope | null {
  if (!v || typeof v !== 'object') return null;
  const e = v as Partial<RequestEnvelope>;
  if (e.transport !== 'http-tunnel' || typeof e.op !== 'string' || typeof e.args !== 'object') return null;
  return e as RequestEnvelope;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ac.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** POST /api/tunnel —— edge 中继：登录校验 → 把 op 包转发给用户自建隧道，透传封包。 */
export const tunnelCore: CoreHandler = async (ctx) => {
  const limits = readLimits(ctx.env);
  await requireAuth(ctx.headers, ctx.env);
  const raw = await readJsonBody(ctx.request, limits.maxPayloadBytes);
  const envelope = asEnvelope(raw);
  if (!envelope) throw AppError.badRequest('无效的隧道请求封包');

  const tun = envelope.connection?.tunnel;
  if (!tun?.baseUrl || !tun.profile) {
    throw AppError.badRequest('缺少 tunnel.baseUrl / tunnel.profile');
  }
  if (!/^https?:\/\//i.test(tun.baseUrl)) {
    throw new AppError('TUNNEL_UNREACHABLE', '隧道地址必须为 http(s) URL');
  }

  const secret = tun.sharedSecret ?? ctx.env.TUNNEL_SHARED_SECRET;
  const authHeader = ctx.headers.get?.('authorization') ?? '';

  const body = JSON.stringify({
    protocolVersion: envelope.protocolVersion,
    profile: tun.profile,
    engine: envelope.connection?.engine,
    op: envelope.op,
    args: envelope.args,
  });

  const upstream = await fetchWithTimeout(
    tun.baseUrl,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(secret ? { 'x-tunnel-secret': secret } : {}),
        ...(authHeader ? { authorization: authHeader } : {}),
      },
      body,
    },
    limits.slowTimeoutMs,
  ).catch((e) => {
    throw new AppError('TUNNEL_UNREACHABLE', `无法到达隧道服务器`, { detail: e instanceof Error ? e.message : String(e) });
  });

  // 透传（隧道返回同构封包）。限制体积防止放大。
  const bytes = await upstream.arrayBuffer().catch(() => new ArrayBuffer(0));
  if (bytes.byteLength > limits.maxResultBytes) {
    throw new AppError('PAYLOAD_TOO_LARGE', '隧道返回超出大小上限');
  }
  const text = new TextDecoder().decode(bytes);
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === 'object' && 'ok' in (parsed as object)) {
      // 尽量保留隧道自己给出的状态码语义（token 过期等 401）
      const status = upstream.ok ? 200 : ((parsed as { error?: { code?: string } }).error?.code === 'UNAUTHORIZED' ? 401 : (upstream.status || 502));
      return jsonResponse(status, parsed);
    }
  } catch {
    /* 非 JSON 走下面包装 */
  }
  return jsonResponse(502, { ok: false, error: { code: 'TUNNEL_UNREACHABLE', message: `隧道返回异常（HTTP ${upstream.status}）` } });
};

/** ping 别名，前端隧道健康徽标用 */
export const tunnelPingCore: CoreHandler = async (ctx) => {
  await requireAuth(ctx.headers, ctx.env);
  return okEnvelope({ kind: 'raw', data: { via: 'tunnel', ok: true } });
};
