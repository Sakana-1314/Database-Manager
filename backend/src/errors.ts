import type { ErrorCode } from '@shared/protocol';

/** 业务异常：code 稳定、前端映射中文。 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly detail?: string;

  constructor(code: ErrorCode, message: string, opts?: { status?: number; detail?: string; cause?: unknown }) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = opts?.status ?? statusFor(code);
    this.detail = opts?.detail;
    if (opts?.cause !== undefined) (this as { cause?: unknown }).cause = opts.cause;
  }

  static badRequest(msg: string, detail?: string) {
    return new AppError('BAD_REQUEST', msg, { detail });
  }
  static unauthorized(msg = '未登录或登录已过期', detail?: string) {
    return new AppError('UNAUTHORIZED', msg, { detail });
  }
}

export function statusFor(code: ErrorCode): number {
  switch (code) {
    case 'BAD_REQUEST':
    case 'VALIDATION':
    case 'SYNTAX':
    case 'DECODE':
    case 'PAYLOAD_TOO_LARGE':
      return 400;
    case 'UNAUTHORIZED':
    case 'TUNNEL_AUTH':
    case 'AUTH_DB':
    case 'AUTH_SSH':
      return 401;
    case 'FORBIDDEN':
    case 'PERMISSION':
      return 403;
    case 'NOT_FOUND':
    case 'OBJECT_NOT_FOUND':
      return 404;
    case 'TIMEOUT':
      return 408;
    default:
      return 500;
  }
}

/** 把任意 driver/网络异常归一为稳定错误码（node 侧执行器里也会用）。 */
export function normalizeError(e: unknown, prefix?: string): AppError {
  if (e instanceof AppError) return e;
  const any = e as { code?: string; errno?: number; name?: string; message?: string };
  const msg = any?.message ?? String(e);

  if (/ECONNREFUSED|connect ECONNREFUSED|EADDRNOTAVAIL/i.test(msg)) return new AppError('CONN_REFUSED', `${prefix ?? ''}无法连接到数据库服务器`, { detail: msg });
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(msg)) return new AppError('HOST_UNREACHABLE', `${prefix ?? ''}无法解析/到达主机`, { detail: msg });
  if (/ETIMEDOUT|timed ?out|deadline exceeded/i.test(msg)) return new AppError('TIMEOUT', `${prefix ?? ''}操作超时`, { detail: msg });
  if (/ER_ACCESS_DENIED|Access denied|28P01|authentication failed|password authentication failed/i.test(msg))
    return new AppError('AUTH_DB', '数据库账号或密码不正确', { detail: msg });
  if (/ER_PARSE_ERROR|syntax error|42601|SQL syntax/i.test(msg)) return new AppError('SYNTAX', 'SQL 语法错误', { detail: msg });
  if (/ER_NO_SUCH_TABLE|42P01|does not exist|no such table/i.test(msg)) return new AppError('OBJECT_NOT_FOUND', '对象不存在', { detail: msg });
  if (/deadlock|ER_LOCK_DEADLOCK|40P01/i.test(msg)) return new AppError('CONCURRENT_MODIFY', '并发冲突（死锁/行锁），请重试', { detail: msg });
  if (/ER_DUP_ENTRY|23505|duplicate/i.test(msg)) return new AppError('VALIDATION', '违反唯一约束/重复数据', { detail: msg });
  return new AppError('INTERNAL', `${prefix ?? '操作'}失败`, { detail: msg });
}

/** 校验失败包装 */
export function validationError(msg: string, detail?: string): AppError {
  return new AppError('VALIDATION', msg, { detail });
}
