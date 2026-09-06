import { makeEntry } from '../core/entry';
import { authCore } from '../core/kinds/auth';

const onRequest = makeEntry(authCore, ['POST']);
export default onRequest;
export { onRequest };
export const onRequestPost = onRequest;
