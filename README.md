# EdgeOne DB Admin

基于 EdgeOne Pages 的**自托管多数据库 Web 管理**（MySQL / PostgreSQL / MongoDB），支持 SSH 跳板 + php/FastAPI 隧道中继。  
**部署**：git 推送 → EdgeOne Makers 云端构建（`edgeone.json` 配置），全部后端走 Node 函数（`node-functions/api/*.js`）。

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 构建（本地校验：dist 静态 + 函数产物）
npm run build         # → dist/（前端）+ node-functions/api/*.js（函数）

# 3. 部署到 EdgeOne Pages（新版 Makers）
# a) 推送到 GitHub，云端自动跑 buildCommand=npm run build，静态取 outputDirectory=dist
#    函数目录 node-functions/api 由平台识别
# b) 在控制台设置环境变量：
#    ADMIN_PASSWORD    — 登录密码（必填）
#    JWT_SECRET        — JWT 签名密钥（可选，缺省用 ADMIN_PASSWORD 派生）
# c) 如需隧道中继：
#    TUNNEL_SHARED_SECRET — 隧道共享密钥（可选，浏览器连接定义可覆盖）
# d) 可选上限覆盖：MAX_RESULT_ROWS / MAX_RESULT_BYTES / OP_TIMEOUT_MS 等

# 4. 本地开发
npm run dev          # 前端 Vite + 后端 dev-server (:8788)
```

## 架构

```
浏览器 SPA (Vue3 + Naive UI)
 │
 ├─ POST /api/auth    (edge) → 登录(JWT 7天)
 ├─ POST /api/meta    (edge) → capabilities/ping
 ├─ POST /api/tunnel  (edge) → 隧道中继（转发给 php/fastapi）
 └─ POST /api/db      (node) → 直连/SSH 执行（mysql2/pg/mongodb/ssh2）
      │
      ├─ direct          → 直达公网库
      ├─ ssh             → SSH 跳板 → 内网库
      └─ http-tunnel     → 用户自建隧道（php/fastapi）
```

## 功能

- **SQL 控制台**：CodeMirror 6 编辑器（语法高亮/自动补全）、多结果集、EXPLAIN
- **数据网格**：分页浏览、排序、筛选、行内增删改（PK 定位）
- **结构管理**：建/删库、表结构可视化设计、DDL 预览、索引/外键/约束
- **导入导出**：CSV/JSON/Excel 导入 → 类型推断 → 写库；导出 CSV/JSON/SQL
- **MongoDB**：集合浏览、find/aggregate/count、索引管理、文档 CRUD
- **SSH 跳板**：通过 ssh2 forwardOut 直达内网数据库
- **隧道中继**：php/Python FastAPI 隧道由 edge 廉时代收代发

## 存储

| 数据 | 位置 |
|---|---|
| 数据库连接(含口令) | 浏览器 IndexedDB（明文，私人部署可接受） |
| JWT 登录态 | 内存 + localStorage (7天) |
| 查询历史/片段 | 浏览器 IndexedDB |
| 上述数据均不落服务端 | 每次请求随 body 携带，服务端用完即弃 |

## 连接编辑器

支持三种传输方式：

1. **直连** — 直接连接公网可及的数据库
2. **SSH 跳板** — 通过 SSH 通道转发到内网库（目标库地址填内网地址，SSH 段填公网跳板机）
3. **隧道中继** — 使用 php 或 FastAPI 隧道（适合 edge 出站受限的场景）

## 隧道部署

### PHP 隧道
```bash
cp tunnel/php/tunnel.php /path/to/webroot/
# 编辑顶部 TUNNEL_KEY 和 DSN 配置
# 在 EdgeOne 设置 TUNNEL_SHARED_SECRET
```

### Python FastAPI 隧道
```bash
cd tunnel/python
pip install -r requirements.txt
# 编辑 app/config.py 或使用环境变量
uvicorn app.main:app --host 0.0.0.0 --port 9000
```

## 目录结构与云端构建

本仓库面向 **EdgeOne Pages（新版 Makers）的云端构建**：`git push` 后平台自行拉代码、装依赖、跑 `edgeone.json` 里配置的 `buildCommand`。

| 目录/文件 | 说明 |
|---|---|
| `src/` | 前端 Vue3 源码 |
| `functions-src/` | 后端 TS 源码（executor/驱动/SSH/元数据）+ 打包脚本 |
| `node-functions/api/` | **提交进仓库的函数产物**：`db.js` → `/api/db`、`auth.js` → `/api/auth`、`meta.js` → `/api/meta`、`tunnel.js` → `/api/tunnel`（均为 Node 函数） |
| `dist/` | 前端构建产物，EdgeOne `outputDirectory`（本地 `npm run build` 生成，不入库） |
| `shared/` | 前后端共享的协议类型/常量 |
| `docs/tunnel/` | php / FastAPI 隧道脚本 |
| `edgeone.json` | 云端构建配置（outputDirectory=dist + 构建命令 + externalNodeModules + SPA 回落） |

要点：
- `node-functions/api/*.js` 里**只有可被平台消费的单文件 Node 函数**（无第三方裸依赖），平台会把它再打包一次；这也是它们要**提交进仓库**的原因。勿用 `edge-functions/`（Makers 不识别其预编译产物）。
- TS 源码与打包配置在 `functions-src/`，本地 `npm run build` 负责重新生成产物并做类型/构建校验；产物 banner 稳定（无时间戳），重复构建不产生 diff。
- 前端 SPA history 深层链接由 `edgeone.json` 的 `rewrites: [{source:"/*",destination:"/index.html"}]` 兜底，不再需要 catch-all 函数。
- 隧道脚本在 `docs/tunnel/`，属可选项，不入部署产物。

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `ADMIN_PASSWORD` | — | 登录密码（必填） |
| `JWT_SECRET` | 派生自 `ADMIN_PASSWORD` | JWT 签名密钥 |
| `TUNNEL_SHARED_SECRET` | — | 隧道共享密钥 |
| `MAX_RESULT_ROWS` | 500 | 单次查询最大行数 |
| `MAX_RESULT_BYTES` | 8MB | 单次查询最大体积 |
| `OP_TIMEOUT_MS` | 30000 | 直连超时(ms) |
| `SLOW_TIMEOUT_MS` | 60000 | SSH/隧道超时(ms) |

## 开发

```bash
npm run dev          # 前端 Vite(5173) + 后端 dev-server(8788)
npm run build        # 全量构建
npm run typecheck    # 类型检查（前端 + 后端）
```

## 协议

所有端点返回统一 `{ ok, result }` / `{ ok: false, error: { code, message } }` 封包。  
详见 `tunnel/PROTOCOL.md`。

## 许可证

MIT