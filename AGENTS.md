# AGENTS.md — 本仓库协作约定

> 供 Claude Code / AI 代理与贡献者阅读，约束在本仓库里的所有操作。**任何非 trivial 改动都走 PR，且必须以 squash merge 合并进 `main`**（`main` 的合并会自动触发 EdgeOne Pages 云端构建与部署）。

## 项目定位
自托管多数据库 Web 管理（MySQL / PostgreSQL / MongoDB），部署在腾讯云 **EdgeOne Pages（新版 Makers）云端构建**上。前端 Vue3+Naive UI；后端按"edge 便宜先行、Node 兜底"分层。

## 目录结构（务必遵守）
| 路径 | 性质 | 怎么改 |
|---|---|---|
| `src/` | 前端源码（Vue3 SFC） | 直接改 |
| `functions-src/` | 后端 TS 源码 + 打包脚本 `build.mjs` | **这是唯一可编辑的后端源码** |
| `node-functions/`、`edge-functions/` | **已提交的编译产物**（单文件函数，平台直接消费） | 改完 `functions-src/` 后运行 `npm run build:backend` 重建，**连同产物一起提交** |
| `shared/src/` | 前后端/函数共享协议类型与常量 | 谨慎改，`src/`、`functions-src/` 都引用它 |
| `docs/tunnel/` | php / FastAPI 隧道脚本 | 直接改 |
| `dist/`、`deploy/`、`node_modules/` | 构建产物，`.gitignore` 已排除 | 绝不提交 |
| `edgeone.json` | 云端构建配置 | 改动前先确认平台 schema |

## 平台硬约束（违反会导致云端构建失败）
1. **函数目录只放平台能再打包的单文件产物**，不得把 `ssh2` 等带原生依赖的源码或裸 import 放进去（平台会再打包一次，遇到 `.node` 即报错）。ssh2 仅在 `functions-src` 打包时经 `external` 处理。
2. 产物 banner **无时间戳**，重复构建必须 **git 零 diff**。若发现构建后产生 diff，先查是不是又引入了时间戳/哈希。
3. 新增/修改函数路由后：本地跑 `node functions-src/build.mjs`，再对产物做一次 `esbuild --bundle` 验证可再打包。

## 常用命令
```bash
npm run dev                 # 本地：dev-server(:8788) + Vite(:5173)
npm run build               # 全量：前端 + 函数产物 + assemble(静态到 deploy)
npm run typecheck           # 前端 vue-tsc
npm run typecheck:backend   # functions-src tsc
npm run build:backend       # 仅重建函数产物
```

## 工作流
- 主干 `main`。每次改动新建分支：`feat/xxx` / `fix/xxx` / `refactor/xxx` / `docs/xxx`。
- 不要直接 push `main`（本仓库历史教训：直接 push 导致需要用户手动在云端踩坑）。流程：
  1. `git checkout -b feat/xxx`
  2. 提交（语义化前缀，中文描述）
  3. `git push -u origin feat/xxx`
  4. `gh pr create` → 描述改动与验证
  5. **`gh pr merge --squash --delete-branch`**（确保 squash 单提交，main 历史干净，且触发自动部署）
- 提交信息格式：`<type>: <中文摘要>`，type ∈ feat / fix / refactor / docs / chore。

## 质量要求
- 改前端必须过 `npm run typecheck` 与 `npm run build:frontend`。
- 改 functions-src 必须过 `npm run typecheck:backend` 与 `npm run build:backend`，并核对产物零 diff。
- UI 文案用简体中文；错误码在 `shared/src/protocol.ts` 里统一，别新增散落的 magic string。
- 数据库操作一律参数化/引用转义，绝不用字符串拼接用户输入。
