import { makeCtx, type Ctx } from './platform';
import { errEnvelope } from './respond';
import { AppError } from '../errors';

/** 一个端点 = (ctx) => Response */
export type CoreHandler = (ctx: Ctx) => Promise<Response>;

/** 平台入口工厂：把 (Ctx)=>Response 包装成页面函数的 onRequest。 */
export function makeEntry(core: CoreHandler, allowedMethods: string[] = ['POST']): (context: unknown) => Promise<Response> {
  return async function onRequest(context: unknown): Promise<Response> {
    const ctx = makeCtx(context);
    try {
      if (allowedMethods.length && !allowedMethods.includes(ctx.method)) {
        throw new AppError('BAD_REQUEST', '不支持的方法', { status: 405 });
      }
      const res = await core(ctx);
      res.headers.set('cache-control', 'no-store, max-age=0');
      return res;
    } catch (e) {
      return errEnvelope(e as Error);
    }
  };
}
