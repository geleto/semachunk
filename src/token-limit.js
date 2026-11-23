export function tokenBudget(maxTokens, countTokens, prefix) {
    if (maxTokens === Infinity) return undefined;
    function fits(text) {
        const count = countTokens(text);
        if (!Number.isSafeInteger(count) || count < 0) {
            throw new TypeError('countTokens must return a nonnegative safe integer.');
        }
        return count <= maxTokens;
    }
    return text => fits(text) && (!prefix || fits(prefix + text));
}

export class TokenLimitError extends RangeError {
    constructor() {
        super('maxChunkTokens cannot fit one Unicode code point with the configured tokenizer and prefix.');
    }
}

// Bisect near whitespace and coalesce fitting neighbors. The normalized plain
// text path consumes a separating space. Markdown assigns it to a source span.
export function splitSpans(source, start, end, fits, keepWhitespace = true, protectedSpans = []) {
    const spans = [];
    function visit(a, b) {
        if (fits(a, b)) {
            const last = spans.at(-1);
            if (last && fits(last[0], b)) last[1] = b;
            else spans.push([a, b]);
            return;
        }
        const mid = a + Math.floor((b - a) / 2);
        let cut = mid, skip = 0;
        search: for (let delta = 0; mid - delta >= a || mid + delta < b; delta++) {
            for (const i of [mid - delta, mid + delta]) {
                if (i < a || i >= b) continue;
                if (keepWhitespace ? !/\s/u.test(source[i]) : source[i] !== ' ') continue;
                const boundary = keepWhitespace && i < mid ? i + 1 : i;
                if (keepWhitespace && (boundary === a || boundary === b)) continue;
                cut = boundary;
                skip = keepWhitespace ? 0 : 1;
                break search;
            }
        }
        for (const [from, to] of protectedSpans) {
            if (from >= cut) break;
            if (cut < to && (from > a || to < b)) {
                cut = from > a && (to >= b || cut - from <= to - cut) ? from : to;
                break;
            }
        }
        if (cut > a && /[\uD800-\uDBFF]/.test(source[cut - 1]) && /[\uDC00-\uDFFF]/.test(source[cut])) cut++;
        if ((!skip && cut === a) || cut === b) throw new TokenLimitError();
        visit(a, cut);
        visit(cut + skip, b);
    }
    visit(start, end);
    return spans;
}

export function sentenceTokenLimit(sentences, withinBudget) {
    if (!withinBudget) return undefined;
    const cache = new Map(), oversized = new Map();
    function fits(text) {
        if (!cache.has(text)) cache.set(text, withinBudget(text));
        return cache.get(text);
    }
    for (const text of sentences) {
        if (fits(text) || oversized.has(text)) continue;
        const spans = splitSpans(text, 0, text.length, (a, b) => fits(text.slice(a, b)), false);
        oversized.set(text, spans.map(([a, b]) => text.slice(a, b)));
    }
    return { oversized, fits };
}

export function createJoinCheck(maxChunkSize, tokenLimit) {
    const fitsLength = (left, right) => left.length + 1 + right.length <= maxChunkSize;
    if (!tokenLimit) return fitsLength;
    return (left, right) => fitsLength(left, right) &&
        !tokenLimit.oversized.has(left) && !tokenLimit.oversized.has(right) && tokenLimit.fits(left + ' ' + right);
}
