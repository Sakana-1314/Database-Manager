import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { ConnectionSpec } from '@shared/spec';

export interface ConnectionRecord extends ConnectionSpec {
  id: string;
  updatedAt: number;
}
export interface HistoryItem {
  id?: string;
  engine: string;
  connId?: string;
  database?: string;
  sql: string;
  ok: boolean;
  durationMs?: number;
  at: number;
}
export interface SchemaCacheEntry {
  key: string;
  columns: unknown;
  at: number;
}

interface EoDB extends DBSchema {
  connections: { key: string; value: ConnectionRecord };
  history: { key: string; value: HistoryItem; indexes: { 'by-at': number } };
  snippets: { key: string; value: { id: string; name: string; sql: string; engine: string; at: number } };
  schemaCache: { key: string; value: SchemaCacheEntry };
  kv: { key: string; value: unknown };
}

let _db: Promise<IDBPDatabase<EoDB>> | null = null;
function db(): Promise<IDBPDatabase<EoDB>> {
  if (!_db) {
    _db = openDB<EoDB>('edgeone-db-admin', 1, {
      upgrade(d) {
        d.createObjectStore('connections', { keyPath: 'id' });
        const h = d.createObjectStore('history', { keyPath: 'id' });
        h.createIndex('by-at', 'at');
        d.createObjectStore('snippets', { keyPath: 'id' });
        d.createObjectStore('schemaCache', { keyPath: 'key' });
        d.createObjectStore('kv');
      },
    });
  }
  return _db;
}

export async function idbListConnections(): Promise<ConnectionRecord[]> {
  const d = await db();
  const all = await d.getAll('connections');
  return all.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '') || b.updatedAt - a.updatedAt);
}
export async function idbSaveConnection(c: ConnectionRecord): Promise<void> {
  const d = await db();
  await d.put('connections', { ...c, updatedAt: Date.now() });
}
export async function idbDeleteConnection(id: string): Promise<void> {
  const d = await db();
  await d.delete('connections', id);
}
export async function idbGetConnection(id: string): Promise<ConnectionRecord | undefined> {
  const d = await db();
  return d.get('connections', id);
}

export async function idbPushHistory(item: HistoryItem): Promise<void> {
  const d = await db();
  const id = item.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await d.put('history', { ...item, id });
  // 只保留最近 200 条
  const keys = await d.getAllKeysFromIndex('history', 'by-at');
  if (keys.length > 200) {
    const drop = keys.slice(0, keys.length - 200);
    const tx = d.transaction('history', 'readwrite');
    await Promise.all(drop.map((k) => tx.store.delete(k)));
    await tx.done;
  }
}
export async function idbHistory(): Promise<HistoryItem[]> {
  const d = await db();
  return d.getAllFromIndex('history', 'by-at');
}

export async function idbCacheSet(key: string, value: unknown): Promise<void> {
  const d = await db();
  await d.put('schemaCache', { key, columns: value, at: Date.now() });
}
export async function idbCacheGet<T>(key: string, maxAgeMs = 30_000): Promise<T | undefined> {
  const d = await db();
  const hit = await d.get('schemaCache', key);
  if (hit && Date.now() - (hit.at ?? 0) < maxAgeMs) return hit.columns as T;
  return undefined;
}
