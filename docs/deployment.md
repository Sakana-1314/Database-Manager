# 部署指南

## 前置条件

1. 腾讯云 EdgeOne Pages 账号（控制台：https://console.edgeone.cloud.tencent.com/pages）
2. 安装 `edgeone` CLI（可选，用于本地模拟与部署）

```bash
npm install -g edgeone
edgeone login --site china
```

## 构建

```bash
npm install
npm run build
```

产物在 `deploy/` 目录。

## 上传至 EdgeOne Pages

1. EdgeOne 控制台 → Pages → 新建项目
2. 项目名称：自定义（如 `db-admin`）
3. 输出目录：`deploy/`（或手动上传 `deploy/` 的全部内容）
4. 构建命令：空（本地已构建）
5. 部署触发：Git 推送或手动上传 ZIP

## 环境变量配置

在 Pages 项目设置 → 环境变量中添加：

| 变量 | 值 | 必填 |
|---|---|---|
| `ADMIN_PASSWORD` | 你的登录密码 | 是 |
| `JWT_SECRET` | 随机字符串（如 `openssl rand -hex 32`） | 推荐 |
| `TUNNEL_SHARED_SECRET` | 隧道共享密钥 | 隧道模式 |

## 域名

项目创建后生成默认域名（如 `https://xxx.x.pages.cloud`），可直接使用。  
也可在「项目设置 → 自定义域名」绑定自有域名。

## 隧道部署

### PHP 隧道
```bash
cp tunnel/php/tunnel.php /path/to/webroot/
# 编辑顶部 TUNNEL_KEY 和 DSN 配置
# 确保 PHP 安装 pdo_mysql / pdo_pgsql 扩展
```

### Python FastAPI 隧道
```bash
cd tunnel/python
pip install -r requirements.txt
export TUNNEL_SHARED_SECRET=your-secret
export DEFAULT_PROFILES_JSON='{"prod":{"host":"127.0.0.1","port":3306,"user":"root","password":"xxx","database":"test"}}'
uvicorn tunnel.python.main:app --host 0.0.0.0 --port 9000
```

## 连接配置

登录后，在左侧「新建连接」填写：
- **引擎**：MySQL / PostgreSQL / MongoDB
- **传输方式**：直连 / SSH 跳板 / 隧道
- 按需填写主机端口、认证信息、跳板机或隧道地址

## 升级

1. 拉取最新代码
2. `npm install && npm run build`
3. 重新上传 `deploy/` 覆盖

## 注意事项

- 数据库口令只存浏览器 IndexedDB，同一浏览器登出后不清除；如需安全共享浏览器请使用隐私窗口
- JWT 有效期 7 天，登录态过期后自动跳转登录页
- node-functions 每次直连/SSH 操作都会重新连接数据库（无跨请求池），适合管理场景，不适合高并发 API
- MongoDB 经 SSH 暂不支持，请使用 Python 隧道