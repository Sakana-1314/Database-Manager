import { makeEntry } from '../core/entry';
import { dbCore } from '../core/kinds/db';

const onRequest = makeEntry(dbCore, ['POST']);
export default onRequest;
export { onRequest };
export const onRequestPost = onRequest;
