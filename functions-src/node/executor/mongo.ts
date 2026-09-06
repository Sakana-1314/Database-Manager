import { MongoClient, type Document } from 'mongodb';
import { EJSON } from 'bson';
import type { ConnectionSpec } from '@shared/spec';
import { AppError, normalizeError, validationError } from '../../errors';
import type { OpResult } from '@shared/result';

/** 输入（含 $oid/$date 等 Extended JSON 形式）→ BSON 值 */
function fromE(v: unknown): unknown {
  return v === undefined || v === null ? v : EJSON.parse(JSON.stringify(v), { relaxed: false });
}
/** BSON 值 → 可 JSON 化的 Extended JSON */
function toE(v: unknown): unknown {
  return EJSON.serialize(v as Document);
}

export class MongoHandle {
  private client: MongoClient;
  constructor(client: MongoClient) {
    this.client = client;
  }
  db(name?: string) {
    return this.client.db(name);
  }
  get raw() {
    return this.client;
  }
  async close() {
    await this.client.close().catch(() => undefined);
  }
}

export async function connectMongo(spec: ConnectionSpec): Promise<MongoHandle> {
  const ssl = spec.ssl;
  const opts: Record<string, unknown> = {
    serverSelectionTimeoutMS: 10_000,
    connectTimeoutMS: 10_000,
    socketTimeoutMS: 60_000,
  };
  if (ssl && ssl.mode !== 'disable') {
    opts.tls = true;
    if (ssl.mode === 'verify-ca' || ssl.mode === 'verify-full') {
      opts.tlsCAFile = ssl.ca;
      opts.tlsAllowInvalidCertificates = false;
    } else {
      opts.tlsAllowInvalidCertificates = true;
    }
  }
  if (spec.user) opts.auth = { username: spec.user, password: spec.password ?? '' };
  if (spec.authSource) opts.authSource = spec.authSource;
  const dbPath = spec.database ? `/${spec.database}` : '';
  const qs = Object.entries(spec.mongoOptions ?? {})
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  const uri = `mongodb://${spec.host}:${spec.port}${dbPath}${qs ? `?${qs}` : ''}`;
  const client = new MongoClient(uri, opts as never);
  try {
    await client.connect();
    await client.db('admin').command({ ping: 1 }).catch(() => undefined);
  } catch (e) {
    throw normalizeError(e, 'MongoDB 连接失败');
  }
  return new MongoHandle(client);
}

async function collStats(db: Document, collection: string): Promise<unknown> {
  // driver v6 移除了 Collection.stats，用 db.command collStats
  return db.command({ collStats: collection, scale: 1 }).catch(() => null);
}

/** MongoDB 全部 ops（不经过 executeSqlOp）。args 值一律 Extended JSON 层。 */
export async function executeMongoOp(op: string, args: Record<string, unknown>, h: MongoHandle, limits: { maxResultRows: number; opTimeoutMs: number }): Promise<OpResult> {
  const db = str(args.db);
  if (!db) throw validationError('缺少 db');
  const coll = str(args.collection);
  const started = Date.now();
  const maxRows = limits.maxResultRows;
  const dbc = h.db(db);

  switch (op) {
    case 'mongo.listDatabases': {
      const infos = await h.raw.db().admin().listDatabases();
      return { kind: 'raw', data: { databases: infos.databases.map((d) => ({ name: d.name, sizeOnDisk: d.sizeOnDisk })) } };
    }
    case 'mongo.listCollections': {
      const arr = await dbc.listCollections({}, { nameOnly: false }).toArray();
      return { kind: 'raw', data: { collections: arr.map((c) => ({ name: c.name, type: c.type })) } };
    }
    case 'mongo.getCollectionInfo': {
      if (!coll) throw validationError('缺少 collection');
      const stats = await collStats(dbc, coll);
      const info = (await dbc.listCollections({ name: coll }).toArray())[0] ?? null;
      return { kind: 'raw', data: { info, stats } };
    }
    case 'mongo.listIndexes': {
      if (!coll) throw validationError('缺少 collection');
      const indexes = await dbc.collection(coll).indexes();
      return {
        kind: 'raw',
        data: { indexes: indexes.map((i) => ({ name: i.name, key: toE(i.key as Document), unique: !!i.unique, sparse: !!i.sparse, ttl: i.expireAfterSeconds })) },
      };
    }
    case 'mongo.run': {
      if (!coll) throw validationError('缺少 collection');
      const mode = String(args.mode ?? 'find');
      const filter = args.filter === undefined ? {} : fromE(args.filter);
      const col = dbc.collection(coll);
      if (mode === 'count') {
        const n = await col.countDocuments(filter as Document, { maxTimeMS: limits.opTimeoutMs });
        return { kind: 'raw', data: { count: n } };
      }
      if (mode === 'aggregate') {
        const pipeline = (args.pipeline as unknown[]) ?? [];
        const last = pipeline[pipeline.length - 1] as Record<string, unknown> | undefined;
        const needsLimit = !(last && (last.$limit || last.$out || last.$merge || last.$facet));
        const stages: unknown[] = pipeline.map((s) => fromE(s));
        if (needsLimit) stages.push({ $limit: maxRows + 1 });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const arr = await col.aggregate(stages as Document[], { maxTimeMS: limits.opTimeoutMs, allowDiskUse: false } as any).toArray();
        const truncated = needsLimit && arr.length > maxRows;
        return { kind: 'raw', data: { documents: arr.slice(0, maxRows).map((d) => toE(d)), truncated }, meta: { durationMs: Date.now() - started } };
      }
      // find
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let cursor: any = col.find(filter as Document, { maxTimeMS: limits.opTimeoutMs });
      if (args.sort !== undefined) cursor = cursor.sort(fromE(args.sort) as Document);
      if (args.skip !== undefined && Number(args.skip) > 0) cursor = cursor.skip(Number(args.skip));
      cursor = cursor.limit(Number(args.limit) > 0 ? Math.min(Number(args.limit), maxRows + 1) : maxRows + 1);
      if (args.project !== undefined) cursor = cursor.project(fromE(args.project) as Document);
      const arr = await cursor.toArray();
      const truncated = arr.length > maxRows;
      const docs = arr.slice(0, maxRows).map((d: Document) => toE(d));
      return { kind: 'raw', data: { documents: docs, truncated, count: arr.length }, meta: { durationMs: Date.now() - started } };
    }
    case 'mongo.createIndex': {
      if (!coll) throw validationError('缺少 collection');
      const keys = fromE(args.keys) as Document;
      const name = await dbc.collection(coll).createIndex(keys, (args.options as Document | undefined) ?? {});
      return { kind: 'ok', message: `索引已创建：${name}`, durationMs: Date.now() - started };
    }
    case 'mongo.dropIndex': {
      if (!coll || !args.index) throw validationError('缺少 collection / index');
      await dbc.collection(coll).dropIndex(String(args.index));
      return { kind: 'ok', message: `已删除索引 ${args.index}`, durationMs: Date.now() - started };
    }
    case 'mongo.dropCollection': {
      if (!args.confirm) throw new AppError('VALIDATION', '请确认删除集合', { status: 400 });
      if (!coll) throw validationError('缺少 collection');
      await dbc.collection(coll).drop();
      return { kind: 'ok', message: `已删除集合 ${coll}`, durationMs: Date.now() - started };
    }
    case 'mongo.insertMany': {
      if (!coll) throw validationError('缺少 collection');
      const docs = ((args.documents as unknown[]) ?? []).map((d) => fromE(d) as Document);
      const res = await dbc.collection(coll).insertMany(docs);
      return { kind: 'ok', affectedRows: res.insertedCount, message: `插入 ${res.insertedCount} 条文档`, durationMs: Date.now() - started };
    }
    case 'mongo.updateOne': {
      if (!coll) throw validationError('缺少 collection');
      const filter = fromE(args.filter) as Document;
      const update = fromE(args.update) as Document;
      const res = await dbc.collection(coll).updateOne(filter, update, { upsert: !!args.upsert });
      return { kind: 'ok', affectedRows: res.modifiedCount + (res.upsertedCount ?? 0), message: `已更新 ${res.matchedCount} 条（修改 ${res.modifiedCount}）`, durationMs: Date.now() - started };
    }
    case 'mongo.deleteOne': {
      if (!coll) throw validationError('缺少 collection');
      const filter = fromE(args.filter) as Document;
      const res = await dbc.collection(coll).deleteOne(filter);
      return { kind: 'ok', affectedRows: res.deletedCount, message: `已删除 ${res.deletedCount} 条`, durationMs: Date.now() - started };
    }
    case 'mongo.collectionStats': {
      if (!coll) throw validationError('缺少 collection');
      const stats = await collStats(dbc, coll);
      return { kind: 'raw', data: { stats }, meta: { durationMs: Date.now() - started } };
    }
    default:
      throw new AppError('OP_UNSUPPORTED', `不支持的 Mongo op：${op}`);
  }
}

function str(v: unknown): string | undefined {
  return v === undefined || v === null ? undefined : String(v);
}
