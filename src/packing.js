import { createJoinCheck, sentenceTokenLimit } from './token-limit.js';

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
