import type { Engine, Transport } from './spec';
import { OP_ENGINES } from './ops';
import type { OpId } from './ops';

/** 上限（默认值；edge/node 各自可被环境变量覆盖后下发） */
export interface Limits {
  maxResultRows: number;
  maxResultBytes: number;
  maxPayloadBytes: number;
  /** 常规 op（direct） */
  opTimeoutMs: number;
  /** ssh / 隧道慢链路 */
  slowTimeoutMs: number;
  defaultPageSize: number;
}

export const DEFAULT_LIMITS: Limits = {
  maxResultRows: 500,
  maxResultBytes: 8 * 1024 * 1024,
  maxPayloadBytes: 10 * 1024 * 1024,
  opTimeoutMs: 30_000,
  slowTimeoutMs: 60_000,
  defaultPageSize: 200,
};

export interface DialectInfo {
  identOpen: string;
  identClose: string;
  stringQuote: string;
  placeholder: '?' | '$n' | 'none';
  supportsMultiDatabase: boolean;
}

export const DIALECTS: Record<Engine, DialectInfo> = {
  mysql: { identOpen: '`', identClose: '`', stringQuote: "'", placeholder: '?', supportsMultiDatabase: true },
  postgres: { identOpen: '"', identClose: '"', stringQuote: "'", placeholder: '$n', supportsMultiDatabase: true },
  mongodb: { identOpen: '', identClose: '', stringQuote: '"', placeholder: 'none', supportsMultiDatabase: true },
};

/** 每个传输支持哪些引擎（node direct/ssh；edge 隧道中继不限——能力取决于隧道实现） */
export const TRANSPORT_ENGINES: Record<Transport, Engine[]> = {
  direct: ['mysql', 'postgres', 'mongodb'],
  ssh: ['mysql', 'postgres', 'mongodb'],
  'http-tunnel': ['mysql', 'postgres', 'mongodb'],
};

export interface TunnelAdvertisement {
  kind: 'php' | 'python' | 'node';
  engines: Engine[];
  ops: OpId[];
  note?: string;
}

/** 能力表：edge /api/meta 直答静态面；经 /api/tunnel 询问某个隧道时返回动态面。 */
export interface Capabilities {
  server: { name: 'edgeone-db-admin'; protocolVersion: number; version: string };
  transports: Transport[];
  engines: Engine[];
  limits: Limits;
  /** 传输 → 执行端点（前端选路用） */
  transportEndpoint: Record<Transport, string>;
  /** op → 支持的引擎 */
  ops: Record<OpId, Engine[]>;
  dialect: Record<Engine, DialectInfo>;
  tunnel?: TunnelAdvertisement;
}

export function staticCapabilities(limits: Limits = DEFAULT_LIMITS): Capabilities {
  return {
    server: { name: 'edgeone-db-admin', protocolVersion: 1, version: '0.1.0' },
    transports: ['direct', 'ssh', 'http-tunnel'],
    engines: ['mysql', 'postgres', 'mongodb'],
    limits,
    transportEndpoint: { direct: '/api/db', ssh: '/api/db', 'http-tunnel': '/api/tunnel' },
    ops: { ...OP_ENGINES },
    dialect: DIALECTS,
  };
}
