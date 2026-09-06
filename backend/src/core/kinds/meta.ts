import { staticCapabilities } from '@shared/capability';
import type { CoreHandler } from '../entry';
import { readJsonBody } from '../request';
import { okEnvelope } from '../respond';
import { readLimits } from '../limits';
import { requireAuth } from '../../auth/guard';

const SERVER_VERSION = '0.1.0';

/** POST /api/meta —— capabilities / ping（需登录）。body 可为 {op} 或完整封包。 */
export const metaCore: CoreHandler = async (ctx) => {
  await requireAuth(ctx.headers, ctx.env);
  const body = (await readJsonBody(ctx.request, readLimits(ctx.env).maxPayloadBytes)) as { op?: string } | null | undefined;
  const op = body && typeof body === 'object' ? body.op || 'meta.capabilities' : 'meta.capabilities';
  const limits = readLimits(ctx.env);

  if (op === 'meta.ping') {
    return okEnvelope({ kind: 'raw', data: { now: Date.now(), server: 'edgeone-db-admin', version: SERVER_VERSION, limits } });
  }
  return okEnvelope({ kind: 'raw', data: staticCapabilities(limits) });
};
