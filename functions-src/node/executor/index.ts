import { OP_ENGINES } from '@shared/ops';
import type { ConnectionSpec, Transport } from '@shared/spec';
import type { Limits } from '@shared/capability';
import type { RequestEnvelope, ResponseEnvelope } from '@shared/protocol';
import type { OpResult } from '@shared/result';
import { AppError, validationError } from '../../errors';
import { requireAuth } from '../../auth/guard';
import { openTcp, withTimeout } from './transport';
import { connectMysql, type ConnectOpts as MyOpts } from './drivers/mysql';
import { connectPostgres, type ConnectOpts as PgOpts } from './drivers/postgres';
import { connectMongo, MongoHandle, executeMongoOp } from './mongo';
import { executeSqlOp } from './runSql';
import type { SqlHandle } from './drivers/types';
import type { EnvMap } from '../../core/env';

interface Closeable {
  close(): Promise<void>;
}

/** 建 mysql/pg 连接（可选经 SSH 通道），连同通路一起管理释放。 */
async function openSql(spec: ConnectionSpec, transport: Transport, limits: Limits): Promise<SqlHandle> {
  const engine = spec.engine as 'mysql' | 'postgres';
  let path: { socket?: import('stream').Duplex; close(): Promise<void> } | null = null;
  if (transport === 'ssh') {
    path = await openTcp('ssh', spec, { host: spec.host, port: spec.port });
  }
  const base = {
    host: spec.host,
    port: spec.port,
    user: spec.user,
    password: spec.password,
    ssl: spec.ssl,
    sessionTimeZone: spec.sessionTimeZone,
    limits,
    socket: path?.socket,
  };
  try {
    if (engine === 'mysql') {
      const opts: MyOpts = { ...base, database: spec.database };
      const h = await connectMysql(opts);
      return wrapClose(h, path);
    }
    const opts: PgOpts = { ...base, database: spec.database, schema: spec.schema };
    const h = await connectPostgres(opts);
    return wrapClose(h, path);
  } catch (e) {
    await path?.close().catch(() => undefined);
    throw e;
  }
}

function wrapClose(h: SqlHandle, path: { socket?: import('stream').Duplex; close(): Promise<void> } | null): SqlHandle {
  const orig = h.close.bind(h);
  h.close = async () => {
    await orig();
    await path?.close().catch(() => undefined);
  };
  return h;
}

/** /api/db 入口核心：验 JWT → 门禁 → 建数据通路 → 分发 op → 归一时长 */
export async function handleDbRequest(envelope: RequestEnvelope, env: EnvMap, limits: Limits): Promise<ResponseEnvelope> {
  const transport: Transport = envelope.transport;
  if (transport !== 'direct' && transport !== 'ssh') {
    throw new AppError('TRANSPORT_UNSUPPORTED', '该执行端点只处理 direct/ssh 传输；http-tunnel 请打到 /api/tunnel');
  }
  const rawSpec = envelope.connection;
  if (!rawSpec || typeof rawSpec.engine !== 'string') throw validationError('缺少 connection');
  const spec = normalizeSpec(rawSpec);
  const ops = OP_ENGINES as Record<string, string[]>;
  if (!(envelope.op in ops)) throw new AppError('OP_UNSUPPORTED', `未知 op：${envelope.op}`);
  if (!(ops[envelope.op] ?? []).includes(spec.engine)) throw new AppError('OP_UNSUPPORTED', `${envelope.op} 不支持 ${spec.engine} 引擎`);

  const ms = transport === 'ssh' ? limits.slowTimeoutMs : limits.opTimeoutMs;

  if (envelope.op === 'meta.testConnection') {
    const result = await withTimeout(Math.min(ms, 15_000), async () => {
      if (spec.engine === 'mongodb') {
        const m = await connectMongo(spec);
        try {
          return { reachable: true, engine: spec.engine, version: 'MongoDB', transport };
        } finally {
          await m.close().catch(() => undefined);
        }
      }
      const h = await openSql(spec, transport, limits);
      try {
        const version = await h.pingVersion();
        return { reachable: true, engine: spec.engine, version, transport };
      } finally {
        await h.close().catch(() => undefined);
      }
    });
    return { ok: true, result: { kind: 'raw', data: result } };
  }

  const result = await withTimeout(ms, () => runOp(envelope.op, envelope.args, spec, transport, limits));
  return { ok: true, result };
}

async function runOp(op: string, args: Record<string, unknown>, spec: ConnectionSpec, transport: Transport, limits: Limits): Promise<OpResult> {
  if (spec.engine === 'mongodb') {
    if (transport === 'ssh') {
      throw new AppError('TRANSPORT_UNSUPPORTED', 'MongoDB 经 SSH 跳板暂不支持；请改用 python/php 隧道或 Mongo 直连');
    }
    const mongo: MongoHandle = await connectMongo(spec);
    try {
      return await executeMongoOp(op, args, mongo, { maxResultRows: limits.maxResultRows, opTimeoutMs: limits.opTimeoutMs });
    } finally {
      await mongo.close().catch(() => undefined);
    }
  }
  const h = await openSql(spec, transport, limits);
  try {
    return await executeSqlOp(op, args, h, { engine: spec.engine, database: spec.database, schema: spec.schema }, limits);
  } finally {
    await h.close().catch(() => undefined);
  }
}

function normalizeSpec(spec: ConnectionSpec): ConnectionSpec {
  return {
    ...spec,
    port: Number(spec.port) || (spec.engine === 'postgres' ? 5432 : spec.engine === 'mongodb' ? 27017 : 3306),
    sessionTimeZone: spec.sessionTimeZone ?? 'Z',
  };
}

/** 供 dev 中继等复用：仅验签 */
export async function requireBearer(headers: { get?(k: string): string | null }, env: EnvMap): Promise<void> {
  await requireAuth(headers, env);
}
