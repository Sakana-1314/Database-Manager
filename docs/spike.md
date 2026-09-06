# P0 平台 Spike 记录

在首次部署前，需在真实 EdgeOne Pages 控制台验证明以下事项，将结论写入此文件。

## 待验证清单

- [ ] 1. 路由优先级：`edge-functions/api/auth.js` 精确匹配 `/api/auth` 是否优先于 `node-functions/api/db.js` / `/api/db`，静态资产 `index.html` 是否优先于 `[[path]].js` catch-all
- [ ] 2. SPA 深层链接回落：`/ws/abc` 是否正常返回 `index.html`（由 `[[path]].js` 或静态回落处理）
- [ ] 3. ~~中间件~~ 已移除：鉴权由各端点自行 `requireAuth()`，无需验证中间件行为
- [ ] 4. `edge-functions` 的 env 读取方式：`context.env` 还是 `process.env`
- [ ] 5. `node-functions` 的 `process.env` 是否正常
- [ ] 6. 出站连通性：`ssh2 forwardOut` 到跳板机转发、`fetch` 到隧道 URL、标准数据库端口 3306/5432/27017
- [ ] 7. 函数体积上限：`node-functions/api/db.js` 2.3MB 是否可部署
- [ ] 8. 单次调用超时、冷启动耗时
- [ ] 9. `deploy/` 上传模型：确认 EdgeOne 控制台输出目录指向 `deploy/` 能正确识别函数与静态资源
- [ ] 10. `edgeone pages dev` 本地开发与生产环境一致性

## 结论

| 项 | 结论 | 备注 |
|---|---|---|
| 1 | | |
| 2 | | |
| 3 | | |
| 4 | | |
| 5 | | |
| 6 | | |
| 7 | | |
| 8 | | |
| 9 | | |
| 10 | | |