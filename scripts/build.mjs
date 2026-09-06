// 根构建/装配：frontend build → backend 函数产物 → 组 deploy/（EdgeOne 输出目录）
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { cp, rm } from 'node:fs/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const isWin = process.platform === 'win32';

function run(cmd, args, cwd = ROOT) {
  console.log(`> ${cmd} ${args.join(' ')}`);
  execFileSync(cmd, args, { cwd, stdio: 'inherit', shell: isWin });
}

async function buildBackend(minify = true) {
  const mod = await import(new URL(`file:///${ROOT.replaceAll('\\', '/')}/backend/build.mjs`).href);
  await mod.buildAll({ minify });
}

async function buildFrontend() {
  if (!existsSync(join(ROOT, 'frontend', 'package.json'))) {
    console.warn('[build] frontend 未初始化，跳过');
    return;
  }
  run('npm', ['run', 'build', '-w', 'frontend'], ROOT);
}

export async function assemble() {
  const deploy = join(ROOT, 'deploy');
  await rm(deploy, { recursive: true, force: true });
  mkdirSync(deploy, { recursive: true });

  const copy = async (src, dst) => {
    if (!existsSync(src)) {
      console.warn(`[assemble] 缺失 ${src}，跳过`);
      return;
    }
    await cp(src, dst, { recursive: true });
  };

  // 静态资源（dist 内容平铺到 deploy 根）
  const dist = join(ROOT, 'frontend', 'dist');
  if (existsSync(dist)) {
    for (const name of ['index.html', 'assets', 'favicon.svg', 'vite.svg']) {
      const p = join(dist, name);
      if (existsSync(p)) await cp(p, join(deploy, name), { recursive: true });
    }
  }
  await copy(join(ROOT, 'edge-functions'), join(deploy, 'edge-functions'));
  await copy(join(ROOT, 'node-functions'), join(deploy, 'node-functions'));
  await copy(join(ROOT, 'middleware.js'), join(deploy, 'middleware.js'));
  console.log('[assemble] → deploy/');
}

const doAssemble = process.argv.includes('--assemble');
if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replaceAll('\\', '/')}`).href) {
  if (doAssemble) {
    await assemble();
  } else {
    buildFrontend()
      .then(() => buildBackend(true))
      .then(() => assemble())
      .catch((e) => {
        console.error(e);
        process.exit(1);
      });
  }
}

export { buildBackend };
