import type { CoreHandler } from '../entry';
import { jsonResponse, textResponse } from '../respond';
import { INDEX_HTML } from '../../generated-index-html';

/** 由构建注入的 index.html（frontend/dist/index.html 内嵌字符串）。 */
export function spaHtml(): string {
  return INDEX_HTML && INDEX_HTML.length > 0 ? INDEX_HTML : '<!doctype html><html><head><meta charset="utf-8"><title>EdgeOne DB Admin</title></head><body><div id="app"></div><script>location.replace("/")</script></body></html>';
}

/**
 * 非 /api 且平台把未匹配请求交给本函数时 → 返回 index.html（SPA history 模式回落）。
 * /api 未匹配 → JSON 404（绝不回 HTML，避免误吞 API）。
 */
export const spaCore: CoreHandler = async (ctx) => {
  if (ctx.pathname.startsWith('/api')) {
    return jsonResponse(404, { ok: false, error: { code: 'NOT_FOUND', message: '接口不存在' } });
  }
  if (ctx.method === 'HEAD') {
    const r = textResponse(200, '', 'text/html; charset=utf-8');
    return r;
  }
  if (ctx.method !== 'GET') {
    return jsonResponse(405, { ok: false, error: { code: 'BAD_REQUEST', message: '不支持的方法' } });
  }
  return textResponse(200, spaHtml(), 'text/html; charset=utf-8');
};
