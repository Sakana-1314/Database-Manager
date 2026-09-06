import { makeEntry } from '../core/entry';
import { metaCore } from '../core/kinds/meta';

const onRequest = makeEntry(metaCore, ['POST']);
export default onRequest;
export { onRequest };
export const onRequestPost = onRequest;
