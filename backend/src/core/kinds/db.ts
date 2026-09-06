import type { RequestEnvelope } from '@shared/protocol';
import type { CoreHandler } from '../entry';
import { readJsonBody } from '../request';
import { jsonResponse } from '../respond';
import { readLimits } from '../limits';
import { requireAuth } from '../../auth/guard';
import { AppError, statusFor } from '../../errors';
import { handleDbRequest } from '../../node/executor/index';

function asEnvelope(v: unknown): RequestEnvelope | null {
  if (!v || typeof v !== 'object') return null;
  const e = v as Partial<RequestEnvelope>;
  if (e.protocolVersion !== 1 || typeof e.op !== 'string' || typeof e.args !== 'object' || !e.connection) return null;
  return e as RequestEnvelope;
}

/** POST /api/db —— Node 直连/SSH 执行端点（middleware 已鉴权，这里纵深再验一次）。 */
export const dbCore: CoreHandler = async (ctx) => {
  await requireAuth(ctx.headers, ctx.env); // 纵深防御
  const limits = readLimits(ctx.env);
  const raw = await readJsonBody(ctx.request, limits.maxPayloadBytes);
  const envelope = asEnvelope(raw);
  if (!envelope) throw AppError.badRequest('无效的执行封包');

  const res = await handleDbRequest(envelope, ctx.env, limits);
  if (res.ok) return jsonResponse(200, res);
  return jsonResponse(statusFor(res.error.code), res);
};
