import type { Limits } from '@shared/capability';
import { DEFAULT_LIMITS } from '@shared/capability';
import type { EnvMap } from './env';
import { getEnv } from './env';

function int(env: EnvMap, name: string, fallback: number): number {
  const v = getEnv(env, name);
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function readLimits(env: EnvMap): Limits {
  return {
    maxResultRows: int(env, 'MAX_RESULT_ROWS', DEFAULT_LIMITS.maxResultRows),
    maxResultBytes: int(env, 'MAX_RESULT_BYTES', DEFAULT_LIMITS.maxResultBytes),
    maxPayloadBytes: int(env, 'MAX_PAYLOAD_BYTES', DEFAULT_LIMITS.maxPayloadBytes),
    opTimeoutMs: int(env, 'OP_TIMEOUT_MS', DEFAULT_LIMITS.opTimeoutMs),
    slowTimeoutMs: int(env, 'SLOW_TIMEOUT_MS', DEFAULT_LIMITS.slowTimeoutMs),
    defaultPageSize: int(env, 'DEFAULT_PAGE_SIZE', DEFAULT_LIMITS.defaultPageSize),
  };
}
