// 根构建：
//   1. 前端 vite build → dist/（EdgeOne outputDirectory）
//   2. 后端函数打包（functions-src）→ node-functions/api/*.js
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

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

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replaceAll('\\', '/')}`).href) {
  buildFrontend()
    .then(buildFunctions)
    .catch((e) => { console.error(e); process.exit(1); });
}
