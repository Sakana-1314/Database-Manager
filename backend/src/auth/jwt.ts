import { SignJWT, jwtVerify } from 'jose';
import { AppError } from '../errors';
import type { EnvMap } from '../core/env';
import { getEnv } from '../core/env';

export const TOKEN_TTL_MS = 7 * 24 * 3600 * 1000; // 7 天

/** 派生 HMAC 密钥：SHA-256(secret)。JWT_SECRET 优先，否则 ADMIN_PASSWORD。跨运行时/请求确定性。 */
export async function deriveJwtKey(env: EnvMap): Promise<Uint8Array> {
  const secret = getEnv(env, 'JWT_SECRET') ?? getEnv(env, 'ADMIN_PASSWORD');
  if (!secret) throw new AppError('FORBIDDEN', '服务端未配置 ADMIN_PASSWORD / JWT_SECRET');
  const data = new TextEncoder().encode(secret);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data));
}

export interface TokenInfo {
  token: string;
  expiresAt: number; // epoch ms
  issuedAt: number;
}

/** 签发 7 天 JWT（HS256, sub=admin） */
export async function issueToken(env: EnvMap): Promise<TokenInfo> {
  const key = await deriveJwtKey(env);
  const now = Date.now();
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('admin')
    .setIssuedAt(Math.floor(now / 1000))
    .setExpirationTime(Math.floor((now + TOKEN_TTL_MS) / 1000))
    .sign(key);
  return { token, expiresAt: now + TOKEN_TTL_MS, issuedAt: now };
}

export interface VerifiedToken {
  sub: string;
  exp?: number;
}

export async function verifyToken(token: string, env: EnvMap): Promise<VerifiedToken> {
  try {
    const key = await deriveJwtKey(env);
    const { payload } = await jwtVerify(token, key, { subject: 'admin' });
    return { sub: String(payload.sub ?? ''), exp: payload.exp };
  } catch (e) {
    const msg = e instanceof Error && /expired/i.test(e.message) ? '登录已过期，请重新登录' : '登录凭证无效';
    throw new AppError('UNAUTHORIZED', msg, { detail: e instanceof Error ? e.message : undefined });
  }
}

/** 从请求头提取 Bearer token */
export function bearerFromHeader(headers: { get?(k: string): string | null } | undefined): string | undefined {
  const auth = headers?.get?.('authorization');
  if (!auth) return undefined;
  const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
  return m ? m[1] : undefined;
}

/** 常量时间字符串比较：先各自 SHA-256 再逐字节异或，长度恒定。 */
export async function constantTimeEqualStr(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([sha256(enc.encode(a)), sha256(enc.encode(b))]);
  let diff = 0;
  for (let i = 0; i < ha.length; i++) diff |= ha[i] ^ hb[i];
  return diff === 0;
}

export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data));
}
