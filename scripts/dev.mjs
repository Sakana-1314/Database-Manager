// 本地开发：backend 产物 + 后端 dev-server + 前端 Vite dev（代理 /api → dev-server）
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const isWin = process.platform === 'win32';
const children = [];

function start(cmd, args, label) {
  console.log(`\n[dev] ${label}: ${cmd} ${args.join(' ')}\n`);
  const child = spawn(cmd, args, { cwd: ROOT, shell: isWin, stdio: 'inherit', env: process.env });
  children.push(child);
  return child;
}

async function main() {
  console.log('[dev] 构建后端函数产物…');
  const { buildBackend } = await import(new URL(`file:///${ROOT.replaceAll('\\', '/')}/scripts/build.mjs`).href);
  await buildBackend(false);

  const envFlag = existsSync(join(ROOT, '.env')) ? ['--env-file=.env'] : [];
  start('node', [...envFlag, 'backend/dev-server.mjs'], 'backend dev-server (:8788)');
  start('npm', ['run', 'dev', '-w', 'frontend'], 'frontend vite dev');
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    for (const c of children) {
      try {
        c.kill(sig);
      } catch {
        /* ignore */
      }
    }
    process.exit(0);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
