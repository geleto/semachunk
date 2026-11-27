import * as parser from 'jsonc-parser';
import { chunkJsonRecords } from './json-records.js';

export { jsonValueSpans, splitJsonSpans } from './json-records.js';

export function chunkJson(source, maxChunkSize, fits, locale) {
    return chunkJsonRecords(source, maxChunkSize, fits, locale, parser);
}
