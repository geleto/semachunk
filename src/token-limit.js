// Split only an oversized sentence. Work with source offsets so a fallback
// inside a long word or a script without spaces never inserts or drops text.
function splitToFit(text, fits) {
    const spans = [];
    function visit(start, end) {
        const part = text.slice(start, end);
        if (fits(part)) {
            const last = spans.at(-1);
            if (last && fits(text.slice(last.start, end))) last.end = end;
            else spans.push({ start, end });
            return;
        }

        const middle = Math.floor(part.length / 2);
        const before = part.lastIndexOf(' ', middle), after = part.indexOf(' ', middle);
        const space = before >= 0 && (after < 0 || middle - before <= after - middle) ? before : after;
        if (space >= 0) {
            visit(start, start + space);
            visit(start + space + 1, end);
            return;
        }

        let cut = middle;
        if (cut && /[\uD800-\uDBFF]/.test(part[cut - 1]) && /[\uDC00-\uDFFF]/.test(part[cut])) cut++;
        if (cut === 0 || cut === part.length) {
            throw new RangeError('maxChunkTokens cannot fit one Unicode code point with the configured tokenizer and prefix.');
        }
        visit(start, start + cut);
        visit(start + cut, end);
    }
    visit(0, text.length);
    return spans.map(({ start, end }) => text.slice(start, end));
}

export function createTokenLimit(sentences, maxChunkTokens, countTokens, prefix) {
    const cache = new Map();
    function withinBudget(text) {
        const count = countTokens(text);
        if (!Number.isSafeInteger(count) || count < 0) {
            throw new TypeError('countTokens must return a nonnegative safe integer.');
        }
        return count <= maxChunkTokens;
    }
    function fits(text) {
        if (!cache.has(text)) {
            cache.set(text, withinBudget(text) && (!prefix || withinBudget(prefix + text)));
        }
        return cache.get(text);
    }

    // Oversized sentences are final boundaries. Their pieces go directly to the
    // output batch; neither a truncated sentence nor a partial word gets scored.
    const oversized = new Map();
    for (const sentence of sentences) {
        if (!fits(sentence) && !oversized.has(sentence)) oversized.set(sentence, splitToFit(sentence, fits));
    }
    return { oversized, fits };
}

export function createJoinCheck(maxChunkSize, tokenLimit) {
    const fitsLength = (left, right) => left.length + 1 + right.length <= maxChunkSize;
    if (!tokenLimit) return fitsLength;
    return (left, right) => fitsLength(left, right) &&
        !tokenLimit.oversized.has(left) && !tokenLimit.oversized.has(right) && tokenLimit.fits(left + ' ' + right);
}
