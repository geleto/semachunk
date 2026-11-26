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

// Bisect near whitespace and coalesce fitting neighbors. The normalized plain
// text path consumes a separating space. Markdown assigns it to a source span.
export function splitSpans(source, start, end, fits, { keepWhitespace = true, protectedSpans = [],
    indivisible = false, softSpans = [[start, end]] } = {}) {
    const spans = [], blocked = new Set();
    // Keep the last piece separate until its right neighbor has had a chance to fit with it.
    let pending, pendingOver = false, softStart;
    function flush() {
        if (!pending) return;
        if (pendingOver && blocked.has(spans.at(-1))) spans.at(-1)[1] = pending[1];
        else {
            spans.push(pending);
            if (pendingOver) blocked.add(pending);
        }
    }
    function append(a, b, over) {
        // Cross a soft cut only to rescue an over-limit piece on either side.
        if (pending && (a !== softStart || pendingOver || over) && fits(pending[0], b)) {
            pending[1] = b;
            pendingOver = false;
            return;
        }
        // A discarded word separator can make an otherwise indivisible piece fit.
        if (over && !keepWhitespace) {
            if (a > (pending?.[1] ?? start) && source[a - 1] === ' ' && fits(a - 1, b)) {
                a--;
                over = false;
            } else if (b < end && source[b] === ' ' && fits(a, b + 1)) {
                b++;
                over = false;
            }
        }
        flush();
        pending = [a, b];
        pendingOver = over;
    }
    function visit(a, b) {
        if (a === b) return;
        if (fits(a, b)) return append(a, b, false);
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
        let lo = 0, hi = protectedSpans.length;
        while (lo < hi) {
            const i = (lo + hi) >>> 1;
            if (protectedSpans[i][1] <= cut) lo = i + 1;
            else hi = i;
        }
        if (lo < protectedSpans.length) {
            const [from, to] = protectedSpans[lo];
            if (indivisible && from === a && to === b) return append(a, b, true);
            if (from < cut && (from > a || to < b)) {
                cut = from > a && (to >= b || cut - from <= to - cut) ? from : to;
            }
        }
        if (cut > a && source.codePointAt(cut - 1) > 0xffff) cut++;
        if ((!skip && cut === a) || cut === b) return append(a, b, true);
        visit(a, cut);
        visit(cut + skip, b);
    }
    for (const [a, b] of softSpans) {
        softStart = a;
        visit(a, b);
    }
    flush();
    if (!blocked.size || spans.length === 1) return spans;

    // A neighbor may now contain several pieces. Try its final spelling before
    // leaving a range out of the index. Each successful join removes one range.
    const result = [];
    for (const span of spans) {
        if (blocked.has(span) && fits(span[0], span[1])) blocked.delete(span);
        while (result.length) {
            const left = result.at(-1);
            if (!(blocked.has(left) || blocked.has(span)) || !fits(left[0], span[1])) break;
            span[0] = left[0];
            result.pop();
            blocked.delete(span);
        }
        result.push(span);
    }
    return result;
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
        const spans = splitSpans(text, 0, text.length, (a, b) => fits(text.slice(a, b)), { keepWhitespace: false });
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
