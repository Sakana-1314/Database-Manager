export class ApiError extends Error {
  code: string;
  detail?: string;
  status?: number;
  constructor(code: string, message: string, detail?: string, status?: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.detail = detail;
    this.status = status;
  }
}

const ZH: Record<string, string> = {
  BAD_REQUEST: '请求格式有误',
  UNAUTHORIZED: '登录已过期，请重新登录',
  FORBIDDEN: '没有权限',
  NOT_FOUND: '接口或对象不存在',
  INTERNAL: '服务端内部错误',
  PAYLOAD_TOO_LARGE: '数据量超出上限',
  OP_UNSUPPORTED: '当前连接不支持该操作',
  TRANSPORT_UNSUPPORTED: '该传输方式不支持此引擎',
  ENGINE_UNSUPPORTED: '不支持的数据库引擎',
  CONN_REFUSED: '连接被拒绝',
  HOST_UNREACHABLE: '主机不可达',
  AUTH_DB: '数据库账号或密码错误',
  AUTH_SSH: 'SSH 跳板机连接失败',
  SSH_FAILED: 'SSH 转发失败',
  TUNNEL_UNREACHABLE: '无法到达隧道服务器',
  TUNNEL_AUTH: '隧道密钥无效',
  TIMEOUT: '操作超时',
  SYNTAX: 'SQL 语法错误',
  PERMISSION: '权限不足',
  OBJECT_NOT_FOUND: '对象不存在（可能已被删除）',
  CONCURRENT_MODIFY: '并发冲突，请刷新后重试',
  VALIDATION: '参数校验失败',
  NOT_IMPLEMENTED: '暂未实现',
  DECODE: 'JSON 解析失败',
};

export function zhMessage(code: string, fallback: string): string {
  return ZH[code] ?? fallback ?? code;
}
