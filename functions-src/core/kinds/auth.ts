import type { CoreHandler } from '../entry';
import { readJsonBody } from '../request';
import { okEnvelope } from '../respond';
import { readLimits } from '../limits';
import { checkLogin } from '../../auth/guard';
import { issueToken } from '../../auth/jwt';

interface LoginArgs {
  username: string;
  password: string;
}

function extractLogin(body: unknown): LoginArgs {
  const b = body as { op?: string; args?: Partial<LoginArgs>; username?: string; password?: string };
  if (b?.op === 'auth.login' && b.args && typeof b.args === 'object') {
    return { username: String(b.args.username ?? ''), password: String(b.args.password ?? '') };
  }
  return { username: String(b?.username ?? ''), password: String(b?.password ?? '') };
}

/** POST /api/auth —— 登录签发 7 天 JWT。 */
export const authCore: CoreHandler = async (ctx) => {
  const max = readLimits(ctx.env).maxPayloadBytes;
  const body = await readJsonBody(ctx.request, max);
  const { username, password } = extractLogin(body);
  await checkLogin(ctx.env, username, password);
  const t = await issueToken(ctx.env);
  return okEnvelope({
    kind: 'raw',
    data: { token: t.token, expiresAt: t.expiresAt, issuedAt: t.issuedAt, maxAgeMs: t.expiresAt - t.issuedAt },
  });
};
