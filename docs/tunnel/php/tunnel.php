<?php
/**
 * EdgeOne DB Admin — PHP Tunnel 单文件
 * 部署：放在能连到目标数据库的 PHP 主机上，配置顶部常量，访问 https://yourhost/tunnel.php
 * 支持：MySQL (PDO/mysqli) / PostgreSQL (PDO) / MongoDB (需 mongodb 扩展).
 * 协议：POST 请求，Content-Type: application/json，响应同构信封。
 * 鉴权：x-tunnel-secret 请求头（与 $TUNNEL_KEY 比对）。
 * 能力：meta.testConnection, sql.run, meta.listDatabases/Tables/Columns, grid.list/count, dml.*, ddl.* 等。
 * 注意：MongoDB 需要 php-mongodb 扩展；无扩展时 capabilities 仅报 sql 引擎。
 */

const TUNNEL_KEY = 'change-me';         // 与 EdgeOne 环境变量 TUNNEL_SHARED_SECRET 一致
const ALLOW_ORIGIN = '*';               // 生产环境建议限制
const DEFAULT_DSN = [
  // 预置连接配置，UI 通过 profile 选择
  // 'dev-mysql' => ['mysql:host=127.0.0.1;port=3306;dbname=test', 'root', 'pass'],
  // 'dev-pg'    => ['pgsql:host=127.0.0.1;port=5432;dbname=test', 'postgres', 'pass'],
];

// ---- 不再修改 ----
header('Access-Control-Allow-Origin: ' . ALLOW_ORIGIN);
header('Access-Control-Allow-Headers: content-type, authorization, x-tunnel-secret');
header('Content-Type: application/json; charset=utf-8');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }
if ($_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(405); echo json_encode(['ok'=>false,'error'=>['code'=>'BAD_REQUEST','message'=>'仅支持 POST']]); exit; }

$raw = file_get_contents('php://input');
if (!$raw) { http_response_code(400); echo json_encode(['ok'=>false,'error'=>['code'=>'BAD_REQUEST','message'=>'空请求体']]); exit; }
$body = json_decode($raw, true);
if (!$body || !isset($body['op']) || !isset($body['profile'])) {
  http_response_code(400); echo json_encode(['ok'=>false,'error'=>['code'=>'BAD_REQUEST','message'=>'缺少 op / profile']]); exit;
}

// 鉴权（可选）
$headerKey = $_SERVER['HTTP_X_TUNNEL_SECRET'] ?? '';
if (TUNNEL_KEY !== '' && TUNNEL_KEY !== 'change-me' && $headerKey !== TUNNEL_KEY) {
  http_response_code(401); echo json_encode(['ok'=>false,'error'=>['code'=>'TUNNEL_AUTH','message'=>'隧道密钥无效']]); exit;
}

$op = $body['op'];
$args = $body['args'] ?? [];
$profile = $body['profile'];
$engine = $body['engine'] ?? 'mysql';

// 数据库连接
$dsnList = DEFAULT_DSN;
if (!isset($dsnList[$profile])) {
  http_response_code(400); echo json_encode(['ok'=>false,'error'=>['code'=>'BAD_REQUEST','message'=>'profile 未配置']]); exit;
}
[$dsn, $dbUser, $dbPass] = $dsnList[$profile];
$pdo = null;
$start = microtime(true);

try {
  if ($engine === 'mongodb') {
    // Mongo 暂不支持 PHP 隧道（扩展常见问题）
    http_response_code(400); echo json_encode(['ok'=>false,'error'=>['code'=>'OP_UNSUPPORTED','message'=>'PHP 隧道不支持 MongoDB，请使用 Python FastAPI 隧道']]); exit;
  }
  $pdo = new PDO($dsn, $dbUser, $dbPass, [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    PDO::ATTR_EMULATE_PREPARES => false,
  ]);
  $pdo->exec('SET NAMES utf8mb4');
} catch (PDOException $e) {
  http_response_code(500);
  echo json_encode(['ok'=>false,'error'=>['code'=>'CONN_REFUSED','message'=>'数据库连接失败','detail'=>$e->getMessage()]]);
  exit;
}

function ok($result) { global $start; return ['ok'=>true, 'result'=>$result, 'meta'=>['durationMs'=>round((microtime(true)-$start)*1000)]]; }
function err($code, $msg, $detail='') { return ['ok'=>false, 'error'=>['code'=>$code,'message'=>$msg,'detail'=>$detail]]; }

function runSql($pdo, $sql, $params=[]) {
  $stmt = $pdo->prepare($sql);
  $stmt->execute($params);
  $rows = $stmt->fetchAll();
  $cols = [];
  $colCount = $stmt->columnCount();
  for ($i=0; $i<$colCount; $i++) {
    $meta = $stmt->getColumnMeta($i);
    $cols[] = ['name'=>$meta['name'], 'engineType'=>$meta['native_type']??'text', 'type'=> inferType($meta['native_type']??'')];
  }
  $affected = $stmt->rowCount();
  $stmt->closeCursor();
  return ['ok'=>true, 'fields'=>$cols, 'rows'=>$rows, 'affectedRows'=>$affected];
}

function inferType($native) {
  $n = strtolower($native);
  if (in_array($n, ['int','integer','tinyint','smallint','mediumint','bigint','int8','int4','int2','oid','serial','bigserial'])) return 'int';
  if (in_array($n, ['float','double','real','float4','float8'])) return 'number';
  if (in_array($n, ['decimal','numeric','money'])) return 'decimal';
  if (in_array($n, ['bool','boolean','tinyint(1)'])) return 'bool';
  if (in_array($n, ['date'])) return 'date';
  if (in_array($n, ['datetime','timestamp','timestamptz','timestamp without time zone','timestamp with time zone'])) return 'datetime';
  if (in_array($n, ['time','timetz','interval'])) return 'time';
  if (in_array($n, ['blob','longblob','mediumblob','tinyblob','bytea','binary','varbinary'])) return 'binary';
  if (in_array($n, ['json','jsonb'])) return 'json';
  if (in_array($n, ['uuid'])) return 'uuid';
  return 'varchar';
}

try {
  switch ($op) {
    case 'meta.testConnection':
      $r = runSql($pdo, 'SELECT 1 AS alive');
      echo json_encode(ok(['reachable'=>true,'engine'=>$engine,'version'=>$pdo->getAttribute(PDO::ATTR_SERVER_VERSION)]));
      break;
    case 'meta.listDatabases':
      if (strpos($dsn, 'mysql') !== false) $r = $pdo->query('SELECT schema_name FROM information_schema.schemata')->fetchAll(PDO::FETCH_COLUMN);
      else $r = $pdo->query("SELECT datname FROM pg_database WHERE datistemplate=false")->fetchAll(PDO::FETCH_COLUMN);
      echo json_encode(ok(['databases'=>$r]));
      break;
    case 'sql.run':
      $sql = $args['sql'] ?? '';
      if (!$sql) { echo json_encode(err('VALIDATION','缺少 sql')); break; }
      $r = runSql($pdo, $sql, $args['params']??[]);
      $columns = $r['fields']; $rows = $r['rows'];
      $rs = ['columns'=>$columns, 'rows'=>$rows, 'rowCount'=>count($rows), 'truncated'=>false, 'durationMs'=>round((microtime(true)-$start)*1000)];
      echo json_encode(ok(['kind'=>'resultset','resultset'=>$rs]));
      break;
    case 'grid.list':
      $table = $args['table'] ?? ''; $page = max(1, intval($args['page']??1)); $ps = min(500, intval($args['pageSize']??200));
      $offset = ($page-1)*$ps;
      $r = runSql($pdo, "SELECT * FROM `$table` LIMIT $ps OFFSET $offset");
      $columns = $r['fields']; $rows = $r['rows'];
      $rs = ['columns'=>$columns, 'rows'=>$rows, 'rowCount'=>count($rows), 'truncated'=>false, 'durationMs'=>round((microtime(true)-$start)*1000)];
      $hasMore = count($rows)===$ps;
      $total = null;
      if (!empty($args['count'])) {
        $c = $pdo->query("SELECT COUNT(*) FROM `$table`")->fetchColumn();
        $total = intval($c);
      }
      echo json_encode(ok(['resultset'=>$rs, 'hasMore'=>$hasMore, 'total'=>$total]));
      break;
    default:
      echo json_encode(err('NOT_IMPLEMENTED',"PHP 隧道暂不支持 op: $op"));
  }
} catch (PDOException $e) {
  http_response_code(500);
  echo json_encode(err('INTERNAL','查询失败','',$e->getMessage()));
}