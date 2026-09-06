// 本地开发：打包函数 → dev-server(:8788) 模拟各端点 + 前端 Vite dev(:5173)
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
  console.log('[dev] 打包函数产物…');
  const { buildFunctions } = await import(new URL(`file:///${ROOT.replaceAll('\\', '/')}/functions-src/build.mjs`).href);
  await buildFunctions({ minify: false });

  const envFlag = existsSync(join(ROOT, '.env')) ? ['--env-file=.env'] : [];
  start('node', [...envFlag, 'scripts/dev-server.mjs'], 'backend dev-server (:8788)');
  start('npm', ['run', 'dev'], 'frontend vite dev');
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    for (const c of children) {
      try { c.kill(sig); } catch { /* ignore */ }
    }
    process.exit(0);
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
