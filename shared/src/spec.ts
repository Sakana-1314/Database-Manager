/**
 * ConnectionSpec — 浏览器 IndexedDB 中保存、每次请求随 body 携带（服务端不持久化）。
 * transport 决定请求被路由到哪个执行端点，也决定 executor 如何建连。
 */

export type Engine = 'mysql' | 'postgres' | 'mongodb';
export type Transport = 'direct' | 'ssh' | 'http-tunnel';

export interface SslConfig {
  mode: 'disable' | 'prefer' | 'require' | 'verify-ca' | 'verify-full';
  /** PEM CA */
  ca?: string;
  cert?: string;
  key?: string;
}

export interface SshConfig {
  host: string;
  port: number;
  user: string;
  auth: 'password' | 'privateKey';
  password?: string;
  /** PEM 私钥（含 BEGIN … END） */
  privateKey?: string;
  passphrase?: string;
  /** 可选 keepalive 间隔 ms */
  keepaliveInterval?: number;
}

export interface TunnelConfig {
  /** 隧道根地址，例如 https://host/tunnel.php 或 https://host:9000 —— 最终 POST 到 baseUrl + '/__exec' */
  baseUrl: string;
  /** 隧道上的命名 profile（DSN 别名），由隧道管理员在服务端定义 */
  profile: string;
  /** 可选共享密钥；优先于 edge env 的 TUNNEL_SHARED_SECRET */
  sharedSecret?: string;
  headerTokenName?: string;
}

export interface ConnectionSpec {
  /** 展示名（浏览器本地） */
  name?: string;
  engine: Engine;
  /** 目标库地址（mysql/pg/mongo）；mongo 走 mongodb:// host:port */
  host: string;
  port: number;
  /** 默认库 */
  database?: string;
  /** PG schema，默认 public */
  schema?: string;
  /** mongo: authSource（默认 admin） */
  authSource?: string;
  user: string;
  password?: string;
  ssl?: SslConfig;
  /** transport='ssh' 时必填 */
  ssh?: SshConfig;
  /** transport='http-tunnel' 时必填 */
  tunnel?: TunnelConfig;
  /** 会话时区；默认 'Z'（UTC），保持跨引擎/跨机器可复现 */
  sessionTimeZone?: string;
  /** mongo 专用连接串里不需要的额外字段 */
  mongoOptions?: Record<string, string>;
}

/** SSH 隧道目标：默认复用 spec.host/spec.port，可用 dstHost/dstPort 覆盖（跳板后再跳） */
export interface SshTarget {
  dstHost: string;
  dstPort: number;
}
