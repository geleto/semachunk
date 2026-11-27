// Source and output coordinates are half-open UTF-16 intervals. A decoded
// entity or collapsed run may have different lengths on the two sides.
export function appendRange(ranges, start, end, outputStart, outputEnd) {
    if (start >= end || outputStart >= outputEnd) return;
    const prev = ranges.at(-1);
    if (prev && prev.end === start && prev.outputEnd === outputStart &&
        prev.end - prev.start === prev.outputEnd - prev.outputStart && end - start === outputEnd - outputStart) {
        prev.end = end;
        prev.outputEnd = outputEnd;
    } else ranges.push({ start, end, outputStart, outputEnd });
}

export function literal(text, start = 0) {
    return { text, citations: text.length ? [{ start, end: start + text.length, outputStart: 0, outputEnd: text.length }] : [] };
}

function intersecting(ranges, start, end) {
    let lo = 0, hi = ranges.length;
    while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (ranges[mid].outputEnd <= start) lo = mid + 1;
        else hi = mid;
    }
    const out = [];
    for (let i = lo; i < ranges.length && ranges[i].outputStart < end; i++) out.push(ranges[i]);
    return out;
}

export function sliceView(view, start, end) {
    const citations = [];
    for (const r of intersecting(view.citations, start, end)) {
        const a = Math.max(start, r.outputStart), b = Math.min(end, r.outputEnd);
        const linear = r.end - r.start === r.outputEnd - r.outputStart;
        appendRange(citations, linear ? r.start + a - r.outputStart : r.start,
            linear ? r.end - (r.outputEnd - b) : r.end, a - start, b - start);
    }
    return {text: view.text.slice(start, end), citations};
}

export function joinViews(views, separator = '') {
    const parts = [], citations = [];
    let offset = 0;
    for (const view of views) {
        if (parts.length) offset += separator.length;
        parts.push(view.text);
        for (const r of view.citations) appendRange(citations, r.start, r.end, offset + r.outputStart, offset + r.outputEnd);
        offset += view.text.length;
    }
    return {text: parts.join(separator), citations};
}

// Parsers change whitespace and insert block separators. Consume each visible
// character exactly once so repeated strings retain their own source identity.
export function alignWhitespace(view, target) {
    if (view.text === target) return view;
    const input = view.text, citations = [];
    let i = 0, j = 0;
    const white = /\s/u;
    while (i < input.length || j < target.length) {
        let a = i, b = j;
        while (i < input.length && white.test(input[i])) i++;
        while (j < target.length && white.test(target[j])) j++;
        if (j > b && i > a) {
            for (const r of sliceView(view, a, i).citations) {
                if (i-a === j-b) appendRange(citations,r.start,r.end,b+r.outputStart,b+r.outputEnd);
                else appendRange(citations,r.start,r.end,b,j);
            }
        }
        a = i; b = j;
        while (i < input.length && j < target.length && input[i] === target[j] && !white.test(target[j])) { i++; j++; }
        if (i > a) {
            for (const r of sliceView(view, a, i).citations) appendRange(citations,r.start,r.end,b+r.outputStart,b+r.outputEnd);
        } else if ((i < input.length || j < target.length) &&
            !(i < input.length && white.test(input[i])) && !(j < target.length && white.test(target[j]))) {
            throw new Error('Visible parser text diverged from its source at offset ' + i + '.');
        }
    }
    return {text:target, citations};
}

export function sourceSpans(view) {
    const sorted = view.citations.map(r => [r.start,r.end]).sort((a,b) => a[0]-b[0] || a[1]-b[1]);
    const spans = [];
    for (const [a,b] of sorted) {
        if (spans.length && a <= spans.at(-1)[1]) spans.at(-1)[1] = Math.max(b,spans.at(-1)[1]);
        else spans.push([a,b]);
    }
    return spans;
}

export function covers(outer, inner) {
    let i = 0;
    for (const [a,b] of inner) {
        while (i < outer.length && outer[i][1] <= a) i++;
        if (i === outer.length || outer[i][0] > a || outer[i][1] < b) return false;
    }
    return inner.length > 0;
}
