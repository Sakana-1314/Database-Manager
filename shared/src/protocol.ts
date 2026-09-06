import type { ConnectionSpec, Transport } from './spec';
import type { OpId } from './ops';
import type { OpResult } from './result';

export const PROTOCOL_VERSION = 1 as const;

/** 请求封包。传输层决定打到哪个端点：direct/ssh → /api/db(node)，http-tunnel → /api/tunnel(edge) */
export interface RequestEnvelope {
  protocolVersion: typeof PROTOCOL_VERSION;
  transport: Transport;
  connection: ConnectionSpec;
  op: OpId;
  args: Record<string, unknown>;
}

/** 响应封包 —— 所有执行端点与隧道共用 */
export type ResponseEnvelope =
  | { ok: true; result: OpResult; meta?: { durationMs?: number } }
  | { ok: false; error: ApiErrorBody };

export interface ApiErrorBody {
  code: ErrorCode;
  message: string;
  /** 额外细节（DB 原生报错等），展示为可折叠）
   */
  detail?: string;
}

export type ErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'INTERNAL'
  | 'PAYLOAD_TOO_LARGE'
  | 'OP_UNSUPPORTED'
  | 'TRANSPORT_UNSUPPORTED'
  | 'ENGINE_UNSUPPORTED'
  | 'CONN_REFUSED'
  | 'HOST_UNREACHABLE'
  | 'AUTH_DB'
  | 'AUTH_SSH'
  | 'SSH_FAILED'
  | 'TUNNEL_UNREACHABLE'
  | 'TUNNEL_AUTH'
  | 'TIMEOUT'
  | 'SYNTAX'
  | 'PERMISSION'
  | 'OBJECT_NOT_FOUND'
  | 'CONCURRENT_MODIFY'
  | 'VALIDATION'
  | 'NOT_IMPLEMENTED'
  | 'MONGO'
  | 'DECODE'
  | 'UNSUPPORTED_TYPE';

/** HTTP 状态码与错误码映射（执行端点用） */
export const HTTP_STATUS: Partial<Record<number, ErrorCode>> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  413: 'PAYLOAD_TOO_LARGE',
  408: 'TIMEOUT',
  500: 'INTERNAL',
};
