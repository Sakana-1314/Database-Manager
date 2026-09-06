import type { EnvMap } from '../core/env';
import { AppError } from '../errors';
import { bearerFromHeader, constantTimeEqualStr, verifyToken } from './jwt';

/** 登录校验：账号固定 admin，密码与 ADMIN_PASSWORD 常量时间比较。 */
export async function checkLogin(env: EnvMap, username: string, password: string): Promise<void> {
  if (username !== 'admin') throw new AppError('UNAUTHORIZED', '账号或密码不正确');
  const expected = env.ADMIN_PASSWORD;
  if (!expected) throw new AppError('FORBIDDEN', '服务端未配置 ADMIN_PASSWORD');
  const ok = await constantTimeEqualStr(password ?? '', expected);
  if (!ok) throw new AppError('UNAUTHORIZED', '账号或密码不正确');
}

/** 请求鉴权：读取 Authorization Bearer 并验签。校验失败抛 UNAUTHORIZED。 */
export async function requireAuth(
  headers: { get?(k: string): string | null } | undefined,
  env: EnvMap,
): Promise<{ sub: string }> {
  const token = bearerFromHeader(headers);
  if (!token) throw new AppError('UNAUTHORIZED', '缺少登录凭证');
  const payload = await verifyToken(token, env);
  return { sub: payload.sub };
}
