# Python FastAPI 隧道（支持 MySQL / PostgreSQL / MongoDB）
# 安装：pip install fastapi uvicorn pymysql psycopg2-binary pymongo
# 运行：uvicorn tunnel.python.main:app --host 0.0.0.0 --port 9000
# 环境变量：TUNNEL_SHARED_SECRET, DEFAULT_PROFILES_JSON (JSON 字符串 {profile: {dsn, user, password, engine}})

import os, json, time, hmac
from typing import Optional
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse

app = FastAPI(title="EdgeOne DB Tunnel", version="0.1.0")

TUNNEL_SECRET = os.environ.get("TUNNEL_SHARED_SECRET", "")
PROFILES_JSON = os.environ.get("DEFAULT_PROFILES_JSON", "{}")
PROFILES = json.loads(PROFILES_JSON)


def auth(request: Request):
    secret = request.headers.get("x-tunnel-secret", "")
    if TUNNEL_SECRET and secret != TUNNEL_SECRET:
        raise HTTPException(status_code=401, detail={"code": "TUNNEL_AUTH", "message": "隧道密钥无效"})


def get_profile(profile: str):
    p = PROFILES.get(profile)
    if not p:
        raise HTTPException(status_code=400, detail={"code": "BAD_REQUEST", "message": f"profile 未配置: {profile}"})
    return p


def ok_json(result, start):
    return JSONResponse({"ok": True, "result": result, "meta": {"durationMs": round((time.time() - start) * 1000)}})


def err_json(code, msg, detail=""):
    return JSONResponse(status_code=500, content={"ok": False, "error": {"code": code, "message": msg, "detail": detail}})


def connect_mysql(profile_):
    import pymysql
    return pymysql.connect(
        host=profile_.get("host", "127.0.0.1"),
        port=profile_.get("port", 3306),
        user=profile_.get("user", "root"),
        password=profile_.get("password", ""),
        database=profile_.get("database"),
        cursorclass=pymysql.cursors.DictCursor,
        charset="utf8mb4",
    )


def connect_pg(profile_):
    import psycopg2
    return psycopg2.connect(
        host=profile_.get("host", "127.0.0.1"),
        port=profile_.get("port", 5432),
        user=profile_.get("user", "postgres"),
        password=profile_.get("password", ""),
        dbname=profile_.get("database", "postgres"),
    )


def connect_mongo(profile_):
    from pymongo import MongoClient
    uri = f"mongodb://{profile_.get('host','127.0.0.1')}:{profile_.get('port',27017)}/"
    if profile_.get("user"):
        return MongoClient(uri, username=profile_.get("user"), password=profile_.get("password"))
    return MongoClient(uri)


@app.post("/")
async def handle(request: Request):
    auth(request)
    body = await request.json()
    op = body.get("op", "")
    args = body.get("args", {})
    profile = body.get("profile", "")
    engine = body.get("engine", "mysql")
    start = time.time()

    try:
        p = get_profile(profile)
        if engine == "mongodb":
            conn = connect_mongo(p)
            db = conn.get_database(args.get("db", p.get("database", "admin")))
            if op == "meta.testConnection":
                db.command("ping")
                return ok_json({"reachable": True, "engine": "mongodb", "version": conn.server_info().get("version", "")}, start)
            elif op == "mongo.listDatabases":
                dbs = conn.list_database_names()
                return ok_json({"databases": [{"name": d} for d in dbs]}, start)
            elif op == "mongo.listCollections":
                cols = db.list_collection_names()
                return ok_json({"collections": [{"name": c} for c in cols]}, start)
            elif op == "mongo.run":
                coll = args.get("collection", "")
                mode = args.get("mode", "find")
                filter_ = args.get("filter", {})
                if mode == "count":
                    n = db[coll].count_documents(filter_)
                    return ok_json({"count": n}, start)
                docs = list(db[coll].find(filter_).limit(100))
                for doc in docs:
                    doc["_id"] = str(doc["_id"])
                return ok_json({"documents": docs, "count": len(docs)}, start)
            else:
                return err_json("NOT_IMPLEMENTED", f"op 未实现: {op}")
        elif engine.startswith("postgres") or engine == "postgres":
            conn = connect_pg(p)
            cur = conn.cursor()
        else:
            conn = connect_mysql(p)
            cur = conn.cursor()

        try:
            if op == "meta.testConnection":
                cur.execute("SELECT 1")
                ver = conn.get_server_info() if engine == "mysql" else f"PostgreSQL {conn.server_version}"
                return ok_json({"reachable": True, "engine": engine, "version": ver}, start)

            elif op == "meta.listDatabases":
                if engine == "mysql":
                    cur.execute("SELECT SCHEMA_NAME FROM information_schema.SCHEMATA")
                    dbs = [r[0] for r in cur.fetchall()]
                else:
                    cur.execute("SELECT datname FROM pg_database WHERE datistemplate=false")
                    dbs = [r[0] for r in cur.fetchall()]
                return ok_json({"databases": dbs}, start)

            elif op == "sql.run":
                sql = args.get("sql", "")
                if not sql:
                    return err_json("VALIDATION", "缺少 sql")
                cur.execute(sql)
                if cur.description:
                    cols = [{"name": d[0], "engineType": "text", "type": "varchar"} for d in cur.description]
                    rows = [list(r) for r in cur.fetchall()]
                else:
                    cols = []
                    rows = []
                rs = {"columns": cols, "rows": rows, "rowCount": len(rows), "truncated": False, "durationMs": round((time.time() - start) * 1000)}
                return ok_json({"kind": "resultset", "resultset": rs}, start)

            elif op == "grid.list":
                table = args.get("table", "")
                page = max(1, int(args.get("page", 1)))
                ps = min(500, int(args.get("pageSize", 200)))
                offset = (page - 1) * ps
                if engine == "mysql":
                    cur.execute(f"SELECT * FROM `{table}` LIMIT {ps} OFFSET {offset}")
                else:
                    cur.execute(f'SELECT * FROM "{table}" LIMIT {ps} OFFSET {offset}')
                cols = [{"name": d[0], "engineType": "text", "type": "varchar"} for d in cur.description] if cur.description else []
                rows = [list(r) for r in cur.fetchall()]
                rs = {"columns": cols, "rows": rows, "rowCount": len(rows), "truncated": False, "durationMs": round((time.time() - start) * 1000)}
                hasMore = len(rows) == ps
                total = None
                if args.get("count"):
                    if engine == "mysql":
                        cur.execute(f"SELECT COUNT(*) FROM `{table}`")
                    else:
                        cur.execute(f'SELECT COUNT(*) FROM "{table}"')
                    total = cur.fetchone()[0]
                return ok_json({"resultset": rs, "hasMore": hasMore, "total": total}, start)

            else:
                return err_json("NOT_IMPLEMENTED", f"op 未实现: {op}")
        finally:
            conn.close()
    except Exception as e:
        return err_json("INTERNAL", "执行失败", str(e))


@app.get("/")
async def root():
    return {"name": "EdgeOne DB Tunnel", "version": "0.1.0"}