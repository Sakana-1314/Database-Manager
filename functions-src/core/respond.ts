import type { OpResult } from '@shared/result';
import type { ResponseEnvelope } from '@shared/protocol';
import { AppError } from '../errors';
import { statusFor } from '../errors';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

export function textResponse(status: number, body: string, contentType = 'text/plain; charset=utf-8'): Response {
  return new Response(body, { status, headers: { 'content-type': contentType } });
}

export function jsonResponse(status: number, body: unknown, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extraHeaders } });
}

/** 统一返回封包 ok */
export function okEnvelope(result: OpResult): Response {
  return jsonResponse(200, { ok: true, result } satisfies ResponseEnvelope);
}

/** 统一返回封包 error */
export function errEnvelope(error: AppError | Error, fallbackCode: 'INTERNAL' | 'BAD_REQUEST' = 'INTERNAL'): Response {
  const appErr = error instanceof AppError ? error : new AppError(fallbackCode, error?.message ?? '未知错误');
  const status = appErr.status || statusFor(appErr.code);
  const body = { ok: false, error: { code: appErr.code, message: appErr.message, detail: appErr.detail } };
  return jsonResponse(status, body);
}

export function noCache(): Record<string, string> {
  return { 'cache-control': 'no-store, max-age=0' };
}
