// 根构建：
//   1. 前端 vite build → dist/（静态）
//   2. 后端函数打包（functions-src）→ node-functions/ edge-functions/
//   3. assemble：把 dist 静态资源整理到 deploy/（EdgeOne outputDirectory）
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { cp, rm } from 'node:fs/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const isWin = process.platform === 'win32';

function run(cmd, args, cwd = ROOT) {
  console.log(`> ${cmd} ${args.join(' ')}`);
  execFileSync(cmd, args, { cwd, stdio: 'inherit', shell: isWin });
}

export async function buildFrontend() {
  if (!existsSync(join(ROOT, 'package.json'))) {
    console.warn('[build] 前端源码不存在，跳过');
    return;
  }
  run('npm', ['run', 'build:frontend'], ROOT);
}

export async function buildFunctions() {
  const { buildFunctions } = await import(new URL(`file:///${ROOT.replaceAll('\\', '/')}/functions-src/build.mjs`).href);
  await buildFunctions({ minify: true });
}

/** deploy = 静态资源（index.html + assets）。函数在仓库根的 node-functions/edge-functions，不入 deploy。 */
export async function assemble() {
  const deploy = join(ROOT, 'deploy');
  await rm(deploy, { recursive: true, force: true });
  mkdirSync(deploy, { recursive: true });
  const dist = join(ROOT, 'dist');
  if (!existsSync(dist)) {
    console.warn('[assemble] dist 不存在，先跑 npm run build:frontend');
    return;
  }
  for (const name of readdirSync(dist)) {
    await cp(join(dist, name), join(deploy, name), { recursive: true });
  }
  console.log('[assemble] → deploy/（静态资源）');
}

const onlyAssemble = process.argv.includes('--assemble');
if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replaceAll('\\', '/')}`).href) {
  if (onlyAssemble) {
    assemble().catch((e) => { console.error(e); process.exit(1); });
  } else {
    buildFrontend()
      .then(buildFunctions)
      .then(assemble)
      .catch((e) => { console.error(e); process.exit(1); });
  }
}
