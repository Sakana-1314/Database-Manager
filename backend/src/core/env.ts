/** 运行环境：edge(V8) 通过 context.env，node 通过 process.env；同一套 key。 */

export type EnvMap = Record<string, string | undefined>;

export function resolveEnv(platformEnv: unknown): EnvMap {
  if (platformEnv && typeof platformEnv === 'object') {
    // context.env 可能是普通对象或 Proxy
    return platformEnv as EnvMap;
  }
  if (typeof process !== 'undefined' && process.env) return process.env as EnvMap;
  return {};
}

export function getEnv(env: EnvMap, name: string): string | undefined {
  const v = env[name];
  return v === undefined || v === null ? undefined : String(v);
}

export function requireEnv(env: EnvMap, name: string): string {
  const v = getEnv(env, name);
  if (!v) throw new Error(`missing required env: ${name}`);
  return v;
}

/** 在实例（模块）内缓存并暴露一次读取的配置 */
export function pickEnv(env: EnvMap, names: string[]): EnvMap {
  const out: EnvMap = {};
  for (const n of names) out[n] = env[n];
  return out;
}
