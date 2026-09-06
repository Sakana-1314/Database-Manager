import { Client, type ConnectConfig } from 'ssh2';
import type { Duplex } from 'stream';
import type { ConnectionSpec } from '@shared/spec';
import { AppError, normalizeError } from '../../errors';

/** 建立一条通往目标 (dstHost,dstPort) 的 TCP 流：直连或经 SSH direct-tcpip 通道。 */
export async function openTcp(transport: 'direct' | 'ssh', spec: ConnectionSpec, dst: { host: string; port: number }): Promise<{
  socket?: Duplex;
  close(): Promise<void>;
}> {
  if (transport === 'direct') {
    return { close: async () => undefined };
  }
  const ssh = spec.ssh;
  if (!ssh) throw new AppError('VALIDATION', 'SSH 传输缺少 ssh 配置');

  const cfg: ConnectConfig = {
    host: ssh.host,
    port: ssh.port || 22,
    username: ssh.user,
    readyTimeout: 12_000,
    keepaliveInterval: ssh.keepaliveInterval ?? 15_000,
    keepaliveCountMax: 3,
  };
  if (ssh.auth === 'password') cfg.password = ssh.password;
  else cfg.privateKey = ssh.privateKey;

  const client = new Client();
  const connected = new Promise<void>((resolve, reject) => {
    client.once('ready', () => resolve());
    client.once('error', (err) => reject(normalizeError(err, 'SSH 连接失败')));
    client.connect(cfg);
  });

  try {
    await connected;
  } catch (e) {
    throw new AppError('AUTH_SSH', 'SSH 跳板机连接失败', { detail: e instanceof Error ? e.message : String(e) });
  }

  const stream = await new Promise<Duplex>((resolve, reject) => {
    client.forwardOut('127.0.0.1', 0, dst.host, dst.port, (err, ch) => {
      if (err) reject(new AppError('SSH_FAILED', 'SSH 转发到目标库失败', { detail: String(err.message) }));
      else resolve(ch);
    });
  });

  return {
    socket: stream,
    close: async () => {
      try {
        stream.end();
      } catch {
        /* ignore */
      }
      try {
        client.end();
      } catch {
        /* ignore */
      }
    },
  };
}

/** 用墙钟给操作套上超时；超时即执行 onTimeout 释放资源。 */
export async function withTimeout<T>(ms: number, task: (signal: AbortSignal) => Promise<T>, onTimeout?: () => void): Promise<T> {
  const ac = new AbortController();
  const timer = setTimeout(() => {
    ac.abort();
    onTimeout?.();
  }, ms);
  try {
    return await task(ac.signal);
  } catch (e) {
    if (ac.signal.aborted) {
      throw new AppError('TIMEOUT', '操作超时');
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
