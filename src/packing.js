import { createJoinCheck, sentenceTokenLimit, splitSpans } from './token-limit.js';
import { collapseRuns } from './offsets.js';

// The inclusive endpoints refer to original units. Each new chunk must take
// at least one new unit, even if the requested overlap fills the previous chunk.
export function* packedRanges(count, canAppend, fitsOverlap) {
    let first = 0;
    for (let next = 1; next < count; next++) {
        if (canAppend(first, next)) continue;
        yield [first, next - 1];
        if (fitsOverlap) {
            first++;
            while (first < next && !(fitsOverlap(first, next - 1) && canAppend(first, next))) first++;
        } else first = next;
    }
    if (first < count) yield [first, count - 1];
}

export function packSentences(sentences, maxChunkSize, fits, fitsOverlap) {
    const limit = sentenceTokenLimit(sentences, fits);
    const canJoin = createJoinCheck(maxChunkSize, limit);
    const source = sentences.join(' '), starts = [0];
    for (const sentence of sentences) starts.push(starts.at(-1) + sentence.length + 1);
    const span = (first, last) => source.slice(starts[first], starts[last + 1] - 1);
    const ranges = packedRanges(sentences.length,
        (first, next) => canJoin(span(first, next - 1), sentences[next]),
        fitsOverlap && ((first, last) => fitsOverlap(span(first, last))));
    const chunks = Array.from(ranges, ([first, last]) => span(first, last));
    return limit?.oversized.size ? chunks.flatMap(text => limit.oversized.get(text) ?? [text]) : chunks;
}

function forEachDelimiterEnd(text, delimiter, emit) {
    if (delimiter.length > text.length) return;
    // These literals cannot start or end inside a surrogate pair.
    if (!/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(delimiter)) {
        for (let i = text.indexOf(delimiter); i >= 0; i = text.indexOf(delimiter, i + delimiter.length)) {
            emit(i + delimiter.length);
        }
        return;
    }
    // KMP over complete code points. On a mismatch, reuse the longest matched
    // suffix that is also a prefix, even for runs of identical lone surrogates.
    const pattern = [...delimiter], prefixLength = new Uint32Array(pattern.length);
    function advance(matched, point) {
        while (matched && pattern[matched] !== point) matched = prefixLength[matched - 1];
        return pattern[matched] === point ? matched + 1 : 0;
    }
    for (let i = 1; i < pattern.length; i++) prefixLength[i] = advance(prefixLength[i - 1], pattern[i]);
    let matched = 0, end = 0;
    for (const point of text) {
        end += point.length;
        matched = advance(matched, point);
        if (matched === pattern.length) {
            emit(end);
            matched = 0;
        }
    }
}

export function chunkDelimited(source, separator, { strategy, maxChunkSize, fits, fitsOverlap }) {
    const { text, sourceOffset } = collapseRuns(source, /\r\n/g, '\n');
    const delimiter = separator.replaceAll('\r\n', '\n');
    const records = [], split = new Map();
    function record(a, b) {
        const raw = source.slice(a, b), body = raw.trim();
        if (!body) return;
        const start = b - raw.trimStart().length, end = start + body.length;
        if (fits && !fits(body)) {
            split.set(records.length, splitSpans(source, start, end, (i, j) => fits(source.slice(i, j))));
        }
        records.push([start, end]);
    }
    let cursor = 0;
    forEachDelimiterEnd(text, delimiter, end => {
        record(cursor, sourceOffset(end - delimiter.length));
        cursor = sourceOffset(end);
    });
    record(cursor, source.length);

    const body = (i, j) => source.slice(records[i][0], records[j][1]);
    const ranges = packedRanges(records.length, (i, j) => strategy === 'pack' &&
        records[j][1] - records[i][0] <= maxChunkSize && !split.has(i) && !split.has(j) &&
        (!fits || fits(body(i, j))), fitsOverlap && ((i, j) => fitsOverlap(body(i, j))));
    const chunks = [];
    for (const [i, j] of ranges) {
        for (const [start, end] of split.get(i) ?? [[records[i][0], records[j][1]]]) {
            chunks.push({ text: source.slice(start, end), sourceRanges: [{ start, end, outputStart: 0 }] });
        }
    }
    return chunks;
}
