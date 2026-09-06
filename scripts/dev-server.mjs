// 本地开发执行器：模拟 EdgeOne 各端点的调用（无 edgeone CLI 依赖）。
// 用法：node backend/dev-server.mjs  （可选 --env-file 见 scripts/dev.mjs）
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { Buffer } from 'node:buffer';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 8788);

const ROUTES = {
  '/api/auth': join(ROOT, 'node-functions/api/auth.js'),
  '/api/meta': join(ROOT, 'node-functions/api/meta.js'),
  '/api/tunnel': join(ROOT, 'node-functions/api/tunnel.js'),
  '/api/db': join(ROOT, 'node-functions/api/db.js'),
};

const moduleCache = new Map();
async function loadHandler(file) {
  let code;
  try {
    code = readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  const hit = moduleCache.get(file);
  if (hit && hit.code === code) return hit.fn;
  const url = 'data:text/javascript;base64,' + Buffer.from(code, 'utf8').toString('base64');
  const mod = await import(url);
  const fn = mod.default ?? mod.onRequest ?? mod;
  moduleCache.set(file, { code, fn });
  return typeof fn === 'function' ? fn : null;
}

function readBody(req) {
  return new Promise((resolveBody) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
  });
}

const server = createServer(async (req, res) => {
  const method = req.method ?? 'GET';
  const u = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const file = ROUTES[u.pathname];
  try {
    if (!file) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: { code: 'NOT_FOUND', message: 'dev-server: 无此路由，前端请走 Vite dev' } }));
      return;
    }
    const rawBody = await readBody(req);
    const fn = await loadHandler(file);
    if (!fn) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: { code: 'INTERNAL', message: '函数产物缺失，请先 npm run build -w backend' } }));
      return;
    }
    const context = {
      method,
      url: u.href,
      env: process.env,
      request: {
        method,
        url: u.href,
        headers: { get: (name) => req.headers[name.toLowerCase()] ?? null },
        async json() {
          return rawBody ? JSON.parse(rawBody) : {};
        },
        async arrayBuffer() {
          return Buffer.from(rawBody).buffer;
        },
      },
    };
    const response = await fn(context);
    const text = await response.text();
    const headers = Object.fromEntries(response.headers.entries());
    res.writeHead(response.status, { 'content-type': headers['content-type'] ?? 'application/json; charset=utf-8' });
    res.end(text);
  } catch (err) {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: { code: 'INTERNAL', message: 'dev-server error', detail: String(err?.stack ?? err) } }));
  }
});

server.listen(PORT, () => {
  console.log(`[dev-server] listening http://localhost:${PORT}`);
  console.log('  routes:', Object.keys(ROUTES).join(' '));
});
