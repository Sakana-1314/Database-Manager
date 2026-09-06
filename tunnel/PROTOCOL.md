# EdgeOne DB Admin — 隧道协议

隧道（php / Python FastAPI 实现）暴露一个 POST 端点，接收与 EdgeOne 后端同构的请求封包，响应同构的封包。

## 请求

```json
POST /
Content-Type: application/json
authorization: Bearer <JWT>          (可选，透传前端登录态)
x-tunnel-secret: <shared-secret>     (鉴权密钥)

{
  "protocolVersion": 1,
  "profile": "my-mysql",             // 隧道服务端 DSN 别名
  "engine": "mysql",                 // 目标引擎
  "op": "sql.run",                   // 操作
  "args": { "sql": "SELECT 1" }      // 参数
}
```

## 响应

```json
{
  "ok": true,
  "result": { "kind": "resultset", "resultset": { "columns": [...], "rows": [...] } },
  "meta": { "durationMs": 12 }
}
```

错误时：
```json
{
  "ok": false,
  "error": { "code": "SYNTAX", "message": "SQL 语法错误", "detail": "details..." }
}
```

## 支持的 op

参见 `shared/src/ops.ts` 的 `OpId` 枚举与 `ArgsMap`。  
隧道应至少实现：`meta.testConnection`, `meta.listDatabases`, `meta.listTables`, `meta.getColumns`, `sql.run`, `grid.list`, `grid.count`。  
可选：`dml.*`, `ddl.*`, `meta.listViews`, `meta.getPrimaryKey`, `meta.getIndexes`, `meta.getForeignKeys`, `meta.getTableInfo`, `meta.getCreateTable`。

## 能力上报

隧道 `meta.capabilities` 响应时返回 `ops` 字段列出支持的 op 列表，前端据此自动禁用不支持的功能。

## 引擎

可通过 `engine` 字段区分 sql/mongodb。PHP 隧道不支持 MongoDB；Python 隧道支持所有引擎。