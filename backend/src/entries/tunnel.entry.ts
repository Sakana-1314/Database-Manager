import { makeEntry } from '../core/entry';
import { tunnelCore } from '../core/kinds/tunnel';

const onRequest = makeEntry(tunnelCore, ['POST']);
export default onRequest;
export { onRequest };
export const onRequestPost = onRequest;
