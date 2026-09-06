import { makeEntry } from '../core/entry';
import { spaCore } from '../core/kinds/spa';

const onRequest = makeEntry(spaCore, ['GET', 'HEAD']);
export default onRequest;
export { onRequest };
export const onRequestGet = onRequest;
export const onRequestHead = onRequest;
